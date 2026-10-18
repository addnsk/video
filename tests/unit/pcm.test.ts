import { describe, expect, it } from 'vitest';
import { mixInto, resampleLinear, silence } from '../../src/engine/audio/pcm';

const unity = { gain: () => 1 };

describe('pcm', () => {
  it('creates silent planar buffers', () => {
    const buffer = silence(2, 4);
    expect(buffer).toHaveLength(2);
    expect([...buffer[1]]).toEqual([0, 0, 0, 0]);
  });

  it('returns input when rates match', () => {
    const input = new Float32Array([1, 2]);
    expect(resampleLinear(input, 48000, 48000)).toBe(input);
  });

  it('interpolates when upsampling', () => {
    const out = resampleLinear(new Float32Array([0, 1, 0, 1]), 1, 2);
    expect(out).toHaveLength(8);
    expect(out[1]).toBeCloseTo(0.5);
    expect(out[2]).toBeCloseTo(1);
  });

  it('decimates when downsampling', () => {
    const out = resampleLinear(new Float32Array([0, 1, 2, 3, 4, 5]), 2, 1);
    expect([...out]).toEqual([0, 2, 4]);
  });

  it('mixes with offset and accumulates', () => {
    const target = silence(2, 4);
    target[0][3] = 1;
    mixInto(target, [new Float32Array([1, 1])], 2, 0, 48000, unity);
    expect([...target[0]]).toEqual([0, 0, 1, 2]);
    expect([...target[1]]).toEqual([0, 0, 1, 1]);
  });

  it('clips source at buffer end and skips negative offsets', () => {
    const target = silence(1, 3);
    mixInto(target, [new Float32Array([1, 2, 3, 4, 5])], -1, 0, 1, unity);
    expect([...target[0]]).toEqual([2, 3, 4]);
  });

  it('applies envelope by time', () => {
    const target = silence(1, 4);
    mixInto(target, [new Float32Array([1, 1, 1, 1])], 0, 10, 2, { gain: (t) => t - 10 });
    expect([...target[0]]).toEqual([0, 0.5, 1, 1.5]);
  });
});
