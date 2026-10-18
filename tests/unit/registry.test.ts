import { describe, expect, it } from 'vitest';
import { EffectRegistry } from '../../src/effects/registry';
import type { EffectDef } from '../../src/effects/types';

const filter = (id: string, glsl = 'vec4 effect(vec4 c, vec2 uv) { return c; }') => ({ id, kind: 'filter', name: id, glsl, params: [] }) as unknown as EffectDef;
const transition = (id: string) =>
  ({ id, kind: 'transition', name: id, glsl: 'vec4 transition(vec2 uv) { return vec4(0.0); }', params: [] }) as unknown as EffectDef;

describe('EffectRegistry', () => {
  it('rejects invalid ids and missing entry points', () => {
    const registry = new EffectRegistry();
    expect(() => registry.register(filter('bad id'))).toThrow('Invalid effect id');
    expect(() => registry.register(filter('ok', 'void main() {}'))).toThrow('effect() entry point');
    expect(() => registry.register({ ...transition('t'), glsl: 'vec4 effect(vec4 c) { return c; }' } as EffectDef)).toThrow('transition() entry point');
  });

  it('splits filters and transitions and emits changes', () => {
    const registry = new EffectRegistry();
    const changed: string[] = [];
    registry.on('change', (d) => changed.push(d.id));
    registry.register(filter('f'));
    registry.register(transition('t'));
    expect(registry.filter('f')?.id).toBe('f');
    expect(registry.filter('t')).toBeUndefined();
    expect(registry.transition('t')?.id).toBe('t');
    expect(registry.filters().map((d) => d.id)).toEqual(['f']);
    expect(registry.transitions().map((d) => d.id)).toEqual(['t']);
    expect(changed).toEqual(['f', 't']);
  });

  it('replaces definitions with the same id', () => {
    const registry = new EffectRegistry();
    registry.register(filter('f'));
    registry.register({ ...filter('f'), name: 'Second' } as EffectDef);
    expect(registry.all()).toHaveLength(1);
    expect(registry.get('f')?.name).toBe('Second');
  });
});
