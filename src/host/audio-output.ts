export class AudioOutput {
  private context: AudioContext | null = null;
  private sources = new Set<AudioBufferSourceNode>();

  async ready(): Promise<AudioContext> {
    this.context ??= new AudioContext({ latencyHint: 'playback' });
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
    const buffer = ctx.createBuffer(planar.length, frames, ctx.sampleRate);
    planar.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c));
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = rate;
    node.connect(ctx.destination);
    node.onended = () => this.sources.delete(node);
    this.sources.add(node);
    node.start(Math.max(when, ctx.currentTime));
  }

  stopAll(): void {
    for (const node of this.sources) node.stop();
    this.sources.clear();
  }
}
