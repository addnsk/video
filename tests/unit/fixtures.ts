import type { AssetMeta } from '../../src/core/model';

export const asset = (id: string, duration = 10): AssetMeta => ({
  id,
  name: `${id}.mov`,
  size: 1,
  lastModified: 0,
  codec: 'ProRes',
  width: 1920,
  height: 1080,
  fps: 25,
  start: 0,
  end: duration,
  hasAudio: true,
  sampleRate: 48000,
  channels: 2,
});
