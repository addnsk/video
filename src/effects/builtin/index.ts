import type { EffectRegistry } from '../registry';
import { GRADE, LUT } from './grade';
import { TRANSITIONS } from './transitions';

export const BUILTIN_EFFECTS = [GRADE, LUT, ...TRANSITIONS];

export function registerBuiltins(registry: EffectRegistry): void {
  for (const def of BUILTIN_EFFECTS) registry.register(def);
}
