import type { Project, Frame } from './project';
import type { Renderer } from './renderer';
import { FrameFetcher, drawFrame, loadStill } from './frames';
import { mixAudio } from './audio';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const WINDOW = 1; // секунд звука, сводимых за раз

export class Player {
  time = 0;
  playing = false;
  bypass = false;
  private frame: Frame | null = null;
  private gen = 0;
  private seekToken = 0;
  private ctx: AudioContext | null = null;
  private ctxStart = 0;
  private timeStart = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private fetcher: FrameFetcher;

  constructor(
    private project: Project,
    private renderer: Renderer,
    private onTime: (t: number) => void,
  ) {
    this.fetcher = new FrameFetcher(project, renderer);
  }

  private clock() {
    return this.timeStart + (this.ctx!.currentTime - this.ctxStart);
  }

  /** Перерисовывает текущий кадр, например после смены покраски. */
  redraw() {
    // Покраску и переход берём из актуального состояния проекта.
    this.frame = this.project.frameAt(this.time);
    drawFrame(this.renderer, this.renderer.hasFrame ? this.frame : null, this.bypass);
  }

  async showFrame(t: number) {
    const token = ++this.seekToken;
    const frame = this.project.frameAt(Math.min(t, Math.max(0, this.project.duration - 1e-3)));
    if (!frame) {
      this.frame = null;
      this.renderer.clear();
      return;
    }
    const ok = await loadStill(this.project, this.renderer, frame, t, () => token !== this.seekToken || this.playing);
    if (!ok) return;
    this.frame = frame;
    drawFrame(this.renderer, frame, this.bypass);
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
    this.timeStart = this.time;
    // Первую секунду звука сводим заранее, чтобы картинка и звук стартовали вместе.
    const first = await mixAudio(this.project, this.time, Math.min(total, this.time + WINDOW), this.ctx.sampleRate);
    if (gen !== this.gen) return;
    this.ctxStart = this.ctx.currentTime + 0.05;
    this.schedule(first, this.ctxStart);
    void this.runAudio(gen, this.time + WINDOW);
    void this.runVideo(gen);
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
    this.fetcher.close();
  }

  private schedule(buffer: AudioBuffer, when: number) {
    const src = this.ctx!.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx!.destination);
    src.start(when);
    src.onended = () => this.sources.delete(src);
    this.sources.add(src);
  }

  private async runAudio(gen: number, from: number) {
    const total = this.project.duration;
    for (let t = from; t < total; t += WINDOW) {
      while (gen === this.gen && t - this.clock() > WINDOW * 1.5) await sleep(50);
      if (gen !== this.gen) return;
      const buffer = await mixAudio(this.project, t, Math.min(total, t + WINDOW), this.ctx!.sampleRate);
      if (gen !== this.gen) return;
      this.schedule(buffer, this.ctxStart + (t - this.timeStart));
    }
  }

  private async runVideo(gen: number) {
    while (gen === this.gen) {
      const t = this.clock();
      if (t >= this.project.duration) {
        this.time = this.project.duration;
        this.stop();
        this.onTime(this.time);
        return;
      }
      this.time = Math.max(this.timeStart, t);
      const frame = this.project.frameAt(this.time);
      if (frame) {
        await this.fetcher.load(frame, this.time);
        if (gen !== this.gen) return;
        this.frame = frame;
        drawFrame(this.renderer, frame, this.bypass);
      }
      this.onTime(this.time);
      await nextFrame();
    }
  }
}
