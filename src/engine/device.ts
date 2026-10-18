export type DeviceClass = 'constrained' | 'mobile' | 'desktop';

export interface MemoryBudget {
  readonly deviceClass: DeviceClass;
  readonly previewMaxHeight: number;
  readonly frameCacheBytes: number;
  readonly maxOpenSources: number;
  readonly proxyHeight: number;
  readonly proxyThresholdHeight: number;
  readonly audioWindowSeconds: number;
  readonly exportChunkBytes: number;
  readonly encoderThreads: number;
  readonly memoryLimitBytes: number;
}

export interface DeviceInfo {
  readonly memoryGb: number | null;
  readonly cores: number;
  readonly ios: boolean;
  readonly touch: boolean;
}

export function detectDevice(nav: Navigator = navigator): DeviceInfo {
  const ua = nav.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
  return {
    memoryGb: (nav as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    cores: nav.hardwareConcurrency || 4,
    ios,
    touch: (nav.maxTouchPoints ?? 0) > 0,
  };
}

const MB = 1024 * 1024;

export function budgetFor(device: DeviceInfo): MemoryBudget {
  const memory = device.memoryGb ?? (device.ios ? 3 : 8);
  if (device.ios || memory <= 2) {
    return {
      deviceClass: 'constrained',
      previewMaxHeight: 540,
      frameCacheBytes: 48 * MB,
      maxOpenSources: 4,
      proxyHeight: 540,
      proxyThresholdHeight: 720,
      audioWindowSeconds: 1,
      exportChunkBytes: 4 * MB,
      encoderThreads: Math.min(2, Math.max(1, device.cores - 1)),
      memoryLimitBytes: 384 * MB,
    };
  }
  if (device.touch || memory <= 4) {
    return {
      deviceClass: 'mobile',
      previewMaxHeight: 720,
      frameCacheBytes: 96 * MB,
      maxOpenSources: 6,
      proxyHeight: 540,
      proxyThresholdHeight: 1080,
      audioWindowSeconds: 1,
      exportChunkBytes: 8 * MB,
      encoderThreads: Math.min(3, Math.max(1, device.cores - 1)),
      memoryLimitBytes: 768 * MB,
    };
  }
  return {
    deviceClass: 'desktop',
    previewMaxHeight: 1080,
    frameCacheBytes: 384 * MB,
    maxOpenSources: 16,
    proxyHeight: 720,
    proxyThresholdHeight: 2160,
    audioWindowSeconds: 1,
    exportChunkBytes: 16 * MB,
    encoderThreads: Math.min(6, Math.max(1, device.cores - 1)),
    memoryLimitBytes: 2048 * MB,
  };
}
