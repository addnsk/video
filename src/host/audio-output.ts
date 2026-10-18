import { LoudnessMeter, type LoudnessReading } from '../effects/audio/loudness';

export class AudioOutput {
  private context: AudioContext | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private meter: LoudnessMeter | null = null;
  private bus: { input: GainNode; analysers: AnalyserNode[]; buffer: Float32Array<ArrayBuffer> } | null = null;

  async ready(): Promise<AudioContext> {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'playback' });
      this.bus = this.createBus(this.context);
    }
    if (this.context.state !== 'running') await this.context.resume();
    return this.context;
  }

  get sampleRate(): number {
    return this.context?.sampleRate ?? 48000;
  }

  get now(): number {
    return this.context?.currentTime ?? 0;
  }

  toEpoch(contextTime: number): number {
    const ctx = this.context!;
    const stamp = ctx.getOutputTimestamp?.();
    if (stamp?.contextTime !== undefined && stamp.performanceTime !== undefined && stamp.performanceTime > 0)
      return performance.timeOrigin + stamp.performanceTime + (contextTime - stamp.contextTime) * 1000;
    return performance.timeOrigin + performance.now() + (contextTime - ctx.currentTime - ctx.baseLatency) * 1000;
  }

  schedule(planar: Float32Array[], when: number, rate = 1): void {
    const ctx = this.context!;
    const frames = planar[0]?.length ?? 0;
    if (!frames) return;
    if (rate === 1) (this.meter ??= new LoudnessMeter(ctx.sampleRate, 2)).push(planar);
    const buffer = ctx.createBuffer(planar.length, frames, ctx.sampleRate);
    planar.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c));
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = rate;
    node.connect(this.bus!.input);
    node.onended = () => this.sources.delete(node);
    this.sources.add(node);
    node.start(Math.max(when, ctx.currentTime));
  }

  levels(): number[] {
    const bus = this.bus;
    if (!bus) return [0, 0];
    return bus.analysers.map((analyser) => {
      analyser.getFloatTimeDomainData(bus.buffer);
      let peak = 0;
      for (const v of bus.buffer) peak = Math.max(peak, Math.abs(v));
      return peak;
    });
  }

  private createBus(ctx: AudioContext) {
    const input = ctx.createGain();
    input.connect(ctx.destination);
    const splitter = ctx.createChannelSplitter(2);
    input.connect(splitter);
    const analysers = [0, 1].map((channel) => {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      splitter.connect(analyser, channel);
      return analyser;
    });
    return { input, analysers, buffer: new Float32Array(1024) };
  }

  loudness(): LoudnessReading | null {
    return this.meter?.reading() ?? null;
  }

  stopAll(): void {
    this.meter = null;
    for (const node of this.sources) node.stop();
    this.sources.clear();
  }
}
