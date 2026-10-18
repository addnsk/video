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

export interface Transform {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly rotation: number;
}

export type Easing = 'linear' | 'in' | 'out' | 'inOut';

export type PresetPhase = 'in' | 'out' | 'whole';

export type ItemPresets = Readonly<Partial<Record<PresetPhase, string>>>;

export interface Keyframe {
  readonly t: number;
  readonly v: number;
  readonly ease?: Easing;
}

export type Animations = Readonly<Record<string, readonly Keyframe[]>>;

export interface TextStyle {
  readonly content: string;
  readonly font: string;
  readonly weight: number;
  readonly size: number;
  readonly color: string;
  readonly align: 'left' | 'center' | 'right';
  readonly background: string | null;
}

interface ItemBase {
  readonly id: string;
  readonly start: number;
  readonly effects: readonly EffectInstance[];
  readonly transitionIn: TransitionInstance | null;
  readonly volume: number;
  readonly opacity: number;
  readonly transform: Transform;
  readonly animations: Animations;
  readonly presets: ItemPresets;
}

export interface MediaItem extends ItemBase {
  readonly kind: 'media';
  readonly source: SourceRange;
  readonly speed: number;
}

export interface TextItem extends ItemBase {
  readonly kind: 'text';
  readonly duration: number;
  readonly text: TextStyle;
}

export type Item = MediaItem | TextItem;

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
  readonly hasVideo: boolean;
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
  readonly version: 2;
  readonly settings: ProjectSettings | null;
  readonly assets: Readonly<Record<string, AssetMeta>>;
  readonly tracks: readonly Track[];
}

export const IDENTITY_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0 };

export const DEFAULT_TEXT: TextStyle = {
  content: 'Title',
  font: 'IBM Plex Sans',
  weight: 600,
  size: 0.08,
  color: '#ffffff',
  align: 'center',
  background: null,
};

export const emptyProject = (): Project => ({
  version: 2,
  settings: null,
  assets: {},
  tracks: [
    { id: 'v1', kind: 'video', magnetic: true, muted: false, items: [] },
    { id: 'v2', kind: 'video', magnetic: false, muted: false, items: [] },
    { id: 'a1', kind: 'audio', magnetic: false, muted: false, items: [] },
  ],
});

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 16;

export const itemLength = (item: Item): number => (item.kind === 'media' ? (item.source.out - item.source.in) / item.speed : item.duration);

export const sourceTimeAt = (item: MediaItem, local: number): number => item.source.in + local * item.speed;

export const isMedia = (item: Item): item is MediaItem => item.kind === 'media';

export const assetOf = (item: Item): string | null => (item.kind === 'media' ? item.source.assetId : null);

export const accepts = (track: Track, item: Item, assets: Project['assets']): boolean => {
  if (track.kind === 'audio') return item.kind === 'media' && !!assets[item.source.assetId]?.hasAudio;
  return item.kind === 'text' || !!assets[item.source.assetId]?.hasVideo;
};
