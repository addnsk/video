import type { Mix } from './mix';
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
  readonly span?: readonly [number, number];
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

export interface ItemGraphLink {
  readonly from: string;
  readonly to: string;
  readonly input: string;
}

export interface ItemGraph {
  readonly links: readonly ItemGraphLink[];
  readonly positions: Readonly<Record<string, readonly [number, number]>>;
}

export interface GradeSnapshot {
  readonly effects: readonly EffectInstance[];
  readonly graph?: ItemGraph;
  readonly animations: Animations;
}

export interface Still {
  readonly id: string;
  readonly name: string;
  readonly time: number;
  readonly image: string;
  readonly grade: GradeSnapshot;
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
  readonly graph?: ItemGraph;
  readonly parkedGraph?: ItemGraph;
  readonly gradeVersions?: Readonly<Record<string, GradeSnapshot>>;
  readonly gradeVersion?: string;
  readonly gap?: number;
  readonly link?: string;
}

export interface MediaItem extends ItemBase {
  readonly kind: 'media';
  readonly source: SourceRange;
  readonly speed: number;
  readonly colorSpace?: string;
  readonly videoOnly?: boolean;
}

export const itemColorSpace = (item: Item, assets: Project['assets']): string | undefined =>
  item.kind === 'media' ? (item.colorSpace ?? assets[item.source.assetId]?.colorSpace) : undefined;

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
  readonly defaultEffects?: readonly { readonly type: string; readonly params: ParamValues }[];
  readonly colorSpace?: string;
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
  readonly sampleRate: number;
  readonly channels: number;
}

export type ColorScience = 'display' | 'aces';

export interface ProjectSettings {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly sampleRate: number;
  readonly colorScience?: ColorScience;
}

export interface Marker {
  readonly id: string;
  readonly time: number;
  readonly duration: number;
  readonly name: string;
  readonly color: string;
  readonly note: string;
}

export interface Project {
  readonly version: 2;
  readonly settings: ProjectSettings | null;
  readonly assets: Readonly<Record<string, AssetMeta>>;
  readonly tracks: readonly Track[];
  readonly stills?: readonly Still[];
  readonly mix?: Mix;
  readonly markers?: readonly Marker[];
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

export const carriesAudio = (item: Item, assets: Project['assets']): item is MediaItem =>
  item.kind === 'media' && !item.videoOnly && !!assets[item.source.assetId]?.hasAudio;

export const isMedia = (item: Item): item is MediaItem => item.kind === 'media';

export const assetOf = (item: Item): string | null => (item.kind === 'media' ? item.source.assetId : null);

export const accepts = (track: Track, item: Item, assets: Project['assets']): boolean => {
  if (track.kind === 'audio') return item.kind === 'media' && !!assets[item.source.assetId]?.hasAudio;
  return item.kind === 'text' || !!assets[item.source.assetId]?.hasVideo;
};
