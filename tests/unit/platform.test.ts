import { describe, expect, it } from 'vitest';
import type { EngineCapabilities } from '../../src/engine/capabilities';
import { parseUserAgent, type HostPlatform } from '../../src/host/platform';
import { platformNotes, type PlatformReport } from '../../src/host/platform-report';

describe('parseUserAgent', () => {
  const cases: [string, number, Partial<ReturnType<typeof parseUserAgent>>][] = [
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', 0, { name: 'Chrome', version: 141, os: 'macOS', mobile: false }],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15', 5, { name: 'Safari', version: 18, os: 'iOS', mobile: true }],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1', 5, { name: 'Chrome', version: 140, os: 'iOS' }],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0', 0, { name: 'Edge', version: 141, os: 'Windows' }],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0', 0, { name: 'Firefox', version: 143, os: 'Linux' }],
    ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36', 5, { name: 'Samsung Internet', os: 'Android', mobile: true }],
  ];
  it.each(cases)('%s', (ua, touch, expected) => {
    expect(parseUserAgent(ua, touch)).toMatchObject(expected);
  });
});

const host = (patch: Partial<HostPlatform> = {}): HostPlatform => ({
  browser: { name: 'Chrome', version: 141, os: 'macOS', mobile: false },
  crossOriginIsolated: true,
  cores: 8,
  deviceMemoryGb: 8,
  measuredMemoryMb: 200,
  storage: { quotaMb: 100_000, usageMb: 10, persisted: true },
  display: { hdr: false, wideGamut: true, pixelRatio: 2 },
  features: { offscreenCanvas: true, webgpu: true, fileSystemAccess: true, webCodecs: true },
  ...patch,
});

const engine = (patch: Partial<EngineCapabilities> = {}): EngineCapabilities => ({
  gpu: { vendor: 'Apple', renderer: 'Apple M2', maxTextureSize: 16384, max3dTextureSize: 2048, maxRenderbufferSize: 16384, floatTargets: true, floatLinear: true },
  codecs: [
    { label: 'H.264 1080p', decode: true, encode: true },
    { label: 'HEVC 1080p', decode: true, encode: true },
  ],
  workers: true,
  ...patch,
});

const report = (h = host(), e = engine(), engineMode: 'worker' | 'inline' = 'worker'): PlatformReport => ({ host: h, engine: e, engineMode });

describe('platformNotes', () => {
  it('is quiet on a capable machine', () => {
    expect(platformNotes(report())).toEqual([]);
  });

  it('warns about every limit that matters', () => {
    const messages = platformNotes(
      report(
        host({ crossOriginIsolated: false, storage: { quotaMb: 1000, usageMb: 0, persisted: false }, browser: { name: 'Safari', version: 17, os: 'iOS', mobile: true }, display: { hdr: true, wideGamut: true, pixelRatio: 3 } }),
        engine({
          gpu: { vendor: 'Google', renderer: 'SwiftShader', maxTextureSize: 2048, max3dTextureSize: 256, maxRenderbufferSize: 2048, floatTargets: false, floatLinear: false },
          codecs: [{ label: 'H.264 1080p', decode: true, encode: false }, { label: 'HEVC 1080p', decode: false, encode: false }],
        }),
        'inline',
      ),
    ).map((n) => n.message);
    for (const fragment of ['cross-origin isolated', 'main thread', 'float textures', '2048 px', 'No hardware GPU', 'No H.264 encoder', 'HEVC', '1000 MB', 'not persistent', 'iOS', 'HDR'])
      expect(messages.some((m) => m.includes(fragment)), fragment).toBe(true);
  });

  it('flags a missing WebGL2', () => {
    expect(platformNotes(report(host(), engine({ gpu: null })))[0].message).toContain('WebGL2');
  });
});
