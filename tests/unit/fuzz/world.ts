import fc from 'fast-check';
import { PROPERTY } from '../../../src/core/animation';
import { DEFAULT_VERSION, addStill, applyGrade, captureGrade, loadGradeVersion, removeGradeVersion, removeStill, saveGradeVersion } from '../../../src/core/grades';
import { OUTPUT_ID, SOURCE_ID, materialize, nodeProperty } from '../../../src/core/graph';
import { addGraphNode, connectNodes, disableGraph, disconnectInput, enableGraph, moveGraphNode, removeGraphNode, setNodeEnabled, setNodeParams } from '../../../src/core/graph-operations';
import { captureTemplate, placeTemplate } from '../../../src/core/graph-templates';
import type { AssetMeta, Item, Project } from '../../../src/core/model';
import { emptyProject, itemLength } from '../../../src/core/model';
import {
  addAsset,
  addTrack,
  clearAnimation,
  copyEffects,
  deleteKeyframe,
  insertItem,
  insertText,
  moveItem,
  moveToTrack,
  removeItem,
  removeTrack,
  replaceEffect,
  setAssetColorSpace,
  setColorScience,
  setDuration,
  setItemProps,
  setKeyframe,
  setPreset,
  setSpeed,
  setTextStyle,
  setTrackMuted,
  setTransition,
  splitAt,
  trimItem,
  upsertEffect,
  type Operation,
} from '../../../src/core/operations';
import { Store } from '../../../src/core/store';
import { findPlacement, projectDuration } from '../../../src/core/timeline';
import { registerBuiltins } from '../../../src/effects/builtin';
import { EffectRegistry } from '../../../src/effects/registry';

export const registry = new EffectRegistry();
registerBuiltins(registry);
export const graphContext = registry;

const asset = (id: string, end: number, fps: number, video = true, audio = true): AssetMeta => ({
  id,
  name: `${id}.mov`,
  size: 1,
  lastModified: 0,
  codec: video ? 'ProRes' : 'PCM',
  width: video ? 1920 : 0,
  height: video ? 1080 : 0,
  fps: video ? fps : 0,
  start: 0,
  end,
  hasVideo: video,
  hasAudio: audio,
  sampleRate: audio ? 48000 : 0,
  channels: audio ? 2 : 0,
});

export const ASSETS = [asset('a', 6, 25), asset('b', 3.2, 29.97), asset('c', 10, 24, true, false), asset('m', 8, 0, false, true)];

export function initialProject(): Project {
  let project: Project = { ...emptyProject(), settings: { width: 1920, height: 1080, fps: 25, sampleRate: 48000 } };
  for (const a of ASSETS) project = addAsset(a)(project);
  return project;
}

export const items = (p: Project): Item[] => p.tracks.flatMap((t) => t.items);
const pick = <T>(list: readonly T[], k: number): T | undefined => (list.length ? list[Math.abs(k) % list.length] : undefined);

const NODE_TYPES = ['blur', 'merge', 'transform', 'invert', 'grade', 'curves', 'ellipse-mask', 'bezier-mask', 'text', 'denoise', 'temporal-denoise', 'qualifier', 'parallel-mixer', 'mask-combine', 'noise', 'letterbox', 'corner-pin'];
const PATHS = [PROPERTY.opacity, PROPERTY.x, PROPERTY.y, PROPERTY.scale, PROPERTY.rotation, PROPERTY.volume];
const SPACES = ['rec709', 'slog3', 'logc3', 'bmdFilmGen5', 'rec2020Pq'];

const k = fc.integer({ min: 0, max: 1000 });
const unit = fc.double({ min: 0, max: 1, noNaN: true });

export const action = fc.oneof(
  { weight: 10, arbitrary: fc.record({ kind: fc.constant('insert' as const), asset: k, track: k, at: unit, span: unit }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('text' as const), track: k, at: unit, length: unit }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('remove' as const), item: k }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('move' as const), item: k, index: k }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('moveTrack' as const), item: k, track: k, at: unit }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('trim' as const), item: k, a: unit, b: unit }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('split' as const), track: k, at: unit }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('speed' as const), item: k, speed: fc.constantFrom(0.1, 0.25, 0.5, 1, 1.5, 2, 3.7, 16) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('duration' as const), item: k, length: unit }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('transition' as const), item: k, length: unit, none: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('props' as const), item: k, opacity: unit, x: unit, scale: unit }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('keyframe' as const), item: k, path: k, t: unit, v: unit }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('deleteKey' as const), item: k, path: k, which: k }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('clearAnim' as const), item: k, path: k }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('preset' as const), item: k, phase: fc.constantFrom('in' as const, 'out' as const, 'whole' as const), id: fc.constantFrom('fade', 'pop', 'slideUp', null) }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('grade' as const), item: k, exposure: unit }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('curves' as const), item: k, y: unit }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('removeEffect' as const), item: k, type: fc.constantFrom('grade', 'curves', 'hdr-wheels') }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('copyGrade' as const), from: k, to: k }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('addTrack' as const), audio: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('removeTrack' as const), track: k }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('mute' as const), track: k, muted: fc.boolean() }) },
  { weight: 6, arbitrary: fc.record({ kind: fc.constant('enableGraph' as const), item: k }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('disableGraph' as const), item: k }) },
  { weight: 10, arbitrary: fc.record({ kind: fc.constant('addNode' as const), item: k, type: k }) },
  { weight: 12, arbitrary: fc.record({ kind: fc.constant('connect' as const), item: k, from: k, to: k, input: k }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('disconnect' as const), item: k, to: k, input: k }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('removeNode' as const), item: k, node: k }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('nodeParams' as const), item: k, node: k, v: unit }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('nodeEnabled' as const), item: k, node: k, on: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('nodeMove' as const), item: k, node: k, x: unit, y: unit }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('nodeKey' as const), item: k, node: k, t: unit, v: unit }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('saveVersion' as const), item: k, name: fc.constantFrom('A', 'B', 'C') }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('loadVersion' as const), item: k, name: fc.constantFrom('A', 'B', 'C', DEFAULT_VERSION) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('removeVersion' as const), item: k, name: fc.constantFrom('A', 'B', 'C') }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('template' as const), from: k, to: k, nodes: k }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('applyGrade' as const), from: k, to: k }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('science' as const), aces: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('space' as const), asset: k, space: k }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('still' as const), item: k }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('removeStill' as const), which: k }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('textStyle' as const), item: k, size: unit }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('undo' as const) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('redo' as const) }) },
);

export type Action = typeof action extends fc.Arbitrary<infer T> ? T : never;

const graphNodes = (item: Item) => materialize(item.effects, item.graph, registry).nodes;

let stillCounter = 0;

export function toOperation(project: Project, a: Action): Operation | 'undo' | 'redo' | null {
  const all = items(project);
  const item = 'item' in a ? pick(all, a.item) : undefined;
  const track = 'track' in a ? pick(project.tracks, a.track) : undefined;
  const duration = Math.max(1, projectDuration(project));
  switch (a.kind) {
    case 'undo':
    case 'redo':
      return a.kind;
    case 'insert': {
      const asset = pick(ASSETS, a.asset)!;
      if (!track) return null;
      const from = a.span * asset.end * 0.8;
      return insertItem(asset.id, { trackId: track.id, in: from, out: Math.min(asset.end, from + 0.2 + a.span * asset.end), start: a.at * duration });
    }
    case 'text':
      return track ? insertText(track.id, a.at * duration, 0.2 + a.length * 4) : null;
    case 'remove':
      return item ? removeItem(item.id) : null;
    case 'move':
      return item ? moveItem(item.id, a.index % 8) : null;
    case 'moveTrack':
      return item && track ? moveToTrack(item.id, track.id, { start: a.at * duration }) : null;
    case 'trim': {
      if (item?.kind !== 'media') return null;
      const asset = project.assets[item.source.assetId];
      const [lo, hi] = [Math.min(a.a, a.b), Math.max(a.a, a.b)];
      return trimItem(item.id, { in: lo * asset.end, out: hi * asset.end });
    }
    case 'split':
      return track ? splitAt(a.at * duration, track.id) : null;
    case 'speed':
      return item ? setSpeed(item.id, a.speed) : null;
    case 'duration':
      return item ? setDuration(item.id, 0.1 + a.length * 5) : null;
    case 'transition':
      return item ? setTransition(item.id, a.none ? null : { type: 'dissolve', duration: 0.1 + a.length * 2, params: {} }) : null;
    case 'props':
      return item ? setItemProps(item.id, { opacity: a.opacity, transform: { x: a.x - 0.5, scale: 0.2 + a.scale * 2 } }) : null;
    case 'keyframe':
      return item ? setKeyframe(item.id, pick(PATHS, a.path)!, a.t * itemLength(item), a.v) : null;
    case 'deleteKey': {
      if (!item) return null;
      const path = pick(Object.keys(item.animations), a.path);
      const key = path ? pick(item.animations[path], a.which) : undefined;
      return path && key ? deleteKeyframe(item.id, path, key.t) : null;
    }
    case 'clearAnim': {
      const path = item ? pick(Object.keys(item.animations), a.path) : undefined;
      return item && path ? clearAnimation(item.id, path) : null;
    }
    case 'preset':
      return item ? setPreset(item.id, a.phase, a.id) : null;
    case 'grade':
      return item ? upsertEffect(item.id, 'grade', { exposure: a.exposure * 2 - 1 }) : null;
    case 'curves':
      return item ? upsertEffect(item.id, 'curves', { master: [0, 0, 1, a.y] }) : null;
    case 'removeEffect':
      return item ? replaceEffect(item.id, a.type, null) : null;
    case 'copyGrade': {
      const [from, to] = [pick(all, a.from), pick(all, a.to)];
      return from && to ? copyEffects(from.id, [to.id]) : null;
    }
    case 'addTrack':
      return addTrack(a.audio ? 'audio' : 'video');
    case 'removeTrack':
      return track ? removeTrack(track.id) : null;
    case 'mute':
      return track ? setTrackMuted(track.id, a.muted) : null;
    case 'enableGraph':
      return item ? enableGraph(item.id, graphContext) : null;
    case 'disableGraph':
      return item ? disableGraph(item.id) : null;
    case 'addNode':
      return item?.graph ? addGraphNode(item.id, pick(NODE_TYPES, a.type)!, {}, [a.type % 500, a.type % 300]) : null;
    case 'connect': {
      if (!item?.graph) return null;
      const nodes = graphNodes(item);
      const from = pick(nodes.filter((n) => n.id !== OUTPUT_ID), a.from);
      const to = pick(nodes.filter((n) => n.id !== SOURCE_ID), a.to);
      if (!from || !to) return null;
      const inputs = to.id === OUTPUT_ID ? ['input'] : (registry.inputsOf(to.type) ?? []);
      const input = pick(inputs, a.input);
      return input ? connectNodes(item.id, { from: from.id, to: to.id, input }) : null;
    }
    case 'disconnect': {
      const link = item?.graph ? pick(item.graph.links, a.to) : undefined;
      return item && link ? disconnectInput(item.id, link.to, link.input) : null;
    }
    case 'removeNode': {
      const node = item?.graph ? pick(item.effects, a.node) : undefined;
      return item && node ? removeGraphNode(item.id, node.id) : null;
    }
    case 'nodeParams': {
      const node = item ? pick(item.effects, a.node) : undefined;
      const spec = node ? registry.get(node.type)?.params.find((p) => p.type === 'float') : undefined;
      return item && node && spec ? setNodeParams(item.id, node.id, { [spec.name]: a.v }) : null;
    }
    case 'nodeEnabled': {
      const node = item ? pick(item.effects, a.node) : undefined;
      return item && node ? setNodeEnabled(item.id, node.id, a.on) : null;
    }
    case 'nodeMove': {
      const node = item?.graph ? pick(item.effects, a.node) : undefined;
      return item && node ? moveGraphNode(item.id, node.id, [a.x * 800, a.y * 400]) : null;
    }
    case 'nodeKey': {
      const node = item ? pick(item.effects, a.node) : undefined;
      const spec = node ? registry.get(node.type)?.params.find((p) => p.type === 'float') : undefined;
      return item && node && spec ? setKeyframe(item.id, nodeProperty(node.id, spec.name), a.t * itemLength(item), a.v) : null;
    }
    case 'saveVersion':
      return item ? saveGradeVersion(item.id, a.name) : null;
    case 'loadVersion':
      return item ? loadGradeVersion(item.id, a.name) : null;
    case 'removeVersion':
      return item ? removeGradeVersion(item.id, a.name) : null;
    case 'template': {
      const [from, to] = [pick(all, a.from), pick(all, a.to)];
      if (!from || !to?.graph || !from.effects.length) return null;
      const ids = from.effects.filter((_, i) => (a.nodes >> i) & 1).map((e) => e.id);
      if (!ids.length) return null;
      return placeTemplate(to.id, captureTemplate(from, ids, 'T'), [10, 10], SOURCE_ID).operation;
    }
    case 'applyGrade': {
      const [from, to] = [pick(all, a.from), pick(all, a.to)];
      return from && to ? applyGrade(to.id, captureGrade(from)) : null;
    }
    case 'science':
      return setColorScience(a.aces ? 'aces' : 'display');
    case 'space':
      return setAssetColorSpace(pick(ASSETS, a.asset)!.id, pick(SPACES, a.space)!);
    case 'still':
      return item ? addStill({ id: `still_${stillCounter++}`, name: 'S', time: 0, image: 'data:', grade: captureGrade(item) }) : null;
    case 'removeStill': {
      const still = pick(project.stills ?? [], a.which);
      return still ? removeStill(still.id) : null;
    }
    case 'textStyle':
      return item?.kind === 'text' ? setTextStyle(item.id, { size: 0.02 + a.size * 0.2 }) : null;
  }
}

export interface Outcome {
  readonly store: Store;
  readonly applied: number;
  readonly thrown: string[];
}

export function run(actions: readonly Action[], check?: (project: Project, a: Action) => void): Outcome {
  const store = new Store(initialProject());
  const thrown: string[] = [];
  let applied = 0;
  for (const a of actions) {
    const op = toOperation(store.project, a);
    if (!op) continue;
    if (op === 'undo') store.undo();
    else if (op === 'redo') store.redo();
    else {
      const before = store.project;
      try {
        store.dispatch(op);
        applied++;
      } catch (e) {
        thrown.push(`${a.kind}: ${(e as Error).message}`);
        if (store.project !== before) throw new Error(`${a.kind} threw after changing the project`);
      }
    }
    check?.(store.project, a);
  }
  return { store, applied, thrown };
}

export { findPlacement };
