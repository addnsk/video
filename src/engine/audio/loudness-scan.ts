import type { Project } from '../../core/model';
import { projectDuration } from '../../core/timeline';
import { LoudnessMeter, type LoudnessReading } from '../../effects/audio/loudness';
import type { MediaPool } from '../media/media-pool';
import { AudioMixer, OUTPUT_CHANNELS } from './mixer';

const CHUNK_SECONDS = 1;

export async function scanLoudness(project: Project, pool: MediaPool, rate: number, onProgress: (fraction: number) => void, isCanceled: () => boolean): Promise<LoudnessReading> {
  const mixer = new AudioMixer(pool);
  const meter = new LoudnessMeter(rate, OUTPUT_CHANNELS);
  const duration = projectDuration(project);
  for (let t = 0; t < duration; t += CHUNK_SECONDS) {
    if (isCanceled()) throw new Error('Loudness scan canceled');
    meter.push(await mixer.mix(project, t, Math.min(duration, t + CHUNK_SECONDS), rate));
    onProgress(Math.min(1, (t + CHUNK_SECONDS) / duration));
  }
  return meter.reading();
}
