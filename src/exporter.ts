import {
  Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource,
  getFirstEncodableVideoCodec, getFirstEncodableAudioCodec, QUALITY_HIGH, QUALITY_MEDIUM,
} from 'mediabunny';
import type { Project } from './project';
import { Renderer } from './renderer';
import { FrameFetcher, drawFrame } from './frames';
import { mixAudio } from './audio';

export interface ExportOptions {
  height?: number | null; // null = как в исходнике
  quality?: 'high' | 'medium';
  onProgress?: (fraction: number) => void;
  signal?: { canceled: boolean };
}

const SAMPLE_RATE = 48000;
const AUDIO_CHUNK = 5;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export async function exportProject(project: Project, opts: ExportOptions = {}): Promise<Blob> {
  if (!project.clips.length) throw new Error('Таймлайн пуст.');
  const src = project.size;
  const height = even(opts.height && opts.height < src.height ? opts.height : src.height);
  const width = even((src.width * height) / src.height);
  const fps = project.fps;
  const signal = opts.signal ?? { canceled: false };

  const videoCodec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width, height });
  if (!videoCodec) throw new Error('Браузер не умеет кодировать видео в таком разрешении. Попробуйте 1080p или 720p.');
  const hasAudio = project.clips.some((c) => project.assets.get(c.assetId)?.sound);
  const audioCodec = hasAudio ? await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: SAMPLE_RATE }) : null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const renderer = new Renderer(canvas);
  const fetcher = new FrameFetcher(project, renderer);

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: videoCodec, bitrate: opts.quality === 'medium' ? QUALITY_MEDIUM : QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: fps });
  const audio = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  const total = project.duration;
  const frameCount = Math.max(1, Math.round(total * fps));
  let audioDone = 0;

  try {
    for (let i = 0; i < frameCount; i++) {
      if (signal.canceled) throw new DOMException('Экспорт отменён', 'AbortError');
      const t = i / fps;
      const frame = project.frameAt(t);
      if (frame) await fetcher.load(frame, t);
      drawFrame(renderer, frame);
      await video.add(t, 1 / fps);
      // Звук пишем кусками, не отставая от видео.
      while (audio && audioDone < Math.min(total, t + 1)) {
        const end = Math.min(total, audioDone + AUDIO_CHUNK);
        await audio.add(await mixAudio(project, audioDone, end, SAMPLE_RATE));
        audioDone = end;
      }
      opts.onProgress?.((i + 1) / frameCount);
    }
    while (audio && audioDone < total) {
      const end = Math.min(total, audioDone + AUDIO_CHUNK);
      await audio.add(await mixAudio(project, audioDone, end, SAMPLE_RATE));
      audioDone = end;
    }
    video.close();
    audio?.close();
    await output.finalize();
  } catch (e) {
    await output.cancel();
    throw e;
  } finally {
    fetcher.close();
  }

  return new Blob([output.target.buffer!], { type: 'video/mp4' });
}
