import { Emitter } from '../core/emitter';
import type { EffectDef, FilterDef, TransitionDef } from './types';

export interface RegistryEvents extends Record<string, unknown> {
  change: EffectDef;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

export class EffectRegistry extends Emitter<RegistryEvents> {
  private defs = new Map<string, EffectDef>();

  register(def: EffectDef): void {
    if (!ID_PATTERN.test(def.id)) throw new Error(`Invalid effect id "${def.id}"`);
    const entry = def.kind === 'filter' ? /vec4\s+effect\s*\(/ : /vec4\s+transition\s*\(/;
    if (!entry.test(def.glsl)) throw new Error(`Effect "${def.id}" has no ${def.kind === 'filter' ? 'effect' : 'transition'}() entry point`);
    this.defs.set(def.id, def);
    this.emit('change', def);
  }

  get(id: string): EffectDef | undefined {
    return this.defs.get(id);
  }

  filter(id: string): FilterDef | undefined {
    const def = this.defs.get(id);
    return def?.kind === 'filter' ? def : undefined;
  }

  transition(id: string): TransitionDef | undefined {
    const def = this.defs.get(id);
    return def?.kind === 'transition' ? def : undefined;
  }

  all(): EffectDef[] {
    return [...this.defs.values()];
  }

  transitions(): TransitionDef[] {
    return this.all().filter((d): d is TransitionDef => d.kind === 'transition');
  }

  filters(): FilterDef[] {
    return this.all().filter((d): d is FilterDef => d.kind === 'filter');
  }
}
