import { QUALIFIER_TYPES } from '../effects/qualifier-pick';
import type { TrackApply } from '../core/tracking';
import { OUTPUT_ID, OUTPUT_NODE, SOURCE_ID, SOURCE_NODE, evaluationOrder, materialize, nodeById, type NodeGraph } from '../core/graph';
import { captureTemplate, placeTemplate } from '../core/graph-templates';

const TEMPLATE_PREFIX = 'template:';
import {
  addGraphNode,
  connectNodes,
  disconnectInput,
  enableGraph,
  moveGraphNode,
  removeGraphNode,
  setNodeEnabled,
  setNodeParams,
} from '../core/graph-operations';
import { Emitter } from '../core/emitter';
import { createId } from '../core/ids';
import type { Item } from '../core/model';
import type { Operation } from '../core/operations';
import { findPlacement } from '../core/timeline';
import type { EditorSession } from '../host/session';
import { t } from '../i18n';
import { ParamControls } from './components/param-controls';
import { toast } from './components/toast';
import { h } from './dom';
import { PORT_RADIUS, fitView, hitTest, layoutNode, type NodeBox, type Viewport } from './node-layout';
import type { Selection } from './selection';

type Drag =
  | { kind: 'node'; id: string; dx: number; dy: number; moved: boolean }
  | { kind: 'link'; from: string; x: number; y: number }
  | { kind: 'pan'; x0: number; y0: number; view: Viewport };

export class NodeEditor extends Emitter<{ select: { itemId: string; nodeId: string } | null }> {
  readonly element: HTMLElement;
  private canvas: HTMLCanvasElement;
  private inspector: HTMLDivElement;
  private addSelect: HTMLSelectElement;
  private hint: HTMLParagraphElement;
  private view: Viewport = { x: 40, y: 40, zoom: 1 };
  private selectedNode: string | null = null;
  private drag: Drag | null = null;
  private boxes: NodeBox[] = [];
  private fitted: string | null = null;
  private queued = false;
  private inspectedKey = '';
  private style = getComputedStyle(document.documentElement);
  visible = false;

  constructor(
    private session: EditorSession,
    private selection: Selection,
    private onTrack: (itemId: string, apply: TrackApply) => void = () => undefined,
    private onPickColor: (itemId: string, nodeId: string, add: boolean) => void = () => undefined,
  ) {
    super();
    this.canvas = h('canvas', { id: 'node-canvas', tabindex: 0 });
    this.inspector = h('div', { class: 'node-inspector', id: 'node-inspector' });
    this.hint = h('p', { class: 'hint node-hint' }, t('nodesHint'));
    this.addSelect = h('select', { id: 'node-add', 'aria-label': t('nodesAdd') });
    this.addSelect.addEventListener('change', () => {
      const value = this.addSelect.value;
      if (value.startsWith(TEMPLATE_PREFIX)) this.addTemplate(value.slice(TEMPLATE_PREFIX.length));
      else if (value) this.addNode(value);
      this.addSelect.value = '';
    });
    const tools = h('div', { class: 'timeline-tools node-tools' },
      this.addSelect,
      h('button', { class: 'btn small', id: 'node-fit', onClick: () => this.fit() }, t('nodesFit')),
      h('button', { class: 'btn small', id: 'node-save-template', onClick: () => this.saveTemplate() }, t('nodesSaveTemplate')),
      h('button', { class: 'btn small', id: 'node-delete', onClick: () => this.deleteSelected() }, t('delete')),
    );
    this.element = h('div', { class: 'node-editor', hidden: true }, tools, h('div', { class: 'node-body' }, this.canvas, this.inspector), this.hint);
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', () => (this.drag = null));
    this.canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.canvas.addEventListener('dblclick', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const hit = hitTest(this.boxes, e.clientX - r.left, e.clientY - r.top, this.view.zoom);
      const item = this.item;
      if (hit.kind !== 'node' || !item) return;
      const current = this.session.viewedNode;
      const same = current?.itemId === item.id && current.nodeId === hit.box.node.id;
      this.session.viewNode(same || hit.box.node.type === OUTPUT_NODE ? null : { itemId: item.id, nodeId: hit.box.node.id });
    });
    session.on('view', () => this.draw());
    this.canvas.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        this.deleteSelected();
      }
    });
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    session.store.on('change', () => this.refresh());
    session.registry.on('change', () => this.refresh());
    selection.on('change', () => {
      this.selectedNode = null;
      this.refresh();
    });
    this.refresh();
  }

  show(visible: boolean): void {
    this.visible = visible;
    this.element.hidden = !visible;
    if (visible) this.refresh();
  }

  private get item(): Item | null {
    const id = this.selection.id;
    const placement = id ? findPlacement(this.session.store.project, id) : null;
    return placement && placement.track.kind === 'video' ? placement.item : null;
  }

  private graph(item: Item): NodeGraph {
    const registry = this.session.registry;
    return materialize(item.effects, item.graph, registry);
  }

  private inputsOf(type: string): string[] {
    if (type === SOURCE_NODE) return [];
    if (type === OUTPUT_NODE) return ['input'];
    return [...(this.session.registry.inputsOf(type) ?? [])];
  }

  private label(type: string): string {
    if (type === SOURCE_NODE) return t('nodesSource');
    if (type === OUTPUT_NODE) return t('nodesOutput');
    return this.session.registry.get(type)?.name ?? type;
  }

  private edit(build: (itemId: string) => Operation[], coalesce?: string) {
    const item = this.item;
    if (!item) return;
    const store = this.session.store;
    try {
      store.transaction(() => {
        if (!item.graph) store.dispatch(enableGraph(item.id, this.session.registry));
        for (const op of build(item.id)) store.dispatch(op, { coalesce });
      });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  private refresh() {
    if (!this.visible) return;
    const item = this.item;
    this.hint.hidden = !!item;
    this.canvas.hidden = !item;
    const types = [...this.session.registry.nodes(), ...this.session.registry.filters()];
    const templates = this.session.templates.list();
    if (this.addSelect.options.length !== types.length + templates.length + 1) {
      this.addSelect.replaceChildren(
        h('option', { value: '' }, t('nodesAdd')),
        ...types.map((d) => h('option', { value: d.id }, d.name)),
        ...templates.map((tpl) => h('option', { value: TEMPLATE_PREFIX + tpl.name }, t('nodesTemplate', { name: tpl.name }))),
      );
    }
    if (item && this.fitted !== item.id && this.canvas.clientWidth) {
      this.fitted = item.id;
      this.fit();
    }
    this.renderInspector(item);
    this.draw();
  }

  fit(): void {
    const item = this.item;
    if (!item) return;
    this.view = fitView(this.graph(item), this.canvas.clientWidth || 600, this.canvas.clientHeight || 220);
    this.draw();
  }

  private addNode(type: string) {
    const item = this.item;
    if (!item) return;
    const id = createId('fx');
    const graph = this.graph(item);
    const output = nodeById(graph, OUTPUT_ID);
    const position: [number, number] = output ? [output.position[0] - 60, output.position[1] + 90] : [0, 90];
    this.edit((itemId) => [addGraphNode(itemId, type, {}, position, id)]);
    this.selectedNode = id;
    this.reveal(position);
    this.refresh();
  }

  private freePosition(item: Item): [number, number] {
    const output = nodeById(this.graph(item), OUTPUT_ID);
    return output ? [output.position[0] - 60, output.position[1] + 90] : [0, 90];
  }

  private addTemplate(name: string) {
    const item = this.item;
    const template = this.session.templates.get(name);
    if (!item || !template) return;
    const position = this.freePosition(item);
    const placed = placeTemplate(item.id, template, position);
    this.edit(() => [placed.operation]);
    this.selectedNode = template.output ? placed.ids[template.output] : null;
    this.reveal(position);
    this.refresh();
  }

  private saveTemplate() {
    const item = this.item;
    const id = this.selectedNode;
    if (!item || !id || id === SOURCE_ID || id === OUTPUT_ID) {
      toast(t('nodesSelectToSave'), 'error');
      return;
    }
    const name = prompt(t('nodesTemplateName'), this.label(nodeById(this.graph(item), id)?.type ?? ''))?.trim();
    if (!name) return;
    this.session.templates.save(captureTemplate(item, evaluationOrder(this.graph(item), id), name));
    toast(t('nodesTemplateSaved', { name }));
    this.refresh();
  }

  private reveal([x, y]: readonly [number, number]) {
    const width = this.canvas.clientWidth || 600;
    const height = this.canvas.clientHeight || 300;
    const px = x * this.view.zoom + this.view.x;
    const py = y * this.view.zoom + this.view.y;
    const margin = 40;
    const dx = px < margin ? margin - px : px + 160 * this.view.zoom > width - margin ? width - margin - px - 160 * this.view.zoom : 0;
    const dy = py < margin ? margin - py : py + 80 * this.view.zoom > height - margin ? height - margin - py - 80 * this.view.zoom : 0;
    this.view = { ...this.view, x: this.view.x + dx, y: this.view.y + dy };
  }

  private deleteSelected() {
    const id = this.selectedNode;
    if (!id) return;
    this.edit((itemId) => [removeGraphNode(itemId, id)]);
    this.selectedNode = null;
    this.refresh();
  }

  private local(e: PointerEvent | WheelEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.focus();
    const p = this.local(e);
    const hit = hitTest(this.boxes, p.x, p.y, this.view.zoom);
    if (hit.kind === 'output') this.drag = { kind: 'link', from: hit.box.node.id, x: p.x, y: p.y };
    else if (hit.kind === 'input') {
      const link = this.item && this.graph(this.item).links.find((l) => l.to === hit.box.node.id && l.input === hit.input);
      if (link) {
        this.edit((itemId) => [disconnectInput(itemId, link.to, link.input)]);
        this.drag = { kind: 'link', from: link.from, x: p.x, y: p.y };
      }
    } else if (hit.kind === 'node') {
      this.selectedNode = hit.box.node.id;
      this.drag = { kind: 'node', id: hit.box.node.id, dx: p.x - hit.box.x, dy: p.y - hit.box.y, moved: false };
      this.refresh();
    } else {
      this.selectedNode = null;
      this.drag = { kind: 'pan', x0: p.x, y0: p.y, view: this.view };
      this.refresh();
    }
  }

  private move(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    const p = this.local(e);
    if (d.kind === 'pan') this.view = { ...d.view, x: d.view.x + p.x - d.x0, y: d.view.y + p.y - d.y0 };
    else if (d.kind === 'link') Object.assign(d, { x: p.x, y: p.y });
    else {
      d.moved = true;
      const position: [number, number] = [Math.round((p.x - d.dx - this.view.x) / this.view.zoom), Math.round((p.y - d.dy - this.view.y) / this.view.zoom)];
      this.edit((itemId) => [moveGraphNode(itemId, d.id, position)], `node-move:${d.id}`);
    }
    this.draw();
  }

  private up(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    if (d?.kind === 'link') {
      const p = this.local(e);
      const hit = hitTest(this.boxes, p.x, p.y, this.view.zoom);
      if (hit.kind === 'input' && hit.box.node.id !== d.from) this.edit((itemId) => [connectNodes(itemId, { from: d.from, to: hit.box.node.id, input: hit.input })]);
    }
    this.draw();
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const p = this.local(e);
    const zoom = Math.min(2.5, Math.max(0.25, this.view.zoom * Math.exp(-e.deltaY * 0.0015)));
    const k = zoom / this.view.zoom;
    this.view = { zoom, x: p.x - (p.x - this.view.x) * k, y: p.y - (p.y - this.view.y) * k };
    this.draw();
  }

  private announced = '';

  private announce(item: Item | null) {
    const target = this.visible && item && this.selectedNode ? { itemId: item.id, nodeId: this.selectedNode } : null;
    const key = target ? `${target.itemId}:${target.nodeId}` : '';
    if (key === this.announced) return;
    this.announced = key;
    this.emit('select', target);
  }

  get selected(): { itemId: string; nodeId: string } | null {
    const item = this.item;
    return this.visible && item && this.selectedNode ? { itemId: item.id, nodeId: this.selectedNode } : null;
  }

  private renderInspector(item: Item | null) {
    this.announce(item);
    const node = item && this.selectedNode ? nodeById(this.graph(item), this.selectedNode) : undefined;
    const key = node ? `${item!.id}:${node.id}:${node.enabled}` : '';
    if (key === this.inspectedKey && node) return;
    this.inspectedKey = key;
    if (!node || node.type === SOURCE_NODE || node.type === OUTPUT_NODE) {
      this.inspector.replaceChildren(h('p', { class: 'hint' }, node ? this.label(node.type) : t('nodesSelect')));
      return;
    }
    const def = this.session.registry.get(node.type);
    const params = def && def.kind !== 'transition' ? def.params : [];
    const enabled = h('input', { type: 'checkbox', id: 'node-enabled', checked: node.enabled });
    enabled.addEventListener('change', () => this.edit((itemId) => [setNodeEnabled(itemId, node.id, enabled.checked)]));
    this.inspector.replaceChildren(
      h('strong', {}, this.label(node.type)),
      h('label', { class: 'check' }, enabled, h('span', {}, t('nodesEnabled'))),
      new ParamControls(`node-${node.id}`, params, node.params, (name, value) =>
        this.edit((itemId) => [setNodeParams(itemId, node.id, { [name]: value })], `node:${node.id}:${name}`),
      ).element,
      ...(item!.kind === 'media'
        ? params
            .filter((p) => p.type === 'vec2')
            .map((p) => h('button', { class: 'btn small', dataset: { track: p.name }, onClick: () => this.onTrack(item!.id, { node: node.id, param: p.name }) }, t('trackPoint', { name: p.label ?? p.name })))
        : []),
      ...((QUALIFIER_TYPES as readonly string[]).includes(node.type)
        ? [
            h('button', { class: 'btn small', id: 'qualifier-pick', onClick: () => this.onPickColor(item!.id, node.id, false) }, t('qualifierPick')),
            ...(node.type === 'qualifier-3d' ? [h('button', { class: 'btn small', id: 'qualifier-add', onClick: () => this.onPickColor(item!.id, node.id, true) }, t('qualifierAdd'))] : []),
          ]
        : []),
    );
  }

  private color(name: string) {
    return this.style.getPropertyValue(name).trim();
  }

  draw(): void {
    if (this.queued || !this.visible) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.paint();
    });
  }

  private paint() {
    const canvas = this.canvas;
    const ratio = devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) [canvas.width, canvas.height] = [Math.round(width * ratio), Math.round(height * ratio)];
    const g = canvas.getContext('2d')!;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.fillStyle = this.color('--tl-bg');
    g.fillRect(0, 0, width, height);
    const item = this.item;
    if (!item) return;
    const graph = this.graph(item);
    this.boxes = graph.nodes.map((n) => layoutNode(n, this.inputsOf(n.type), n.type !== OUTPUT_NODE, this.view));
    const byId = new Map(this.boxes.map((b) => [b.node.id, b]));
    canvas.dataset.ports = JSON.stringify(Object.fromEntries(this.boxes.map((b) => [b.node.id, { type: b.node.type, output: b.output, inputs: b.inputs, center: [b.x + b.width / 2, b.y + 10] }])));
    g.lineWidth = 2;
    g.strokeStyle = this.color('--muted');
    for (const link of graph.links) {
      const from = byId.get(link.from)?.output;
      const to = byId.get(link.to)?.inputs.find((i) => i.name === link.input);
      if (from && to) this.curve(g, from.x, from.y, to.x, to.y);
    }
    const d = this.drag;
    if (d?.kind === 'link') {
      const from = byId.get(d.from)?.output;
      if (from) {
        g.strokeStyle = this.color('--accent');
        this.curve(g, from.x, from.y, d.x, d.y);
      }
    }
    const z = this.view.zoom;
    for (const box of this.boxes) {
      const selected = box.node.id === this.selectedNode;
      g.globalAlpha = box.node.enabled ? 1 : 0.5;
      g.fillStyle = this.color(box.node.type === SOURCE_NODE || box.node.type === OUTPUT_NODE ? '--clip-band' : '--clip');
      g.beginPath();
      g.roundRect(box.x, box.y, box.width, box.height, 6 * z);
      g.fill();
      const viewed = this.session.viewedNode?.itemId === item.id && this.session.viewedNode.nodeId === box.node.id;
      g.strokeStyle = this.color(selected || viewed ? '--accent' : '--line');
      g.lineWidth = selected || viewed ? 2 : 1;
      if (viewed) g.setLineDash([6, 3]);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = this.color('--fg');
      g.font = `600 ${Math.round(12 * z)}px "IBM Plex Sans", system-ui, sans-serif`;
      g.textBaseline = 'middle';
      g.fillText(this.label(box.node.type), box.x + 10 * z, box.y + 12 * z, box.width - 20 * z);
      g.font = `${Math.round(11 * z)}px "IBM Plex Sans", system-ui, sans-serif`;
      for (const input of box.inputs) {
        this.port(g, input.x, input.y);
        g.fillStyle = this.color('--muted');
        g.fillText(input.name, input.x + 10 * z, input.y);
      }
      if (box.output) this.port(g, box.output.x, box.output.y);
      g.globalAlpha = 1;
    }
  }

  private port(g: CanvasRenderingContext2D, x: number, y: number) {
    g.beginPath();
    g.arc(x, y, PORT_RADIUS * this.view.zoom, 0, Math.PI * 2);
    g.fillStyle = this.color('--accent');
    g.fill();
  }

  private curve(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
    const dx = Math.max(40, Math.abs(x1 - x0) / 2);
    g.beginPath();
    g.moveTo(x0, y0);
    g.bezierCurveTo(x0 + dx, y0, x1 - dx, y1, x1, y1);
    g.stroke();
  }
}
