import { MASTER, scaleMaster, setStripEffect, stripOf } from '../core/mix';
import { createId } from '../core/ids';
import { LOUDNESS_TARGETS, type LoudnessReading, type LoudnessTarget } from '../effects/audio/loudness';
import type { EditorSession } from './session';

const DEFAULT_RATE = 48000;

export interface NormalizeTarget {
  readonly integrated: number;
  readonly peak: number;
}

export interface NormalizeResult {
  readonly before: LoudnessReading;
  readonly gain: number;
  readonly limiter: boolean;
}

export const resolveTarget = (target: LoudnessTarget | number | NormalizeTarget): NormalizeTarget => {
  if (typeof target === 'number') return { integrated: target, peak: -1 };
  if (typeof target === 'string') {
    const preset = LOUDNESS_TARGETS[target];
    if (!preset) throw new Error(`Unknown loudness target "${target}". Available: ${Object.keys(LOUDNESS_TARGETS).join(', ')}`);
    return preset;
  }
  return target;
};

export async function measureLoudness(session: EditorSession): Promise<LoudnessReading> {
  const rate = session.store.project.settings?.sampleRate || DEFAULT_RATE;
  return session.engine.remote.measureLoudness(createId('loud'), rate);
}

export async function normalizeLoudness(session: EditorSession, target: LoudnessTarget | number | NormalizeTarget): Promise<NormalizeResult> {
  const goal = resolveTarget(target);
  const before = await measureLoudness(session);
  if (!Number.isFinite(before.integrated)) throw new Error('The project is silent; there is nothing to normalize');
  const gain = goal.integrated - before.integrated;
  const limiter = before.peak + gain > goal.peak;
  const { store } = session;
  const previous = stripOf(store.project, MASTER)!.volume;
  await store.transaction(() => {
    store.dispatch(scaleMaster(gain));
    const existing = stripOf(store.project, MASTER)!.effects.some((e) => e.type === 'limiter');
    if (limiter || existing) store.dispatch(setStripEffect(MASTER, 'limiter', { ceiling: goal.peak }));
  });
  return { before, gain: stripOf(store.project, MASTER)!.volume - previous, limiter };
}
