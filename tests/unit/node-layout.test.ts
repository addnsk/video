import { describe, expect, it } from 'vitest';
import { chainGraph } from '../../src/core/graph';
import { NODE_WIDTH, fitView, hitTest, layoutNode } from '../../src/ui/node-layout';

const node = { id: 'n', type: 'merge', params: {}, enabled: true, position: [100, 50] as const };

describe('node layout', () => {
  it('places ports along the node edges', () => {
    const box = layoutNode(node, ['background', 'foreground'], true, { x: 10, y: 20, zoom: 2 });
    expect(box.x).toBe(210);
    expect(box.width).toBe(NODE_WIDTH * 2);
    expect(box.inputs.map((i) => i.x)).toEqual([210, 210]);
    expect(box.inputs[1].y).toBeGreaterThan(box.inputs[0].y);
    expect(box.output?.x).toBe(210 + NODE_WIDTH * 2);
  });

  it('hits ports before bodies and the topmost node first', () => {
    const view = { x: 0, y: 0, zoom: 1 };
    const a = layoutNode({ ...node, id: 'a', position: [0, 0] }, ['source'], true, view);
    const b = layoutNode({ ...node, id: 'b', position: [20, 0] }, ['source'], true, view);
    expect(hitTest([a, b], a.inputs[0].x, a.inputs[0].y, 1)).toMatchObject({ kind: 'input', input: 'source' });
    expect(hitTest([a, b], 60, 30, 1)).toMatchObject({ kind: 'node', box: { node: { id: 'b' } } });
    expect(hitTest([a, b], b.output!.x + 2, b.output!.y, 1)).toMatchObject({ kind: 'output' });
    expect(hitTest([a, b], 900, 900, 1)).toEqual({ kind: 'empty' });
  });

  it('fits the whole graph into the view', () => {
    const graph = chainGraph([{ id: 'g', type: 'grade', enabled: true, params: {} }], { stageOf: () => 0, isVisual: () => true, chainable: () => true });
    const view = fitView(graph, 800, 200);
    const boxes = graph.nodes.map((n) => layoutNode(n, ['source'], true, view));
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(800);
    }
  });
});
