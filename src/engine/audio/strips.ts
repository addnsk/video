import { dbToGain, panGains, stripValue, type Strip } from '../../core/mix';
import { audioEffect } from '../../effects/audio/builtin';
import type { AudioProcessor } from '../../effects/audio/types';
import type { Planar } from './pcm';

const CONTROL_FRAMES = 64;

interface State {
  processors: Map<string, AudioProcessor>;
  line: Float32Array[] | null;
  next: number;
  used: boolean;
}

export class StripBank {
  private states = new Map<string, State>();

  begin(): void {
    for (const state of this.states.values()) state.used = false;
  }

  end(): void {
    for (const [id, state] of this.states) if (!state.used) this.states.delete(id);
  }

  effects(id: string, strip: Strip, planar: Planar, time: number, rate: number): void {
    const frames = planar[0]?.length ?? 0;
    const state = this.state(id, time, rate);
    state.next = time + frames / rate;
    if (strip.mute) {
      for (const ch of planar) ch.fill(0);
      return;
    }
    const trim = strip.trim ? dbToGain(strip.trim) : 1;
    if (trim !== 1) for (const ch of planar) for (let i = 0; i < ch.length; i++) ch[i] *= trim;
    for (const effect of strip.effects) {
      const def = effect.enabled ? audioEffect(effect.type) : undefined;
      if (!def) continue;
      let processor = state.processors.get(effect.id);
      if (!processor) state.processors.set(effect.id, (processor = def.create(rate, planar.length)));
      processor.process(planar, effect.params);
    }
  }

  gain(strip: Strip, planar: Planar, time: number, rate: number): void {
    const frames = planar[0]?.length ?? 0;
    const constant = !strip.animations.volume && !strip.animations.pan;
    for (let start = 0; start < frames; start += CONTROL_FRAMES) {
      const end = Math.min(frames, start + CONTROL_FRAMES);
      const at = time + start / rate;
      const gain = dbToGain(stripValue(strip, 'volume', at));
      const pan = panGains(stripValue(strip, 'pan', at));
      if (constant && gain === 1 && pan[0] === 1 && pan[1] === 1) return;
      planar.forEach((ch, c) => {
        const g = gain * (planar.length === 2 ? pan[c] : 1);
        for (let i = start; i < end; i++) ch[i] *= g;
      });
    }
  }

  process(id: string, strip: Strip, planar: Planar, time: number, rate: number): void {
    this.effects(id, strip, planar, time, rate);
    this.gain(strip, planar, time, rate);
  }

  delay(id: string, planar: Planar, frames: number, gain: number, time: number, rate: number): Planar {
    const length = planar[0]?.length ?? 0;
    if (frames <= 0) return planar.map((ch) => ch.map((v) => v * gain));
    const state = this.state(id, time, rate);
    state.next = time + length / rate;
    if (!state.line || state.line[0].length !== frames) state.line = planar.map(() => new Float32Array(frames));
    const line = state.line;
    return planar.map((ch, c) => {
      const joined = new Float32Array(frames + length);
      joined.set(line[c]);
      joined.set(ch, frames);
      line[c] = joined.slice(length);
      const out = joined.subarray(0, length);
      if (gain !== 1) for (let i = 0; i < length; i++) out[i] *= gain;
      return out;
    });
  }

  private state(id: string, time: number, rate: number): State {
    let state = this.states.get(id);
    if (!state || Math.abs(state.next - time) > 2 / rate) {
      state = { processors: new Map(), line: null, next: time, used: true };
      this.states.set(id, state);
    }
    state.used = true;
    return state;
  }
}
