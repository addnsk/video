import type { EffectRegistry } from '../registry';
import { CURVES } from './curves';
import { GRADE, LUT } from './grade';
import { BUILTIN_NODES } from './nodes';
import { TRANSITIONS } from './transitions';

export const BUILTIN_EFFECTS = [GRADE, CURVES, LUT, ...TRANSITIONS, ...BUILTIN_NODES];

export function registerBuiltins(registry: EffectRegistry): void {
  for (const def of BUILTIN_EFFECTS) registry.register(def);
}
