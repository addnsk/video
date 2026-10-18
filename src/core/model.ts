export type ParamValue = number | boolean | string | readonly number[];
export type ParamValues = Readonly<Record<string, ParamValue>>;

export interface EffectInstance {
  readonly id: string;
  readonly type: string;
  readonly enabled: boolean;
  readonly params: ParamValues;
}

export interface TransitionInstance {
  readonly type: string;
  readonly duration: number;
  readonly params: ParamValues;
}

export interface SourceRange {
  readonly assetId: string;
  readonly in: number;
  readonly out: number;
}

export interface Item {
  readonly id: string;
  readonly source: SourceRange;
  readonly start: number;
  readonly effects: readonly EffectInstance[];
  readonly transitionIn: TransitionInstance | null;
  readonly volume: number;
}

export type TrackKind = 'video' | 'audio';

export interface Track {
  readonly id: string;
  readonly kind: TrackKind;
  readonly magnetic: boolean;
  readonly muted: boolean;
  readonly items: readonly Item[];
}

export interface AssetMeta {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly lastModified: number;
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly start: number;
  readonly end: number;
  readonly hasAudio: boolean;
  readonly sampleRate: number;
  readonly channels: number;
}

export interface ProjectSettings {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly sampleRate: number;
}

export interface Project {
  readonly version: 1;
  readonly settings: ProjectSettings | null;
  readonly assets: Readonly<Record<string, AssetMeta>>;
  readonly tracks: readonly Track[];
}

export const emptyProject = (): Project => ({
  version: 1,
  settings: null,
  assets: {},
  tracks: [
    { id: 'v1', kind: 'video', magnetic: true, muted: false, items: [] },
    { id: 'a1', kind: 'audio', magnetic: false, muted: false, items: [] },
  ],
});

export const itemLength = (item: Item): number => item.source.out - item.source.in;
