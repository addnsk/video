import type { Project, Clip } from './project';
import type { Renderer } from './renderer';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Player {
  time = 0;
  playing = false;
  bypass = false;
  current: Clip | null = null;
  private gen = 0;
  private seekToken = 0;
  private ctx: AudioContext | null = null;
  private ctxStart = 0;
  private timeStart = 0;
  private sources = new Set<AudioBufferSourceNode>();

  constructor(
    private project: Project,
    private renderer: Renderer,
    private onTime: (t: number) => void,
  ) {}

  private clock() {
    return this.timeStart + (this.ctx!.currentTime - this.ctxStart);
  }

  redraw() {
    if (this.current && !this.project.clips.includes(this.current)) this.current = null;
    this.renderer.draw(this.current?.grade ?? this.project.clips[0]?.grade, this.bypass);
  }

  async showFrame(t: number) {
    const token = ++this.seekToken;
    const hit = this.project.clipAt(t);
    if (!hit) {
      this.current = null;
      this.renderer.clear();
      return;
    }
    const asset = this.project.assets.get(hit.clip.assetId)!;
    const sample = await asset.frames.getSample(hit.clip.in + (t - hit.start));
    if (!sample) return;
    if (token !== this.seekToken || this.playing) {
      sample.close();
      return;
    }
    this.renderer.upload(sample.toCanvasImageSource(), sample.displayWidth, sample.displayHeight);
    sample.close();
    this.current = hit.clip;
    this.redraw();
  }

  seek(t: number) {
    this.time = Math.max(0, Math.min(t, this.project.duration));
    this.onTime(this.time);
    if (this.playing) {
      this.stop();
      void this.play();
    } else {
      void this.showFrame(this.time);
    }
  }

  async play() {
    const total = this.project.duration;
    if (this.playing || total === 0) return;
    if (this.time >= total - 1e-3) this.time = 0;
    this.ctx ??= new AudioContext({ latencyHint: 'playback' });
    await this.ctx.resume();
    this.playing = true;
    const gen = ++this.gen;
    this.ctxStart = this.ctx.currentTime + 0.15;
    this.timeStart = this.time;
    void this.runVideo(gen);
    void this.runAudio(gen);
    void this.tick(gen);
  }

  pause() {
    if (!this.playing) return;
    this.time = Math.min(this.clock(), this.project.duration);
    this.stop();
    this.onTime(this.time);
    void this.showFrame(this.time);
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.play();
  }

  private stop() {
    this.playing = false;
    this.gen++;
    for (const s of this.sources) s.stop();
    this.sources.clear();
  }

  private async tick(gen: number) {
    while (gen === this.gen) {
      const t = this.clock();
      if (t >= this.project.duration) {
        this.time = this.project.duration;
        this.stop();
        this.onTime(this.time);
        return;
      }
      this.time = Math.max(this.timeStart, t);
      this.onTime(this.time);
      await nextFrame();
    }
  }

  /** Отрезки клипов, которые нужно проиграть начиная с текущего времени. */
  private *segments() {
    let start = 0;
    for (const clip of this.project.clips) {
      const len = clip.out - clip.in;
      if (start + len > this.timeStart) {
        const from = clip.in + Math.max(0, this.timeStart - start);
        yield { clip, start, from };
      }
      start += len;
    }
  }

  private async runVideo(gen: number) {
    const frame = 1 / this.project.fps;
    for (const { clip, start, from } of [...this.segments()]) {
      const asset = this.project.assets.get(clip.assetId)!;
      for await (const sample of asset.frames.samples(from, clip.out)) {
        if (gen !== this.gen) {
          sample.close();
          return;
        }
        const at = start + sample.timestamp - clip.in;
        // Отстаём больше чем на два кадра: пропускаем, чтобы догнать звук.
        if (this.clock() - at > frame * 2) {
          sample.close();
          continue;
        }
        while (gen === this.gen && this.clock() < at) await nextFrame();
        if (gen !== this.gen) {
          sample.close();
          return;
        }
        this.renderer.upload(sample.toCanvasImageSource(), sample.displayWidth, sample.displayHeight);
        sample.close();
        this.current = clip;
        this.redraw();
      }
    }
  }

  private async runAudio(gen: number) {
    const ctx = this.ctx!;
    for (const { clip, start, from } of [...this.segments()]) {
      const asset = this.project.assets.get(clip.assetId)!;
      if (!asset.sound) continue;
      for await (const { buffer, timestamp, duration } of asset.sound.buffers(from, clip.out)) {
        if (gen !== this.gen) return;
        let offset = Math.max(0, from - timestamp);
        let when = this.ctxStart + (start + timestamp + offset - clip.in - this.timeStart);
        if (when < ctx.currentTime) {
          offset += ctx.currentTime - when;
          when = ctx.currentTime;
        }
        const length = Math.min(timestamp + duration, clip.out) - (timestamp + offset);
        if (length <= 0) continue;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start(when, offset, length);
        src.onended = () => this.sources.delete(src);
        this.sources.add(src);
        while (gen === this.gen && when - ctx.currentTime > 1) await sleep(100);
      }
    }
  }
}
