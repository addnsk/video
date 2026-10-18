import { describe, expect, it } from 'vitest';
import { chainGraph, connect, addNode, type NodeGraph } from '../../src/core/graph';
import type { FilterDef, NodeDef } from '../../src/effects/types';
import { renderGraph, type GraphRuntime } from '../../src/engine/gpu/graph-renderer';

interface Image {
  readonly label: string;
}

const filters: Record<string, FilterDef> = { grade: { kind: 'filter', id: 'grade', name: 'Grade', params: [], glsl: '' }, missing: { kind: 'filter', id: 'missing', name: 'M', params: [], glsl: '' } };
const nodes: Record<string, NodeDef> = {
  merge: { kind: 'node', id: 'merge', name: 'Merge', category: 'composite', inputs: [{ name: 'background' }, { name: 'foreground' }], params: [], passes: [] },
  background: { kind: 'node', id: 'background', name: 'Bg', category: 'generator', inputs: [], params: [], passes: [] },
};
const lookup = { filter: (t: string) => filters[t], node: (t: string) => nodes[t] };

const runtime = (sourceAvailable = true) => {
  const live = new Set<Image>();
  const make = (label: string) => {
    const image = { label };
    live.add(image);
    return image;
  };
  const calls: string[] = [];
  const rt: GraphRuntime<Image> & { live: Set<Image>; calls: string[] } = {
    live,
    calls,
    source: () => (sourceAvailable ? make('source') : null),
    filter: (def, _effect, input) => {
      calls.push(def.id);
      return def.id === 'missing' ? input : make(`${def.id}(${input.label})`);
    },
    node: (def, _params, inputs) => {
      calls.push(def.id);
      return make(`${def.id}(${[...inputs].map(([k, v]) => `${k}=${v.label}`).join(',')})`);
    },
    release: (image) => {
      if (!live.delete(image)) throw new Error(`double release of ${image.label}`);
    },
  };
  return rt;
};

const fx = (id: string, type: string, enabled = true) => ({ id, type, enabled, params: {} });

describe('renderGraph', () => {
  it('renders a chain and releases intermediates', () => {
    const rt = runtime();
    const out = renderGraph(chainGraph([fx('g', 'grade'), fx('m', 'missing')], () => 0), 'output', lookup, rt);
    expect(out?.label).toBe('grade(source)');
    expect([...rt.live]).toEqual([out]);
  });

  it('passes disabled nodes through', () => {
    const rt = runtime();
    const out = renderGraph(chainGraph([fx('g', 'grade', false)], () => 0), 'output', lookup, rt);
    expect(out?.label).toBe('source');
    expect(rt.calls).toEqual([]);
    expect(rt.live.size).toBe(1);
  });

  it('shares a branch between consumers and frees it after the last one', () => {
    let g: NodeGraph = chainGraph([fx('g', 'grade')], () => 0);
    g = addNode(g, { id: 'mix', type: 'merge', params: {}, enabled: true, position: [0, 0] });
    g = connect(g, { from: 'source', to: 'mix', input: 'background' });
    g = connect(g, { from: 'g', to: 'mix', input: 'foreground' });
    g = connect(g, { from: 'mix', to: 'output', input: 'input' });
    const rt = runtime();
    const out = renderGraph(g, 'output', lookup, rt);
    expect(out?.label).toBe('merge(background=source,foreground=grade(source))');
    expect([...rt.live]).toEqual([out]);
  });

  it('renders generators without a source and survives a missing source', () => {
    let g: NodeGraph = chainGraph([], () => 0);
    g = addNode(g, { id: 'bg', type: 'background', params: {}, enabled: true, position: [0, 0] });
    g = connect(g, { from: 'bg', to: 'output', input: 'input' });
    expect(renderGraph(g, 'output', lookup, runtime(false))?.label).toBe('background()');
    const rt = runtime(false);
    expect(renderGraph(chainGraph([fx('g', 'grade')], () => 0), 'output', lookup, rt)).toBeNull();
    expect(rt.live.size).toBe(0);
  });

  it('releases unused results such as a dangling source', () => {
    let g: NodeGraph = chainGraph([], () => 0);
    g = addNode(g, { id: 'bg', type: 'background', params: {}, enabled: true, position: [0, 0] });
    g = connect(g, { from: 'bg', to: 'output', input: 'input' });
    const rt = runtime();
    renderGraph(g, 'output', lookup, rt);
    expect([...rt.live].map((i) => i.label)).toEqual(['background()']);
  });
});
