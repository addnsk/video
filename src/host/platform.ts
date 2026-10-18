export interface BrowserInfo {
  readonly name: 'Chrome' | 'Edge' | 'Safari' | 'Firefox' | 'Opera' | 'Samsung Internet' | 'Other';
  readonly version: number | null;
  readonly os: 'macOS' | 'Windows' | 'Linux' | 'Android' | 'iOS' | 'ChromeOS' | 'Other';
  readonly mobile: boolean;
}

export interface HostPlatform {
  readonly browser: BrowserInfo;
  readonly crossOriginIsolated: boolean;
  readonly cores: number;
  readonly deviceMemoryGb: number | null;
  readonly measuredMemoryMb: number | null;
  readonly storage: { readonly quotaMb: number | null; readonly usageMb: number | null; readonly persisted: boolean };
  readonly display: { readonly hdr: boolean; readonly wideGamut: boolean; readonly pixelRatio: number };
  readonly features: { readonly offscreenCanvas: boolean; readonly webgpu: boolean; readonly fileSystemAccess: boolean; readonly webCodecs: boolean };
}

const RULES: readonly [BrowserInfo['name'], RegExp][] = [
  ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/],
  ['Opera', /OPR\/(\d+)/],
  ['Samsung Internet', /SamsungBrowser\/(\d+)/],
  ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
  ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
  ['Safari', /Version\/(\d+).*Safari/],
];

export function parseUserAgent(ua: string, maxTouchPoints = 0): BrowserInfo {
  const ipadOs = /Macintosh/.test(ua) && maxTouchPoints > 1;
  const os: BrowserInfo['os'] = /iPhone|iPad|iPod/.test(ua) || ipadOs
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /CrOS/.test(ua)
        ? 'ChromeOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Other';
  const hit = RULES.find(([, re]) => re.test(ua));
  const version = hit ? Number(ua.match(hit[1])![1]) : null;
  return { name: hit?.[0] ?? 'Other', version, os, mobile: os === 'iOS' || os === 'Android' || /Mobile/.test(ua) };
}

const mb = (bytes: number | undefined) => (bytes === undefined ? null : Math.round(bytes / 1048576));

async function measuredMemory(): Promise<number | null> {
  const measure = (performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> }).measureUserAgentSpecificMemory;
  if (!globalThis.crossOriginIsolated || !measure) return null;
  try {
    return mb((await measure.call(performance)).bytes);
  } catch {
    return null;
  }
}

export async function detectPlatform(): Promise<HostPlatform> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const [estimate, persisted, measured] = await Promise.all([
    nav.storage?.estimate?.().catch(() => undefined),
    nav.storage?.persisted?.().catch(() => false) ?? false,
    measuredMemory(),
  ]);
  return {
    browser: parseUserAgent(nav.userAgent, nav.maxTouchPoints),
    crossOriginIsolated: !!globalThis.crossOriginIsolated,
    cores: nav.hardwareConcurrency || 0,
    deviceMemoryGb: nav.deviceMemory ?? null,
    measuredMemoryMb: measured,
    storage: { quotaMb: mb(estimate?.quota), usageMb: mb(estimate?.usage), persisted: !!persisted },
    display: { hdr: matchMedia('(dynamic-range: high)').matches, wideGamut: matchMedia('(color-gamut: p3)').matches, pixelRatio: devicePixelRatio },
    features: {
      offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
      webgpu: 'gpu' in nav,
      fileSystemAccess: 'showSaveFilePicker' in globalThis,
      webCodecs: typeof VideoDecoder !== 'undefined',
    },
  };
}
