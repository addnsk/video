import { AudioSample, AudioSampleSource, CanvasSource, Output, StreamTarget } from 'mediabunny';
import type { Project } from '../../core/model';
import { compositionAt, projectDuration } from '../../core/timeline';
import type { EffectRegistry } from '../../effects/registry';
import { AudioMixer, OUTPUT_CHANNELS } from '../audio/mixer';
import type { MemoryBudget } from '../device';
import { SequentialFrames } from '../frames';
import { GpuContext } from '../gpu/context';
import { Compositor, type LutProvider } from '../gpu/compositor';
import type { MediaPool } from '../media/media-pool';
import type { ByteSink } from './sinks';
import type { TextRenderer } from '../text';

import { planFormat, type ExportSettings } from './formats';

export type { ExportSettings };

export interface ExportContext {
  readonly text: TextRenderer;
  readonly pool: MediaPool;
  readonly registry: EffectRegistry;
  readonly luts: LutProvider;
  readonly budget: MemoryBudget;
}

export class ExportCanceled extends Error {}

const AUDIO_CHUNK_SECONDS = 2;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export async function exportProject(
  project: Project,
  settings: ExportSettings,
  sink: ByteSink,
  context: ExportContext,
  onProgress: (fraction: number) => void,
  isCanceled: () => boolean,
): Promise<void> {
  const base = project.settings;
  if (!base) throw new Error('The timeline is empty');
  const height = even(settings.height && settings.height < base.height ? settings.height : base.height);
  const width = even((base.width * height) / base.height);
  const fps = base.fps;
  const rate = base.sampleRate;

  const hasAudio = Object.values(project.assets).some((a) => a.hasAudio);
  const plan = await planFormat(settings, { width, height, sampleRate: rate, channels: OUTPUT_CHANNELS, hasAudio });

  const canvas = new OffscreenCanvas(width, height);
  const gpu = new GpuContext(canvas);
  const compositor = new Compositor(gpu, context.registry, context.luts);
  const frames = new SequentialFrames(context.pool, context.text, 'master');
  const mixer = new AudioMixer(context.pool);

  const output = new Output({
    format: plan.output,
    target: new StreamTarget(sink.writable, { chunked: true, chunkSize: context.budget.exportChunkBytes }),
  });
  const video = new CanvasSource(canvas, { codec: plan.videoCodec, bitrate: plan.videoBitrate });
  output.addVideoTrack(video, { frameRate: fps });
  const audio = plan.audioCodec ? new AudioSampleSource({ codec: plan.audioCodec, bitrate: plan.audioBitrate }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  const duration = projectDuration(project);
  const frameCount = Math.max(1, Math.round(duration * fps));
  let audioCursor = 0;

  const writeAudioUntil = async (limit: number) => {
    while (audio && audioCursor < limit) {
      const end = Math.min(duration, audioCursor + AUDIO_CHUNK_SECONDS);
      const planar = await mixer.mix(project, audioCursor, end, rate);
      const frameLength = planar[0].length;
      const data = new Float32Array(frameLength * OUTPUT_CHANNELS);
      planar.forEach((ch, c) => data.set(ch, c * frameLength));
      const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: OUTPUT_CHANNELS, sampleRate: rate, timestamp: audioCursor });
      await audio.add(sample);
      sample.close();
      audioCursor = end;
    }
  };

  try {
    for (let i = 0; i < frameCount; i++) {
      if (isCanceled()) throw new ExportCanceled();
      const t = i / fps;
      const frame = compositionAt(project, t);
      const images = await frames.load(project, frame, { width, height });
      compositor.render(frame, images ?? new Map());
      await video.add(t, 1 / fps);
      await writeAudioUntil(Math.min(duration, t + 1));
      onProgress((i + 1) / frameCount);
    }
    await writeAudioUntil(duration);
    video.close();
    audio?.close();
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => undefined);
    await sink.abort().catch(() => undefined);
    throw e;
  } finally {
    frames.close();
    compositor.dispose();
  }
}
