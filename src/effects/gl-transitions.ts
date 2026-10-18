import type { ScalarParamSpec, ScalarParamType, TransitionDef } from './types';

const UNIFORM_PATTERN = /uniform\s+(float|int|bool|vec2|vec3|vec4)\s+(\w+)\s*;[ \t]*(?:\/\/\s*=\s*([^\n]+))?/g;
const RESERVED = new Set(['progress', 'ratio']);
const SIZES: Record<ScalarParamType, number> = { float: 1, int: 1, bool: 1, vec2: 2, vec3: 3, vec4: 4 };

function parseDefault(type: ScalarParamType, raw: string | undefined): ScalarParamSpec['default'] {
  if (type === 'bool') return /true/.test(raw ?? '');
  const body = raw?.replace(/^[a-z]\w*\s*\(/i, '') ?? '';
  const numbers = (body.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
  const size = SIZES[type];
  if (size === 1) return numbers[0] ?? 0;
  return Array.from({ length: size }, (_, i) => numbers[i] ?? numbers[0] ?? 0);
}

function inferRange(value: ScalarParamSpec['default']): Pick<ScalarParamSpec, 'min' | 'max' | 'step'> {
  if (typeof value !== 'number') return {};
  const max = Math.abs(value) > 1 ? Math.abs(value) * 2 : 1;
  return { min: Math.min(0, value), max, step: max / 100 };
}

export function parseUniforms(glsl: string): ScalarParamSpec[] {
  const out: ScalarParamSpec[] = [];
  for (const match of glsl.matchAll(UNIFORM_PATTERN)) {
    const [, type, name, raw] = match;
    if (RESERVED.has(name)) continue;
    const value = parseDefault(type as ScalarParamType, raw?.trim());
    out.push({ name, type: type as ScalarParamType, default: value, ...inferRange(value) });
  }
  return out;
}

export function glTransition(id: string, name: string, glsl: string): TransitionDef {
  return { kind: 'transition', id, name, glsl, params: parseUniforms(glsl) };
}
