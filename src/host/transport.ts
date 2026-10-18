import type { LoudnessReading } from '../effects/audio/loudness';
import { Emitter } from '../core/emitter';
import type { Store } from '../core/store';
import { projectDuration } from '../core/timeline';
import { AudioOutput } from './audio-output';
import type { EngineClient } from './engine-client';

export interface TransportEvents extends Record<string, unknown> {
  time: number;
  state: { playing: boolean; rate: number };
}

const START_LATENCY = 0.08;
export const SHUTTLE_RATES = [1, 2, 4, 8] as const;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const wallClock = () => performance.now() / 1000;

export class Transport extends Emitter<TransportEvents> {
  private current = 0;
  private playingState = false;
  private speed = 1;
  private generation = 0;
  private origin = { clock: 0, time: 0 };
  private audio = new AudioOutput();
  private bypassFilters = false;

  constructor(
    private engine: EngineClient,
    private store: Store,
  ) {
    super();
    store.on('change', () => {
      if (this.current > this.duration) this.current = this.duration;
      if (this.playingState) this.restart();
    });
  }

  get time(): number {
    return this.current;
  }

  get playing(): boolean {
    return this.playingState;
  }

  get rate(): number {
    return this.playingState ? this.speed : 0;
  }

  loudness(): LoudnessReading | null {
    return this.playingState && !this.reverse ? this.audio.loudness() : null;
  }

  levels(): number[] {
    return this.playingState && !this.reverse ? this.audio.levels() : [0, 0];
  }

  get bypass(): boolean {
    return this.bypassFilters;
  }

  set bypass(value: boolean) {
    this.bypassFilters = value;
    if (this.playingState) this.restart();
    else void this.engine.remote.renderStill(this.current, value);
  }

  private get duration(): number {
    return projectDuration(this.store.project);
  }

  private get reverse(): boolean {
    return this.speed < 0;
  }

  seek(time: number): void {
    this.current = Math.max(0, Math.min(time, this.duration));
    this.emit('time', this.current);
    if (this.playingState) this.restart();
    else void this.engine.remote.renderStill(this.current, this.bypassFilters);
  }

  toggle(): void {
    if (this.playingState) this.pause();
    else void this.play();
  }

  play(rate = 1): Promise<void> {
    if (this.duration === 0 || rate === 0) return Promise.resolve();
    if (this.playingState && rate === this.speed) return Promise.resolve();
    if (rate > 0 && this.current >= this.duration - 1e-3) this.current = 0;
    if (rate < 0 && this.current <= 1e-3) this.current = this.duration;
    const wasPlaying = this.playingState;
    if (wasPlaying) {
      this.current = this.clock();
      this.halt();
    }
    this.speed = rate;
    this.playingState = true;
    this.emit('state', { playing: true, rate });
    return this.start();
  }

  shuttle(direction: 1 | -1): Promise<void> {
    const magnitude = Math.abs(this.speed);
    const sameWay = this.playingState && Math.sign(this.speed) === direction;
    const next = sameWay ? (SHUTTLE_RATES.find((r) => r > magnitude) ?? magnitude) : 1;
    return this.play(direction * next);
  }

  pause(): void {
    if (!this.playingState) return;
    this.current = this.clock();
    this.halt();
    this.playingState = false;
    this.speed = 1;
    this.emit('state', { playing: false, rate: 0 });
    this.emit('time', this.current);
    void this.engine.remote.renderStill(this.current, this.bypassFilters);
  }

  private now(): number {
    return this.reverse ? wallClock() : this.audio.now;
  }

  private clock(): number {
    const elapsed = Math.max(0, this.now() - this.origin.clock);
    return Math.max(0, Math.min(this.duration, this.origin.time + elapsed * this.speed));
  }

  private halt() {
    this.generation++;
    this.audio.stopAll();
    void this.engine.remote.stop();
  }

  private restart() {
    this.current = this.clock();
    this.halt();
    void this.start();
  }

  private async start() {
    const generation = ++this.generation;
    if (this.reverse) {
      this.origin = { clock: wallClock(), time: this.current };
      this.tick(generation);
      return;
    }
    const ctx = await this.audio.ready();
    const rate = this.speed;
    const span = this.engine.budget.audioWindowSeconds * rate;
    const from = this.current;
    const end = Math.min(this.duration, from + span);
    const first = (await this.engine.remote.mixAudio(from, end, ctx.sampleRate)) as Float32Array[];
    if (generation !== this.generation) return;
    const startAt = ctx.currentTime + START_LATENCY;
    this.origin = { clock: startAt, time: from };
    this.audio.schedule(first, startAt, rate);
    void this.engine.remote.play({ time: from, epochMs: this.audio.toEpoch(startAt), rate }, this.bypassFilters);
    void this.feedAudio(generation, end, span);
    this.tick(generation);
  }

  private async feedAudio(generation: number, from: number, span: number) {
    const rate = this.speed;
    for (let t = from; t < this.duration; t += span) {
      while (generation === this.generation && t - this.clock() > span * 1.5) await sleep(50);
      if (generation !== this.generation) return;
      const planar = (await this.engine.remote.mixAudio(t, Math.min(this.duration, t + span), this.audio.sampleRate)) as Float32Array[];
      if (generation !== this.generation) return;
      this.audio.schedule(planar, this.origin.clock + (t - this.origin.time) / rate, rate);
    }
  }

  private tick(generation: number) {
    if (generation !== this.generation) return;
    this.current = this.clock();
    this.emit('time', this.current);
    if (this.reverse) void this.engine.remote.renderStill(this.current, this.bypassFilters);
    if (this.reverse ? this.current <= 0 : this.current >= this.duration) {
      this.pause();
      return;
    }
    requestAnimationFrame(() => this.tick(generation));
  }
}
