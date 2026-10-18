import { describe, expect, it } from 'vitest';
import { TEXT_NODE } from '../../src/effects/builtin/text-node';
import { nodeSource } from '../../src/engine/gpu/shaders';
import { textLayoutParams } from '../../src/engine/text-raster';

describe('text node', () => {
  it('declares raster helpers and skips text uniforms', () => {
    const source = nodeSource(TEXT_NODE, 0);
    expect(source).toContain('vec4 raster(vec2 uv)');
    expect(source).toContain('uniform highp sampler2D u_glyph_data;');
    expect(source).not.toMatch(/uniform \w+ text;/);
    expect(nodeSource(TEXT_NODE, 1)).toContain('vec4 previous(vec2 uv) { return texture(u_previous, uv); }');
  });

  it('normalizes layout params', () => {
    expect(textLayoutParams({ text: 'A', align: 'diagonal', size: -1, outlineWidth: -2 })).toMatchObject({ text: 'A', align: 'center', size: 0.001, outlineWidth: 0 });
    expect(textLayoutParams({ weight: '700', align: 'right' })).toMatchObject({ weight: 700, align: 'right', font: 'IBM Plex Sans' });
  });
});
