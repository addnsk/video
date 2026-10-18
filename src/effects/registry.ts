import { Emitter } from '../core/emitter';
import type { EffectDef, FilterDef, NodeDef, TransitionDef } from './types';

export interface RegistryEvents extends Record<string, unknown> {
  change: EffectDef;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

export class EffectRegistry extends Emitter<RegistryEvents> {
  private defs = new Map<string, EffectDef>();

  register(def: EffectDef): void {
    if (!ID_PATTERN.test(def.id)) throw new Error(`Invalid effect id "${def.id}"`);
    if (def.kind === 'node') {
      if (!def.passes.length || def.passes.some((p) => !/vec4\s+process\s*\(/.test(p.glsl))) throw new Error(`Node "${def.id}" needs a process() entry point in every pass`);
    } else {
      const entry = def.kind === 'filter' ? /vec4\s+effect\s*\(/ : /vec4\s+transition\s*\(/;
      if (!entry.test(def.glsl)) throw new Error(`Effect "${def.id}" has no ${def.kind === 'filter' ? 'effect' : 'transition'}() entry point`);
    }
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

  node(id: string): NodeDef | undefined {
    const def = this.defs.get(id);
    return def?.kind === 'node' ? def : undefined;
  }

  nodes(): NodeDef[] {
    return this.all().filter((d): d is NodeDef => d.kind === 'node');
  }

  inputsOf(type: string): readonly string[] | undefined {
    const def = this.defs.get(type);
    if (def?.kind === 'filter') return ['source'];
    if (def?.kind === 'node') return def.inputs.map((i) => i.name);
    return undefined;
  }

  stageOf(type: string): number {
    return this.filter(type)?.stage ?? 50;
  }

  chainable(type: string): boolean {
    return this.inputsOf(type)?.includes('source') ?? false;
  }

  isVisual(type: string): boolean {
    const kind = this.defs.get(type)?.kind;
    return kind === 'filter' || kind === 'node';
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
