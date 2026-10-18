import { describe, expect, it } from 'vitest';
import { BMD_WIDE_GAMUT_GEN5, REC709, gamutMatrix, rgbToXyz } from '../../src/effects/colorspace';
import { parseCube } from '../../src/effects/cube';
import { parseUniforms } from '../../src/effects/gl-transitions';

describe('gl-transitions params', () => {
  it('reads uniforms with defaults', () => {
    const params = parseUniforms(`
uniform float smoothness; // = 0.3
uniform vec2 direction; // = vec2(1.0, -1.0)
uniform bool opening; // = true
uniform float progress;`);
    expect(params.map((p) => [p.name, p.default])).toEqual([
      ['smoothness', 0.3],
      ['direction', [1, -1]],
      ['opening', true],
    ]);
  });
});

describe('color spaces', () => {
  it('maps white to white', () => {
    const m = gamutMatrix(BMD_WIDE_GAMUT_GEN5, REC709);
    const white = [m[0] + m[1] + m[2], m[3] + m[4] + m[5], m[6] + m[7] + m[8]];
    white.forEach((v) => expect(v).toBeCloseTo(1, 5));
  });

  it('matches the published Rec.709 luminance row', () => {
    const m = rgbToXyz(REC709);
    expect(m[3]).toBeCloseTo(0.2126, 3);
    expect(m[4]).toBeCloseTo(0.7152, 3);
    expect(m[5]).toBeCloseTo(0.0722, 3);
  });
});

describe('cube parser', () => {
  it('parses an identity LUT', () => {
    const lines = ['TITLE "id"', 'LUT_3D_SIZE 2'];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(`${r} ${g} ${b}`);
    const lut = parseCube(lines.join('\n'));
    expect(lut.size).toBe(2);
    expect(Array.from(lut.data.slice(3, 6))).toEqual([1, 0, 0]);
  });

  it('rejects truncated data', () => {
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0')).toThrow();
  });
});
