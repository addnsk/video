import { dbToGain, panGains, stripValue, type Strip } from '../../core/mix';
import { audioEffect } from '../../effects/audio/builtin';
import type { AudioProcessor } from '../../effects/audio/types';
import type { Planar } from './pcm';

const CONTROL_FRAMES = 64;

interface StripState {
  processors: Map<string, AudioProcessor>;
  next: number;
  used: boolean;
}

export class StripBank {
  private states = new Map<string, StripState>();

  begin(): void {
    for (const state of this.states.values()) state.used = false;
  }

  end(): void {
    for (const [id, state] of this.states) if (!state.used) this.states.delete(id);
  }

  process(id: string, strip: Strip, planar: Planar, time: number, rate: number): void {
    const frames = planar[0]?.length ?? 0;
    if (strip.mute) {
      for (const ch of planar) ch.fill(0);
      return;
    }
    const state = this.state(id, time, rate);
    for (const effect of strip.effects) {
      const def = effect.enabled ? audioEffect(effect.type) : undefined;
      if (!def) continue;
      let processor = state.processors.get(effect.id);
      if (!processor) state.processors.set(effect.id, (processor = def.create(rate, planar.length)));
      processor.process(planar, effect.params);
    }
    state.next = time + frames / rate;
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

  private state(id: string, time: number, rate: number): StripState {
    let state = this.states.get(id);
    if (!state || Math.abs(state.next - time) > 2 / rate) {
      state = { processors: new Map(), next: time, used: true };
      this.states.set(id, state);
    }
    state.used = true;
    return state;
  }
}
