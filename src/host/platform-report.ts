import type { EngineCapabilities } from '../engine/capabilities';
import type { HostPlatform } from './platform';

export interface PlatformReport {
  readonly host: HostPlatform;
  readonly engine: EngineCapabilities;
  readonly engineMode: 'worker' | 'inline';
}

export interface PlatformNote {
  readonly level: 'warning' | 'info';
  readonly message: string;
}

const LOW_STORAGE_MB = 4096;
const UHD = 3840;

const codec = (report: PlatformReport, label: string) => report.engine.codecs.find((c) => c.label === label);

export function platformNotes(report: PlatformReport): PlatformNote[] {
  const notes: PlatformNote[] = [];
  const add = (level: PlatformNote['level'], message: string) => notes.push({ level, message });
  const { host, engine } = report;
  if (!host.crossOriginIsolated) add('warning', 'The page is not cross-origin isolated: ProRes decodes on one thread and memory cannot be measured.');
  if (report.engineMode === 'inline') add('warning', 'The engine runs on the main thread (no OffscreenCanvas with WebGL2); the interface may stutter during playback.');
  if (!engine.gpu) add('warning', 'WebGL2 is unavailable; nothing can be rendered.');
  else {
    if (!engine.gpu.floatTargets) add('warning', 'The GPU cannot render to float textures; color is processed in 8 bits.');
    if (engine.gpu.maxTextureSize < UHD) add('warning', `The GPU limits textures to ${engine.gpu.maxTextureSize} px; 4K frames are downscaled for preview and 4K export is not possible.`);
    if (/swiftshader|llvmpipe|software/i.test(engine.gpu.renderer)) add('warning', `No hardware GPU (${engine.gpu.renderer}); rendering runs on the CPU and is much slower.`);
  }
  const h264 = codec(report, 'H.264 1080p');
  if (h264 && !h264.decode) add('warning', 'This browser cannot decode H.264.');
  if (h264 && !h264.encode) add('info', 'No H.264 encoder: MP4 exports use HEVC, VP9 or AV1 instead.');
  if (codec(report, 'HEVC 1080p')?.decode === false) add('info', 'HEVC (iPhone and many cameras) cannot be decoded in this browser.');
  if (host.storage.quotaMb !== null && host.storage.quotaMb < LOW_STORAGE_MB) add('warning', `Only ${host.storage.quotaMb} MB of browser storage: proxies and exports to storage are limited.`);
  if (!host.storage.persisted) add('info', 'Browser storage is not persistent; proxies may be evicted when the disk is low.');
  if (host.browser.os === 'iOS') add('info', 'iOS limits memory per tab tightly; long 4K projects should use proxies.');
  if (host.display.hdr) add('info', 'This display supports HDR; the preview is still shown in SDR.');
  return notes;
}

export const maxExportHeight = (report: PlatformReport): number | null => report.engine.gpu?.maxTextureSize ?? null;
