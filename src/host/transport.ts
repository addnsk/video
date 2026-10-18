import { Emitter } from '../core/emitter';
import type { Store } from '../core/store';
import { projectDuration } from '../core/timeline';
import { AudioOutput } from './audio-output';
import type { EngineClient } from './engine-client';

export interface TransportEvents extends Record<string, unknown> {
  time: number;
  state: { playing: boolean };
}

const START_LATENCY = 0.08;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Transport extends Emitter<TransportEvents> {
  private current = 0;
  private playingState = false;
  private generation = 0;
  private origin = { context: 0, time: 0 };
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

  async play(): Promise<void> {
    if (this.playingState || this.duration === 0) return;
    if (this.current >= this.duration - 1e-3) this.current = 0;
    this.playingState = true;
    this.emit('state', { playing: true });
    await this.start();
  }

  pause(): void {
    if (!this.playingState) return;
    this.current = this.clock();
    this.halt();
    this.playingState = false;
    this.emit('state', { playing: false });
    this.emit('time', this.current);
    void this.engine.remote.renderStill(this.current, this.bypassFilters);
  }

  private clock(): number {
    return Math.min(this.duration, this.origin.time + Math.max(0, this.audio.now - this.origin.context));
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
    const ctx = await this.audio.ready();
    const window = this.engine.budget.audioWindowSeconds;
    const from = this.current;
    const end = Math.min(this.duration, from + window);
    const first = (await this.engine.remote.mixAudio(from, end, ctx.sampleRate)) as Float32Array[];
    if (generation !== this.generation) return;
    const startAt = ctx.currentTime + START_LATENCY;
    this.origin = { context: startAt, time: from };
    this.audio.schedule(first, startAt);
    void this.engine.remote.play({ time: from, epochMs: this.audio.toEpoch(startAt) }, this.bypassFilters);
    void this.feedAudio(generation, end, window);
    this.tick(generation);
  }

  private async feedAudio(generation: number, from: number, window: number) {
    for (let t = from; t < this.duration; t += window) {
      while (generation === this.generation && t - this.clock() > window * 1.5) await sleep(50);
      if (generation !== this.generation) return;
      const planar = (await this.engine.remote.mixAudio(t, Math.min(this.duration, t + window), this.audio.sampleRate)) as Float32Array[];
      if (generation !== this.generation) return;
      this.audio.schedule(planar, this.origin.context + (t - this.origin.time));
    }
  }

  private tick(generation: number) {
    if (generation !== this.generation) return;
    this.current = this.clock();
    this.emit('time', this.current);
    if (this.current >= this.duration) {
      this.pause();
      return;
    }
    requestAnimationFrame(() => this.tick(generation));
  }
}
