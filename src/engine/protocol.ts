import type { MediaTrackOptions, TrackSample } from './tracking/track-media';
import type { AssetMeta, Project } from '../core/model';
import type { EffectDef } from '../effects/types';
import type { Lut3D } from '../effects/cube';
import type { DeviceInfo, MemoryBudget } from './device';
import type { ExportSettings } from './export/exporter';
import type { EngineCapabilities } from './capabilities';
import type { ViewNode } from './gpu/compositor';
import type { MemoryGovernor, Pressure } from './memory';
import type { MetricsSnapshot } from './metrics';
import type { ScopeData } from './scopes';
import type { FontSource } from './fonts';

export interface ClockAnchor {
  readonly time: number;
  readonly epochMs: number;
  readonly rate: number;
}

export type ExportTarget = { kind: 'storage'; name: string } | { kind: 'handle'; handle: FileSystemFileHandle };

export interface EngineStats {
  readonly budget: MemoryBudget;
  readonly resources: Record<string, { live: number; peak: number; bytes: number }>;
  readonly frameCacheBytes: number;
  readonly floatTargets: boolean;
  readonly previewSize: { readonly width: number; readonly height: number } | null;
  readonly metrics: MetricsSnapshot;
  readonly memory: ReturnType<MemoryGovernor['report']> | null;
  readonly renderCache: { readonly bytes: number; readonly diskBytes: number; readonly memory: number; readonly disk: number } | null;
}

export type TaskKind = 'export' | 'proxy';

export interface EngineEvents extends Record<string, unknown> {
  progress: { task: TaskKind; id: string; fraction: number };
  proxy: { assetId: string; state: 'queued' | 'building' | 'ready' | 'failed'; message?: string };
  error: { message: string; stack?: string };
  context: { state: 'lost' | 'restored' };
  scopes: ScopeData;
  memory: { level: Pressure; bytes: number; limit: number };
}

export interface EngineInit {
  readonly surface: OffscreenCanvas | HTMLCanvasElement;
  readonly device: DeviceInfo;
  readonly fonts: readonly FontSource[];
}

export interface EngineMethods {
  init(options: EngineInit): Promise<MemoryBudget>;
  resize(width: number, height: number): void;
  setProject(project: Project): void;
  setEffects(defs: EffectDef[]): void;
  setLut(id: string, lut: Lut3D | null): void;
  probe(assetId: string, file: File): Promise<AssetMeta>;
  attach(meta: AssetMeta, file: File): void;
  renderStill(time: number, bypassFilters: boolean): Promise<boolean>;
  play(anchor: ClockAnchor, bypassFilters: boolean): void;
  stop(): void;
  mixAudio(t0: number, t1: number, rate: number): Promise<unknown>;
  exportVideo(id: string, settings: ExportSettings, target: ExportTarget): Promise<File | null>;
  cancel(id: string): void;
  ensureProxy(assetId: string, force: boolean): void;
  stats(): EngineStats;
  resetMetrics(): void;
  capabilities(): Promise<EngineCapabilities>;
  setViewNode(target: ViewNode | null): void;
  setScopes(enabled: boolean): void;
  setCompare(bitmap: ImageBitmap | null, position?: number): void;
  setComparePosition(position: number): void;
  grabFrame(time: number, maxHeight: number): Promise<Blob | null>;
  sampleFrame(time: number, points: { x: number; y: number }[]): Promise<number[][] | null>;
  setRenderCache(options: { enabled?: boolean; memoryBytes?: number; diskBytes?: number }): void;
  peaks(assetId: string): Promise<unknown>;
  thumbnails(assetId: string, times: number[], height: number): Promise<unknown>;
  track(assetId: string, times: number[], start: { x: number; y: number }, options: MediaTrackOptions): Promise<TrackSample[]>;
}
