import { ProresFrameEncoder, type Planes422 } from './encoder';
import type { ProresProfile } from './tables';

interface Job {
  readonly id: number;
  readonly profile: ProresProfile;
  readonly planes: Planes422;
}

const encoders = new Map<ProresProfile, ProresFrameEncoder>();

self.addEventListener('message', (event: MessageEvent<Job>) => {
  const { id, profile, planes } = event.data;
  let encoder = encoders.get(profile);
  if (!encoder) encoders.set(profile, (encoder = new ProresFrameEncoder(profile)));
  try {
    const data = encoder.encode(planes);
    (self as unknown as Worker).postMessage({ id, data }, [data.buffer]);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: (e as Error).message });
  }
});
