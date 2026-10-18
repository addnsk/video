import { describe, expect, it } from 'vitest';
import { captureTemplate, placeTemplate } from '../../src/core/graph-templates';
import { emptyProject, type Item, type Project } from '../../src/core/model';
import { createMediaItem } from '../../src/core/operations';

const asset = { id: 'a', width: 640, height: 360, fps: 25, start: 0, end: 4, hasVideo: true } as never;

const base = (): Item => ({
  ...createMediaItem(asset, { id: 'clip' }),
  effects: [
    { id: 'blur', type: 'blur', enabled: true, params: { radius: 4 } },
    { id: 'glow', type: 'glow', enabled: true, params: {} },
    { id: 'other', type: 'invert', enabled: true, params: {} },
  ],
  graph: {
    links: [
      { from: 'source', to: 'blur', input: 'source' },
      { from: 'blur', to: 'glow', input: 'source' },
      { from: 'glow', to: 'output', input: 'input' },
    ],
    positions: { blur: [100, 200], glow: [300, 260], other: [0, 0] },
  },
  animations: { 'node.blur.radius': [{ t: 0, v: 0 }, { t: 1, v: 8 }], 'node.other.amount': [{ t: 0, v: 1 }] },
});

describe('graph templates', () => {
  it('captures chosen nodes with internal links, boundary inputs, output and animations', () => {
    const template = captureTemplate(base(), ['blur', 'glow', 'source'], 'Soft glow');
    expect(template.nodes.map((n) => [n.type, n.position])).toEqual([['blur', [0, 0]], ['glow', [200, 60]]]);
    expect(template.links).toEqual([{ from: 'n0', to: 'n1', input: 'source' }]);
    expect(template.inputs).toEqual([{ node: 'n0', input: 'source' }]);
    expect(template.output).toBe('n1');
    expect(Object.keys(template.animations)).toEqual(['n0.radius']);
  });

  it('places a template with fresh ids, offsets and remapped keyframes', () => {
    const template = captureTemplate(base(), ['blur', 'glow'], 'Soft glow');
    const target: Item = { ...base(), effects: [], graph: { links: [{ from: 'source', to: 'output', input: 'input' }], positions: {} }, animations: {} };
    const project: Project = { ...emptyProject(), tracks: [{ id: 'v1', kind: 'video', magnetic: true, muted: false, items: [target] }] };
    const placed = placeTemplate('clip', template, [10, 20], 'source');
    const item = placed.operation(project).tracks[0].items[0];
    const [blur, glow] = [placed.ids.n0, placed.ids.n1];
    expect(blur).not.toBe('blur');
    expect(item.effects.map((e) => e.type)).toEqual(['blur', 'glow']);
    expect(item.graph!.positions[glow]).toEqual([210, 80]);
    expect(item.graph!.links).toContainEqual({ from: 'source', to: blur, input: 'source' });
    expect(item.graph!.links).toContainEqual({ from: blur, to: glow, input: 'source' });
    expect(item.animations[`node.${blur}.radius`]).toHaveLength(2);
  });
});
