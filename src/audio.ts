import type { Project } from './project';

/**
 * Сводит звук таймлайна в отрезке [t0, t1). На переходах звук клипов
 * перекрёстно затухает. Используется и плеером, и экспортом.
 */
export async function mixAudio(project: Project, t0: number, t1: number, sampleRate = 48000): Promise<AudioBuffer> {
  const length = Math.max(1, Math.round((t1 - t0) * sampleRate));
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const layers = project.layout();

  await Promise.all(
    layers.map(async (layer, i) => {
      const { clip, start } = layer;
      const end = start + clip.out - clip.in;
      if (end <= t0 || start >= t1) return;
      const asset = project.assets.get(clip.assetId)!;
      if (!asset.sound) return;

      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      const fadeIn = project.transitionLength(i);
      const fadeOut = project.transitionLength(i + 1);
      // Огибающая в координатах окна: время таймлайна минус t0.
      gain.gain.setValueAtTime(fadeIn ? 0 : 1, Math.max(0, start - t0));
      if (fadeIn) gain.gain.linearRampToValueAtTime(1, Math.max(0, start + fadeIn - t0));
      if (fadeOut) {
        gain.gain.setValueAtTime(1, Math.max(0, end - fadeOut - t0));
        gain.gain.linearRampToValueAtTime(0, Math.max(0, end - t0));
      }

      const srcFrom = clip.in + Math.max(0, t0 - start);
      const srcTo = clip.in + Math.min(end, t1) - start;
      for await (const { buffer, timestamp, duration } of asset.sound.buffers(srcFrom, srcTo)) {
        const offset = Math.max(0, srcFrom - timestamp);
        const when = start + (timestamp + offset - clip.in) - t0;
        const dur = Math.min(timestamp + duration, srcTo) - (timestamp + offset);
        if (dur <= 0 || when >= t1 - t0) continue;
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(gain);
        node.start(Math.max(0, when), offset, dur);
      }
    }),
  );
  return ctx.startRendering();
}
