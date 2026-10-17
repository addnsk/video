// Публичный API редактора: window.montage в консоли браузера и панель «Скрипт».
// Всё, что можно сделать мышью, можно сделать отсюда.

import type { Project, Clip, Asset } from './project';
import type { Player } from './player';
import { type Grade, type Wheel, defaultGrade, cloneGrade, parseCube } from './grade';
import { registerTransition, listTransitions, getTransition, type TransitionDef } from './transitions';
import { exportProject, type ExportOptions } from './exporter';
import { loadAsset } from './media';

export interface ClipInfo {
  id: string;
  assetId: string;
  name: string;
  index: number;
  start: number; // на таймлайне
  duration: number;
  in: number; // в исходнике
  out: number;
  grade: Grade;
  transition: { type: string; duration: number; params: Record<string, number | number[]> } | null;
}

export interface AssetInfo {
  id: string;
  name: string;
  codec: string;
  width: number;
  height: number;
  fps: number;
  start: number;
  end: number;
  hasAudio: boolean;
}

export type GradePatch = Partial<Omit<Grade, 'lift' | 'gamma' | 'gain' | 'lut'>> & {
  lift?: Partial<Wheel>;
  gamma?: Partial<Wheel>;
  gain?: Partial<Wheel>;
};

const assetInfo = (a: Asset): AssetInfo => ({
  id: a.id, name: a.name, codec: a.codec, width: a.width, height: a.height,
  fps: a.fps, start: a.start, end: a.end, hasAudio: !!a.sound,
});

export function createApi(project: Project, player: Player) {
  let batching = 0;

  /** Каждый вызов, меняющий проект, — один шаг отмены (или часть batch). */
  const mutate = <T>(fn: () => T): T => {
    if (!batching) project.checkpoint();
    return fn();
  };

  const resolveClip = (ref: string | number): Clip => {
    if (typeof ref === 'number') {
      const c = project.clips.at(ref);
      if (!c) throw new Error(`Нет клипа с индексом ${ref}`);
      return c;
    }
    return project.clip(ref);
  };

  const clipInfo = (c: Clip): ClipInfo => {
    const asset = project.assets.get(c.assetId)!;
    const index = project.clips.indexOf(c);
    return {
      id: c.id, assetId: c.assetId, name: asset.name, index,
      start: project.startOf(c), duration: c.out - c.in, in: c.in, out: c.out,
      grade: cloneGrade(c.grade),
      transition: c.transition && { ...c.transition, duration: project.transitionLength(index) },
    };
  };

  const applyGrade = (g: Grade, patch: GradePatch) => {
    const { lift, gamma, gain, ...rest } = patch;
    Object.assign(g, rest);
    if (lift) Object.assign(g.lift, lift);
    if (gamma) Object.assign(g.gamma, gamma);
    if (gain) Object.assign(g.gain, gain);
  };

  const api = {
    version: '0.2.0',

    // ---------- состояние ----------
    get duration() { return project.duration; },
    get fps() { return project.fps; },
    get size() { return project.size; },
    get time() { return player.time; },
    get selected() { return project.selected; },
    assets: (): AssetInfo[] => [...project.assets.values()].map(assetInfo),
    clips: (): ClipInfo[] => project.clips.map(clipInfo),
    clip: (ref: string | number): ClipInfo => clipInfo(resolveClip(ref)),

    // ---------- медиа ----------
    /** Файл или URL. Возвращает описание добавленного медиа (на таймлайн не ставит). */
    async import(source: File | Blob | string, name?: string): Promise<AssetInfo> {
      let file: File;
      if (typeof source === 'string') {
        const res = await fetch(source);
        if (!res.ok) throw new Error(`Не удалось скачать ${source}: ${res.status}`);
        file = new File([await res.blob()], name ?? source.split('/').pop() ?? 'video');
      } else {
        file = source instanceof File ? source : new File([source], name ?? 'video');
      }
      const asset = await loadAsset(file);
      project.assets.set(asset.id, asset);
      project.changed();
      return assetInfo(asset);
    },

    // ---------- таймлайн ----------
    /** Ставит медиа на таймлайн. in/out — секунды в исходнике, index — позиция. */
    add(assetId: string, range: { in?: number; out?: number; index?: number } = {}): ClipInfo {
      const asset = project.assets.get(assetId);
      if (!asset) throw new Error(`Нет медиа ${assetId}`);
      return clipInfo(mutate(() => project.addClip(asset, range)));
    },
    /** Режет клип в момент таймлайна. Возвращает правую часть. */
    split(time: number): ClipInfo | null {
      const right = mutate(() => project.split(time));
      return right && clipInfo(right);
    },
    trim(ref: string | number, range: { in?: number; out?: number }) {
      mutate(() => project.trim(resolveClip(ref).id, range));
    },
    remove(ref: string | number) {
      mutate(() => project.remove(resolveClip(ref).id));
    },
    move(ref: string | number, index: number) {
      mutate(() => project.move(resolveClip(ref).id, index));
    },
    select(ref: string | number | null) {
      project.selected = ref === null ? null : resolveClip(ref).id;
      project.changed();
    },
    clear() {
      mutate(() => {
        project.clips = [];
        project.selected = null;
        project.changed();
      });
    },

    // ---------- цвет ----------
    /** Меняет только переданные поля: grade(0, { exposure: 0.5, gain: { master: 0.1 } }). */
    grade(ref: string | number | 'all', patch: GradePatch) {
      mutate(() => {
        const targets = ref === 'all' ? project.clips : [resolveClip(ref)];
        for (const c of targets) applyGrade(c.grade, patch);
        project.changed();
      });
    },
    resetGrade(ref: string | number | 'all') {
      mutate(() => {
        const targets = ref === 'all' ? project.clips : [resolveClip(ref)];
        for (const c of targets) c.grade = defaultGrade();
        project.changed();
      });
    },
    copyGrade(from: string | number, to: (string | number)[] | 'all') {
      mutate(() => {
        const src = resolveClip(from);
        const targets = to === 'all' ? project.clips : to.map(resolveClip);
        for (const c of targets) if (c !== src) c.grade = cloneGrade(src.grade);
        project.changed();
      });
    },
    /** LUT из текста .cube, File или URL. */
    async lut(ref: string | number | 'all', source: string | File, mix = 1) {
      let text: string;
      let name = 'LUT';
      if (source instanceof File) {
        text = await source.text();
        name = source.name;
      } else if (/^\s*(#|TITLE|LUT_|DOMAIN)/m.test(source) && source.includes('\n')) {
        text = source;
      } else {
        const res = await fetch(source);
        if (!res.ok) throw new Error(`Не удалось скачать LUT: ${res.status}`);
        text = await res.text();
        name = source.split('/').pop() ?? name;
      }
      const lut = parseCube(text, name);
      mutate(() => {
        const targets = ref === 'all' ? project.clips : [resolveClip(ref)];
        for (const c of targets) {
          c.grade.lut = lut;
          c.grade.lutMix = mix;
        }
        project.changed();
      });
    },

    // ---------- переходы ----------
    transitions: {
      /** Регистрирует переход в формате gl-transitions. */
      register(def: TransitionDef) {
        registerTransition(def);
        project.changed();
      },
      list: () => listTransitions().map(({ id, name, params }) => ({ id, name, params })),
    },
    /** Переход из предыдущего клипа в этот. null убирает переход. */
    transition(ref: string | number, t: { type: string; duration?: number; params?: Record<string, number | number[]> } | null) {
      const clip = resolveClip(ref);
      if (t && !getTransition(t.type)) throw new Error(`Нет перехода «${t.type}». Есть: ${listTransitions().map((d) => d.id).join(', ')}`);
      mutate(() => {
        clip.transition = t && { type: t.type, duration: t.duration ?? 1, params: { ...t.params } };
        project.changed();
      });
    },

    // ---------- воспроизведение ----------
    seek: (t: number) => player.seek(t),
    play: () => player.play(),
    pause: () => player.pause(),

    // ---------- история ----------
    undo: () => project.undo(),
    redo: () => project.redo(),
    /** Объединяет несколько изменений в один шаг отмены. */
    async batch<T>(fn: () => T | Promise<T>): Promise<T> {
      if (!batching) project.checkpoint();
      batching++;
      try {
        return await fn();
      } finally {
        batching--;
      }
    },

    // ---------- экспорт ----------
    /** Рендерит таймлайн в MP4 и возвращает Blob. */
    render: (opts?: ExportOptions) => exportProject(project, opts),

    /** Подписка на любые изменения проекта. Возвращает функцию отписки. */
    onChange: (fn: () => void) => project.onChange(fn),
  };
  return api;
}

export type MontageApi = ReturnType<typeof createApi>;

/** Запускает пользовательский скрипт: async-тело функции с montage и log в области видимости. */
export async function runScript(code: string, api: MontageApi, log: (...args: unknown[]) => void) {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;
  let fn: (...a: unknown[]) => Promise<unknown>;
  try {
    fn = new AsyncFunction('montage', 'log', code);
  } catch (e) {
    if (e instanceof SyntaxError) throw e;
    // Страница запрещает eval: запускаем как модуль из blob.
    const url = URL.createObjectURL(new Blob([`export default async (montage, log) => {\n${code}\n}`], { type: 'text/javascript' }));
    try {
      fn = (await import(/* @vite-ignore */ url)).default;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return api.batch(() => fn(api, log));
}
