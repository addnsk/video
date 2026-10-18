import { ProresFrameEncoder, type ColorTags, type Planes422 } from './encoder';
import type { ProresProfile } from './tables';

interface Job {
  readonly id: number;
  readonly profile: ProresProfile;
  readonly planes: Planes422;
  readonly colors: ColorTags;
}

const encoders = new Map<string, ProresFrameEncoder>();

self.addEventListener('message', (event: MessageEvent<Job>) => {
  const { id, profile, planes, colors } = event.data;
  const key = `${profile}:${colors.primaries}:${colors.transfer}:${colors.matrix}`;
  let encoder = encoders.get(key);
  if (!encoder) encoders.set(key, (encoder = new ProresFrameEncoder(profile, colors)));
  try {
    const data = encoder.encode(planes);
    (self as unknown as Worker).postMessage({ id, data }, [data.buffer]);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: (e as Error).message });
  }
});
