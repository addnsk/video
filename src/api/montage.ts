import { PROPERTY, effectProperty } from '../core/animation';
import type { AssetMeta, Item, ParamValue, ParamValues, TextStyle, TrackKind, Transform } from '../core/model';
import { itemLength, type PresetPhase } from '../core/model';
import { ANIMATION_PRESETS, animationPreset } from '../core/presets';
import {
  addTrack,
  clearAnimation,
  clearTrack,
  copyEffects,
  deleteKeyframe,
  insertItem,
  insertText,
  moveItem,
  moveToTrack,
  removeItem,
  removeTrack,
  replaceEffect,
  setItemProps,
  setKeyframe,
  setTextStyle,
  setTrackMuted,
  setPreset,
  setSpeed,
  setTransition,
  setVolume,
  splitAt,
  trimItem,
  upsertEffect,
  type Operation,
} from '../core/operations';
import { findPlacement } from '../core/timeline';
import type { FramePoint } from '../core/tracking';
import { captureTemplate, placeTemplate, type NodeTemplate } from '../core/graph-templates';
import { trackPoint, type TrackRequest } from '../host/point-tracking';
import { createId } from '../core/ids';
import { placeTrack, projectDuration, type Placement } from '../core/timeline';
import { AUDIO_EFFECTS, audioEffect } from '../effects/audio/builtin';
import { parseCube } from '../effects/cube';
import { glTransition } from '../effects/gl-transitions';
import { defaultParams, type FilterDef, type NodeCategory, type ParamSpec } from '../effects/types';
import { OUTPUT_ID, materialize, nodeProperty } from '../core/graph';
import {
  addGraphNode,
  connectNodes,
  disableGraph,
  disconnectInput,
  enableGraph,
  moveGraphNode,
  removeGraphNode,
  setNodeEnabled,
  setNodeParams,
} from '../core/graph-operations';
import type { ExportSettings } from '../engine/export/exporter';
import type { LogSource } from '../core/log';
import type { EditorSession } from '../host/session';

export type ItemRef = string | number;
export type ItemTarget = ItemRef | 'all';

export interface ClipInfo {
  readonly id: string;
  readonly kind: Item['kind'];
  readonly track: string;
  readonly index: number;
  readonly assetId: string | null;
  readonly name: string;
  readonly start: number;
  readonly duration: number;
  readonly in: number;
  readonly out: number;
  readonly volume: number;
  readonly speed: number;
  readonly opacity: number;
  readonly transform: Transform;
  readonly text: TextStyle | null;
  readonly animations: Item['animations'];
  readonly presets: Item['presets'];
  readonly effects: readonly { type: string; params: ParamValues }[];
  readonly transition: { type: string; duration: number; params: ParamValues } | null;
}

export interface WheelValue {
  x?: number;
  y?: number;
  master?: number;
}

export type GradePatch = Partial<{
  inputTransform: 'none' | 'bmdFilmGen5';
  exposure: number;
  temperature: number;
  tint: number;
  contrast: number;
  pivot: number;
  saturation: number;
  lift: WheelValue | readonly number[];
  gamma: WheelValue | readonly number[];
  gain: WheelValue | readonly number[];
}>;

export interface TransitionOptions {
  type: string;
  duration?: number;
  params?: Record<string, ParamValue>;
}

export interface FilterRegistration {
  id: string;
  name: string;
  glsl: string;
  params?: ParamSpec[];
}

const WHEELS = ['lift', 'gamma', 'gain'] as const;

export function createMontageApi(session: EditorSession, onSelect: (id: string | null) => void = () => undefined) {
  const { store, registry, transport, luts } = session;

  const mainTrack = () => store.project.tracks.find((t) => t.id === session.videoTrackId)!;
  const placements = (): readonly Placement[] => placeTrack(mainTrack());

  const resolve = (ref: ItemRef): Placement => {
    const hit = typeof ref === 'number' ? placements().at(ref) : findPlacement(store.project, ref);
    if (!hit) throw new Error(`No clip ${JSON.stringify(ref)}`);
    return hit;
  };
  const targets = (target: ItemTarget): string[] =>
    target === 'all' ? placements().map((p) => p.item.id) : [resolve(target).item.id];

  const apply = (op: Operation, coalesce?: string) => store.dispatch(op, { coalesce });

  const describe = ({ item, index, start, fadeIn, track }: Placement): ClipInfo => ({
    id: item.id,
    kind: item.kind,
    track: track.id,
    index,
    assetId: item.kind === 'media' ? item.source.assetId : null,
    name: item.kind === 'media' ? (store.project.assets[item.source.assetId]?.name ?? '') : item.text.content,
    start,
    duration: itemLength(item),
    in: item.kind === 'media' ? item.source.in : 0,
    out: item.kind === 'media' ? item.source.out : item.duration,
    volume: item.volume,
    speed: item.kind === 'media' ? item.speed : 1,
    opacity: item.opacity,
    transform: item.transform,
    text: item.kind === 'text' ? item.text : null,
    animations: item.animations,
    presets: item.presets,
    effects: item.effects.map((e) => ({ type: e.type, params: e.params })),
    transition: item.transitionIn && { ...item.transitionIn, duration: fadeIn },
  });

  const currentGrade = (item: Item): ParamValues => {
    const def = registry.filter('grade')!;
    return { ...defaultParams(def.params), ...item.effects.find((e) => e.type === 'grade')?.params };
  };

  const gradeParams = (item: Item, patch: GradePatch): ParamValues => {
    const base = currentGrade(item);
    const out: Record<string, ParamValue> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if ((WHEELS as readonly string[]).includes(key)) {
        const prev = (base[key] as readonly number[]) ?? [0, 0, 0];
        out[key] = Array.isArray(value)
          ? (value as number[]).slice(0, 3)
          : [(value as WheelValue).x ?? prev[0], (value as WheelValue).y ?? prev[1], (value as WheelValue).master ?? prev[2]];
      } else out[key] = value as ParamValue;
    }
    return out;
  };

  const api = {
    version: '0.3.0',

    get duration() {
      return projectDuration(store.project);
    },
    get fps() {
      return store.project.settings?.fps ?? 25;
    },
    get size() {
      const s = store.project.settings;
      return s ? { width: s.width, height: s.height } : null;
    },
    get time() {
      return transport.time;
    },
    get rate() {
      return transport.rate;
    },

    assets: (): AssetMeta[] => Object.values(store.project.assets),
    clips: (trackId?: string): ClipInfo[] => {
      const track = trackId ? store.project.tracks.find((t) => t.id === trackId) : mainTrack();
      if (!track) throw new Error(`No track ${trackId}`);
      return placeTrack(track).map(describe);
    },
    select: (ref: ItemRef | null) => onSelect(ref === null ? null : resolve(ref).item.id),
    tracks: () => store.project.tracks.map((t) => ({ id: t.id, kind: t.kind, magnetic: t.magnetic, muted: t.muted, items: t.items.length })),
    addTrack: (kind: TrackKind) => {
      const before = new Set(store.project.tracks.map((t) => t.id));
      apply(addTrack(kind));
      return store.project.tracks.find((t) => !before.has(t.id))!.id;
    },
    removeTrack: (trackId: string) => void apply(removeTrack(trackId)),
    muteTrack: (trackId: string, muted = true) => void apply(setTrackMuted(trackId, muted)),
    clip: (ref: ItemRef): ClipInfo => describe(resolve(ref)),

    async import(source: File | Blob | string, name?: string): Promise<AssetMeta> {
      let file: File;
      if (typeof source === 'string') {
        const response = await fetch(source);
        if (!response.ok) throw new Error(`Download failed (${response.status}): ${source}`);
        file = new File([await response.blob()], name ?? source.split('/').pop() ?? 'media');
      } else file = source instanceof File ? source : new File([source], name ?? 'media');
      return session.importFile(file);
    },

    add(assetId: string, options: { in?: number; out?: number; index?: number; track?: string; start?: number } = {}): ClipInfo {
      const id = createId('item');
      apply(insertItem(assetId, { ...options, trackId: options.track ?? session.videoTrackId, id }));
      return describe(resolve(id));
    },
    title(content: string, options: { start?: number; duration?: number; track?: string } & Partial<Omit<TextStyle, 'content'>> = {}): ClipInfo {
      const { start, duration, track, ...style } = options;
      const id = createId('item');
      const trackId = track ?? store.project.tracks.find((t) => t.kind === 'video' && !t.magnetic)?.id ?? api.addTrack('video');
      apply(insertText(trackId, start ?? transport.time, duration ?? 3, { ...style, content }, id));
      return describe(resolve(id));
    },
    setText: (ref: ItemRef, style: Partial<TextStyle>) => void apply(setTextStyle(resolve(ref).item.id, style)),
    place: (ref: ItemRef, trackId: string, start?: number) => void apply(moveToTrack(resolve(ref).item.id, trackId, { start })),
    set: (target: ItemTarget, props: { volume?: number; opacity?: number; transform?: Partial<Transform> }) =>
      void store.transaction(() => {
        for (const id of targets(target)) apply(setItemProps(id, props));
      }),
    keyframe(ref: ItemRef, property: string, time: number, value: number) {
      apply(setKeyframe(resolve(ref).item.id, PROPERTY[property as keyof typeof PROPERTY] ?? property, time, value));
    },
    removeKeyframe(ref: ItemRef, property: string, time: number) {
      apply(deleteKeyframe(resolve(ref).item.id, PROPERTY[property as keyof typeof PROPERTY] ?? property, time));
    },
    clearKeyframes(ref: ItemRef, property: string) {
      apply(clearAnimation(resolve(ref).item.id, PROPERTY[property as keyof typeof PROPERTY] ?? property));
    },
    effectProperty,
    animate(ref: ItemRef, phase: PresetPhase, presetId: string | null) {
      const preset = presetId ? animationPreset(presetId) : null;
      if (presetId && preset?.phase !== phase) {
        const known = ANIMATION_PRESETS.filter((p) => p.phase === phase).map((p) => p.id).join(', ');
        throw new Error(`Unknown ${phase} animation "${presetId}". Available: ${known}`);
      }
      apply(setPreset(resolve(ref).item.id, phase, presetId));
    },
    animationPresets: () => ANIMATION_PRESETS.map(({ id, name, phase, duration }) => ({ id, name, phase, duration })),
    split(time: number): ClipInfo | null {
      const id = createId('item');
      apply(splitAt(time, session.videoTrackId, id));
      return placements().some((p) => p.item.id === id) ? describe(resolve(id)) : null;
    },
    trim: (ref: ItemRef, range: { in?: number; out?: number }) => void apply(trimItem(resolve(ref).item.id, range)),
    move: (ref: ItemRef, index: number) => void apply(moveItem(resolve(ref).item.id, index)),
    remove: (ref: ItemRef) => void apply(removeItem(resolve(ref).item.id)),
    speed: (target: ItemTarget, value: number) =>
      void store.transaction(() => {
        for (const id of targets(target)) apply(setSpeed(id, value));
      }),
    volume: (target: ItemTarget, value: number) => {
      for (const id of targets(target)) apply(setVolume(id, value), `volume:${id}`);
    },
    clear: () => void apply(clearTrack(session.videoTrackId)),

    grade(target: ItemTarget, patch: GradePatch) {
      void store.transaction(() => {
        for (const id of targets(target)) apply(upsertEffect(id, 'grade', gradeParams(resolve(id).item, patch)));
      });
    },
    resetGrade(target: ItemTarget) {
      void store.transaction(() => {
        for (const id of targets(target)) apply(replaceEffect(id, 'grade', null));
      });
    },
    copyGrade: (from: ItemRef, to: ItemRef[] | 'all') =>
      void apply(copyEffects(resolve(from).item.id, to === 'all' ? targets('all') : to.map((r) => resolve(r).item.id))),

    async lut(target: ItemTarget, source: string | File, strength = 1) {
      let text: string;
      let name = 'LUT';
      if (source instanceof File) [text, name] = [await source.text(), source.name];
      else if (/LUT_3D_SIZE/.test(source)) text = source;
      else {
        const response = await fetch(source);
        if (!response.ok) throw new Error(`Download failed (${response.status}): ${source}`);
        [text, name] = [await response.text(), source.split('/').pop() ?? name];
      }
      const entry = luts.add(name, parseCube(text));
      await store.transaction(() => {
        for (const id of targets(target)) apply(replaceEffect(id, 'lut', { table: entry.id, strength }));
      });
      return entry.id;
    },

    effect(target: ItemTarget, type: string, params: Record<string, ParamValue> | null) {
      if (params && !registry.filter(type)) throw new Error(`Unknown effect "${type}"`);
      void store.transaction(() => {
        for (const id of targets(target)) apply(params ? upsertEffect(id, type, params) : replaceEffect(id, type, null));
      });
    },

    audioEffect(target: ItemTarget, type: string, params: Record<string, number> | null) {
      if (!audioEffect(type)) throw new Error(`Unknown audio effect "${type}". Available: ${AUDIO_EFFECTS.map((d) => d.id).join(', ')}`);
      store.transaction(() => {
        for (const id of targets(target)) apply(params ? upsertEffect(id, type, params) : replaceEffect(id, type, null));
      });
    },
    audioEffects: () => AUDIO_EFFECTS.map(({ id, name, params }) => ({ id, name, params })),

    effects: {
      register(def: FilterRegistration) {
        const filter: FilterDef = { kind: 'filter', id: def.id, name: def.name, glsl: def.glsl, params: def.params ?? [] };
        registry.register(filter);
      },
      list: () => registry.filters().map(({ id, name, params }) => ({ id, name, params })),
    },

    track: (ref: ItemRef, request: TrackRequest): Promise<FramePoint[]> => trackPoint(session, resolve(ref).item.id, request),
    graph: {
      enable: (ref: ItemRef) => void apply(enableGraph(resolve(ref).item.id, registry)),
      disable: (ref: ItemRef) => void apply(disableGraph(resolve(ref).item.id)),
      get(ref: ItemRef) {
        const { item } = resolve(ref);
        const graph = materialize(item.effects, item.graph, (t) => registry.stageOf(t), (t) => registry.isVisual(t));
        return { editable: !!item.graph, nodes: graph.nodes, links: graph.links };
      },
      add(ref: ItemRef, type: string, params: Record<string, ParamValue> = {}, position?: [number, number]): string {
        if (!registry.isVisual(type)) throw new Error(`Unknown node "${type}". Available: ${[...registry.nodes(), ...registry.filters()].map((d) => d.id).join(', ')}`);
        const itemId = resolve(ref).item.id;
        const id = createId('fx');
        void store.transaction(() => {
          apply(enableGraph(itemId, registry));
          const { item } = resolve(itemId);
          const existing = materialize(item.effects, item.graph, (t) => registry.stageOf(t), (t) => registry.isVisual(t)).nodes;
          const free = (): [number, number] => {
            const row = existing.filter((n) => n.position[1] >= 150);
            return [row.length ? Math.max(...row.map((n) => n.position[0])) + 180 : 0, 200];
          };
          apply(addGraphNode(itemId, type, params, position ?? free(), id));
        });
        return id;
      },
      connect: (ref: ItemRef, from: string, to: string, input = 'source') =>
        void apply(connectNodes(resolve(ref).item.id, { from, to, input: to === OUTPUT_ID ? 'input' : input })),
      disconnect: (ref: ItemRef, to: string, input = 'source') => void apply(disconnectInput(resolve(ref).item.id, to, to === OUTPUT_ID ? 'input' : input)),
      remove: (ref: ItemRef, nodeId: string) => void apply(removeGraphNode(resolve(ref).item.id, nodeId)),
      set: (ref: ItemRef, nodeId: string, params: Record<string, ParamValue>) => void apply(setNodeParams(resolve(ref).item.id, nodeId, params), `node:${nodeId}`),
      toggle: (ref: ItemRef, nodeId: string, enabled: boolean) => void apply(setNodeEnabled(resolve(ref).item.id, nodeId, enabled)),
      view: (ref: ItemRef | null, nodeId: string | null = null) =>
        session.viewNode(ref === null || nodeId === null ? null : { itemId: resolve(ref).item.id, nodeId }),
      move: (ref: ItemRef, nodeId: string, position: [number, number]) => void apply(moveGraphNode(resolve(ref).item.id, nodeId, position)),
      keyframe: (ref: ItemRef, nodeId: string, param: string, time: number, value: number) =>
        void apply(setKeyframe(resolve(ref).item.id, nodeProperty(nodeId, param), time, value)),
      template: (ref: ItemRef, nodeIds: string[], name = 'Template'): NodeTemplate => captureTemplate(resolve(ref).item, nodeIds, name),
      insert(ref: ItemRef, template: NodeTemplate | string, options: { position?: [number, number]; source?: string } = {}): Record<string, string> {
        const found = typeof template === 'string' ? session.templates.get(template) : template;
        if (!found) throw new Error(`No template "${String(template)}". Saved: ${session.templates.list().map((t) => t.name).join(', ')}`);
        const unknown = found.nodes.find((n) => !registry.isVisual(n.type));
        if (unknown) throw new Error(`Unknown node "${unknown.type}" in template "${found.name}"`);
        const itemId = resolve(ref).item.id;
        let ids: Record<string, string> = {};
        void store.transaction(() => {
          apply(enableGraph(itemId, registry));
          const placed = placeTemplate(itemId, found, options.position ?? [0, 320], options.source);
          ids = { ...placed.ids };
          apply(placed.operation);
        });
        return found.output ? { ...ids, output: ids[found.output] } : ids;
      },
      types: () =>
        [...registry.nodes(), ...registry.filters()].map((d) => ({
          id: d.id,
          name: d.name,
          category: d.kind === 'node' ? d.category : 'color',
          inputs: registry.inputsOf(d.id) ?? [],
          params: d.params,
        })),
    },

    templates: {
      save: (template: NodeTemplate) => session.templates.save(template),
      list: () => session.templates.list().map((t) => ({ name: t.name, nodes: t.nodes.length })),
      get: (name: string) => session.templates.get(name) ?? null,
      remove: (name: string) => session.templates.remove(name),
    },

    nodes: {
      register(def: { id: string; name: string; category?: NodeCategory; inputs?: string[]; params?: ParamSpec[]; passes: string[] | string; raster?: 'text'; temporal?: boolean }) {
        registry.register({
          kind: 'node',
          id: def.id,
          name: def.name,
          category: def.category ?? 'stylize',
          inputs: (def.inputs ?? ['source']).map((name) => ({ name })),
          params: def.params ?? [],
          passes: (Array.isArray(def.passes) ? def.passes : [def.passes]).map((glsl) => ({ glsl })),
          ...(def.raster ? { raster: def.raster } : {}),
          ...(def.temporal ? { temporal: true } : {}),
        });
      },
    },

    transitions: {
      register(def: { id: string; name: string; glsl: string }) {
        registry.register(glTransition(def.id, def.name, def.glsl));
      },
      list: () => registry.transitions().map(({ id, name, params }) => ({ id, name, params })),
    },

    transition(ref: ItemRef, options: TransitionOptions | null) {
      if (options && !registry.transition(options.type)) {
        const known = registry.transitions().map((t) => t.id).join(', ');
        throw new Error(`Unknown transition "${options.type}". Available: ${known}`);
      }
      apply(
        setTransition(
          resolve(ref).item.id,
          options && { type: options.type, duration: options.duration ?? 1, params: { ...options.params } },
        ),
      );
    },

    seek: (time: number) => transport.seek(time),
    play: (rate = 1) => transport.play(rate),
    pause: () => transport.pause(),
    levels: () => transport.levels(),

    undo: () => store.undo(),
    redo: () => store.redo(),
    batch: <T>(fn: () => T | Promise<T>) => store.transaction(fn),

    render: (settings: Partial<ExportSettings> & { onProgress?: (f: number) => void } = {}) =>
      session.exportVideo(
        { height: settings.height ?? null, quality: settings.quality ?? 'high', prores: settings.prores ?? null, dynamicRange: settings.dynamicRange ?? 'sdr' },
        settings.onProgress ?? (() => undefined),
        { canceled: false },
      ),

    proxy: (assetId: string) => session.requestProxy(assetId),
    proxies: () => Object.fromEntries(session.proxies),
    stats: () => session.engine.remote.stats(),
    resetMetrics: () => session.engine.remote.resetMetrics(),
    platform: () => session.platform(),
    diagnostics: {
      entries: () => session.log.entries(),
      clear: () => session.log.clear(),
      warn: (message: string) => void session.log.record('warning', 'script', message),
      error: (source: LogSource, error: unknown) => void session.log.error(source, error),
    },
    onChange: (fn: () => void) => store.on('change', fn),
  };
  return api;
}

export type MontageApi = ReturnType<typeof createMontageApi>;

type ScriptFn = (montage: MontageApi, log: (...a: unknown[]) => void) => Promise<unknown>;

export async function runScript(code: string, api: MontageApi, log: (...args: unknown[]) => void): Promise<unknown> {
  let fn: ScriptFn;
  try {
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...a: string[]) => ScriptFn;
    fn = new AsyncFunction('montage', 'log', code);
  } catch (e) {
    if (e instanceof SyntaxError) {
      api.diagnostics.error('script', e);
      throw e;
    }
    const url = URL.createObjectURL(new Blob([`export default async (montage, log) => {\n${code}\n}`], { type: 'text/javascript' }));
    try {
      fn = (await import(url)).default;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  try {
    return await api.batch(() => fn(api, log));
  } catch (e) {
    api.diagnostics.error('script', e);
    throw e;
  }
}
