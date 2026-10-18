import { describe, expect, it } from 'vitest';
import {
  GraphError,
  OUTPUT_NODE,
  SOURCE_NODE,
  addNode,
  chainGraph,
  connect,
  disconnect,
  evaluationOrder,
  insertAfter,
  removeNode,
  updateNode,
  upstream,
  validateGraph,
  type GraphNode,
  type NodeGraph,
} from '../../src/core/graph';

const lookup = (type: string) => ({ blur: { inputs: ['source'] }, merge: { inputs: ['background', 'foreground'] }, grade: { inputs: ['source'] } })[type];
const node = (id: string, type: string): GraphNode => ({ id, type, params: {}, enabled: true, position: [0, 0] });
const fx = (id: string, type: string) => ({ id, type, enabled: true, params: { a: 1 } });

const base = (): NodeGraph => chainGraph([fx('b', 'blur'), fx('g', 'grade')], (t) => (t === 'grade' ? 10 : 50));

describe('node graph', () => {
  it('builds a chain from effects in stage order', () => {
    const g = base();
    expect(g.nodes.map((n) => n.type)).toEqual([SOURCE_NODE, 'grade', 'blur', OUTPUT_NODE]);
    expect(evaluationOrder(g, 'output')).toEqual(['source', 'g', 'b', 'output']);
    expect(validateGraph(g, lookup)).toEqual([]);
  });

  it('evaluates branches once and in dependency order', () => {
    let g = addNode(base(), node('m', 'merge'));
    g = connect(g, { from: 'source', to: 'm', input: 'background' });
    g = connect(g, { from: 'b', to: 'm', input: 'foreground' });
    g = connect(g, { from: 'm', to: 'output', input: 'input' });
    const order = evaluationOrder(g, 'output');
    expect(order.filter((id) => id === 'source')).toHaveLength(1);
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('m'));
    expect(order.at(-1)).toBe('output');
    expect(validateGraph(g, lookup)).toEqual([]);
  });

  it('refuses cycles and replaces an input link', () => {
    const g = base();
    expect(() => connect(g, { from: 'b', to: 'g', input: 'source' })).toThrow(GraphError);
    expect(() => connect(g, { from: 'g', to: 'g', input: 'source' })).toThrow('cycle');
    const rewired = connect(g, { from: 'source', to: 'b', input: 'source' });
    expect(rewired.links.filter((l) => l.to === 'b')).toEqual([{ from: 'source', to: 'b', input: 'source' }]);
    expect(upstream(rewired, 'output')).toEqual(new Set(['b', 'source']));
  });

  it('removes nodes and bridges the primary input', () => {
    const g = removeNode(base(), 'g', 'source');
    expect(evaluationOrder(g, 'output')).toEqual(['source', 'b', 'output']);
    expect(removeNode(base(), 'output')).toEqual(base());
    const cut = removeNode(base(), 'g');
    expect(evaluationOrder(cut, 'output')).toEqual(['b', 'output']);
  });

  it('inserts after a node and updates params', () => {
    let g = insertAfter(base(), 'source', node('n', 'blur'), 'source');
    expect(evaluationOrder(g, 'output')).toEqual(['source', 'n', 'g', 'b', 'output']);
    g = updateNode(g, 'g', { params: { b: 2 }, enabled: false });
    expect(g.nodes.find((n) => n.id === 'g')).toMatchObject({ params: { a: 1, b: 2 }, enabled: false });
    expect(disconnect(g, 'output', 'input').links.some((l) => l.to === 'output')).toBe(false);
  });

  it('reports structural problems', () => {
    const broken: NodeGraph = {
      nodes: [node('s', SOURCE_NODE), node('x', 'nope'), node('o', OUTPUT_NODE), node('o2', OUTPUT_NODE)],
      links: [{ from: 's', to: 'o', input: 'wrong' }, { from: 'ghost', to: 'o', input: 'input' }],
    };
    const problems = validateGraph(broken, lookup);
    expect(problems).toEqual(expect.arrayContaining(['Unknown node type nope', 'A graph needs exactly one output node', 'Node o has no input wrong']));
    expect(problems.some((p) => p.includes('missing node'))).toBe(true);
    expect(() => addNode(base(), node('g', 'blur'))).toThrow('already exists');
  });
});
