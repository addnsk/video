import {
  Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource,
  getFirstEncodableVideoCodec, getFirstEncodableAudioCodec, QUALITY_HIGH, QUALITY_MEDIUM,
} from 'mediabunny';
import type { Project } from './project';
import { Renderer } from './renderer';

export interface ExportOptions {
  height: number | null; // null = как в исходнике
  quality: 'high' | 'medium';
  onProgress: (fraction: number) => void;
  signal: { canceled: boolean };
}

const SAMPLE_RATE = 48000;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export async function exportProject(project: Project, opts: ExportOptions): Promise<Blob> {
  const src = project.size;
  const height = opts.height && opts.height < src.height ? opts.height : src.height;
  const width = even((src.width * height) / src.height);
  const fps = project.fps;

  const videoCodec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width, height: even(height) });
  if (!videoCodec) throw new Error('Браузер не умеет кодировать видео в таком разрешении. Попробуйте 1080p или 720p.');
  const hasAudio = project.clips.some((c) => project.assets.get(c.assetId)?.sound);
  const audioCodec = hasAudio ? await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: SAMPLE_RATE }) : null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = even(height);
  const renderer = new Renderer(canvas);

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const bitrate = opts.quality === 'high' ? QUALITY_HIGH : QUALITY_MEDIUM;
  const video = new CanvasSource(canvas, { codec: videoCodec, bitrate });
  output.addVideoTrack(video, { frameRate: fps });
  const audio = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  const total = project.duration;
  const frameCount = Math.max(1, Math.round(total * fps));
  let frame = 0;

  try {
    for (const clip of project.clips) {
      const asset = project.assets.get(clip.assetId)!;
      const start = project.startOf(clip);
      const first = Math.round(start * fps);
      const last = Math.round((start + clip.out - clip.in) * fps);
      const times = [];
      for (let i = first; i < last; i++) times.push(clip.in + i / fps - start);

      for await (const sample of asset.frames.samplesAtTimestamps(times)) {
        if (opts.signal.canceled) {
          sample?.close();
          throw new DOMException('Экспорт отменён', 'AbortError');
        }
        if (sample) {
          renderer.upload(sample.toCanvasImageSource(), sample.displayWidth, sample.displayHeight);
          sample.close();
        }
        renderer.draw(clip.grade);
        await video.add(frame / fps, 1 / fps);
        frame++;
        opts.onProgress(frame / frameCount);
      }

      if (audio) await audio.add(await renderClipAudio(project, clip.id));
    }
    video.close();
    audio?.close();
    await output.finalize();
  } catch (e) {
    await output.cancel();
    throw e;
  }

  const buffer = (output.target as BufferTarget).buffer!;
  return new Blob([buffer], { type: 'video/mp4' });
}

/** Звук одного клипа, ровно его длины; тишина, если у клипа нет звука. */
async function renderClipAudio(project: Project, clipId: string) {
  const clip = project.clips.find((c) => c.id === clipId)!;
  const asset = project.assets.get(clip.assetId)!;
  const length = Math.max(1, Math.round((clip.out - clip.in) * SAMPLE_RATE));
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE);
  if (asset.sound) {
    for await (const { buffer, timestamp, duration } of asset.sound.buffers(clip.in, clip.out)) {
      const offset = Math.max(0, clip.in - timestamp);
      const when = Math.max(0, timestamp - clip.in);
      const dur = Math.min(timestamp + duration, clip.out) - (timestamp + offset);
      if (dur <= 0) continue;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      node.start(when, offset, dur);
    }
  }
  return ctx.startRendering();
}
