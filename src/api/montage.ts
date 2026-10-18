import type { AssetMeta, Item, ParamValue, ParamValues } from '../core/model';
import { itemLength } from '../core/model';
import {
  clearTrack,
  copyEffects,
  insertItem,
  moveItem,
  removeItem,
  replaceEffect,
  setTransition,
  setVolume,
  splitAt,
  trimItem,
  upsertEffect,
  type Operation,
} from '../core/operations';
import { createId } from '../core/ids';
import { placeTrack, projectDuration, type Placement } from '../core/timeline';
import { parseCube } from '../effects/cube';
import { glTransition } from '../effects/gl-transitions';
import { defaultParams, type FilterDef, type ParamSpec } from '../effects/types';
import type { ExportSettings } from '../engine/export/exporter';
import type { EditorSession } from '../host/session';

export type ItemRef = string | number;
export type ItemTarget = ItemRef | 'all';

export interface ClipInfo {
  readonly id: string;
  readonly index: number;
  readonly assetId: string;
  readonly name: string;
  readonly start: number;
  readonly duration: number;
  readonly in: number;
  readonly out: number;
  readonly volume: number;
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

export function createMontageApi(session: EditorSession) {
  const { store, registry, transport, luts } = session;

  const mainTrack = () => store.project.tracks.find((t) => t.id === session.videoTrackId)!;
  const placements = (): readonly Placement[] => placeTrack(mainTrack());

  const resolve = (ref: ItemRef): Placement => {
    const list = placements();
    const hit = typeof ref === 'number' ? list.at(ref) : list.find((p) => p.item.id === ref);
    if (!hit) throw new Error(`No clip ${JSON.stringify(ref)}`);
    return hit;
  };
  const targets = (target: ItemTarget): string[] =>
    target === 'all' ? placements().map((p) => p.item.id) : [resolve(target).item.id];

  const apply = (op: Operation, coalesce?: string) => store.dispatch(op, { coalesce });

  const describe = ({ item, index, start, fadeIn }: Placement): ClipInfo => ({
    id: item.id,
    index,
    assetId: item.source.assetId,
    name: store.project.assets[item.source.assetId]?.name ?? '',
    start,
    duration: itemLength(item),
    in: item.source.in,
    out: item.source.out,
    volume: item.volume,
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

    assets: (): AssetMeta[] => Object.values(store.project.assets),
    clips: (): ClipInfo[] => placements().map(describe),
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

    add(assetId: string, options: { in?: number; out?: number; index?: number } = {}): ClipInfo {
      const id = createId('item');
      apply(insertItem(assetId, { ...options, trackId: session.videoTrackId, id }));
      return describe(resolve(id));
    },
    split(time: number): ClipInfo | null {
      const id = createId('item');
      apply(splitAt(time, session.videoTrackId, id));
      return placements().some((p) => p.item.id === id) ? describe(resolve(id)) : null;
    },
    trim: (ref: ItemRef, range: { in?: number; out?: number }) => void apply(trimItem(resolve(ref).item.id, range)),
    move: (ref: ItemRef, index: number) => void apply(moveItem(resolve(ref).item.id, index)),
    remove: (ref: ItemRef) => void apply(removeItem(resolve(ref).item.id)),
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

    effects: {
      register(def: FilterRegistration) {
        const filter: FilterDef = { kind: 'filter', id: def.id, name: def.name, glsl: def.glsl, params: def.params ?? [] };
        registry.register(filter);
      },
      list: () => registry.filters().map(({ id, name, params }) => ({ id, name, params })),
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
    play: () => transport.play(),
    pause: () => transport.pause(),

    undo: () => store.undo(),
    redo: () => store.redo(),
    batch: <T>(fn: () => T | Promise<T>) => store.transaction(fn),

    render: (settings: Partial<ExportSettings> & { onProgress?: (f: number) => void } = {}) =>
      session.exportVideo(
        { height: settings.height ?? null, quality: settings.quality ?? 'high' },
        settings.onProgress ?? (() => undefined),
        { canceled: false },
      ),

    proxy: (assetId: string) => session.requestProxy(assetId),
    proxies: () => Object.fromEntries(session.proxies),
    stats: () => session.engine.remote.stats(),
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
    if (e instanceof SyntaxError) throw e;
    const url = URL.createObjectURL(new Blob([`export default async (montage, log) => {\n${code}\n}`], { type: 'text/javascript' }));
    try {
      fn = (await import(url)).default;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return api.batch(() => fn(api, log));
}
