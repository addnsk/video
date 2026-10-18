import { describe, expect, it } from 'vitest';
import { BUILTIN_EFFECTS } from '../../src/effects/builtin';
import { isReservedGlslName } from '../../src/effects/glsl-names';


describe('GLSL names', () => {
  it('no built-in effect uses a reserved word or built-in function as a parameter or input name', () => {
    const clashes: string[] = [];
    for (const def of BUILTIN_EFFECTS) {
      for (const p of def.params) if (isReservedGlslName(p.name)) clashes.push(`${def.id}.${p.name}`);
      if (def.kind === 'node') for (const i of def.inputs) if (isReservedGlslName(i.name)) clashes.push(`${def.id} input ${i.name}`);
    }
    expect(clashes).toEqual([]);
  });
});
