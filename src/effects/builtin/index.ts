import type { EffectRegistry } from '../registry';
import { COLOR_FILTERS, COLOR_NODES } from './color-nodes';
import { CURVES } from './curves';
import { GRADE, LUT } from './grade';
import { BUILTIN_NODES } from './nodes';
import { TRANSITIONS } from './transitions';

export const BUILTIN_EFFECTS = [GRADE, CURVES, LUT, ...COLOR_FILTERS, ...TRANSITIONS, ...BUILTIN_NODES, ...COLOR_NODES];

export function registerBuiltins(registry: EffectRegistry): void {
  for (const def of BUILTIN_EFFECTS) registry.register(def);
}
