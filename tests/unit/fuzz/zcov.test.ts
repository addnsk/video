import fc from 'fast-check';
import { it } from 'vitest';
import { action, run, toOperation, items } from './world';
it('coverage', () => {
  const applied: Record<string, number> = {};
  const seen: Record<string, number> = {};
  let maxItems = 0, graphs = 0, nodes = 0, versions = 0;
  fc.assert(fc.property(fc.array(action, { minLength: 10, maxLength: 150 }), (actions) => {
    run(actions, (p, a) => {
      seen[a.kind] = (seen[a.kind] ?? 0) + 1;
      maxItems = Math.max(maxItems, items(p).length);
    });
    const { store } = run(actions);
    for (const i of items(store.project)) { if (i.graph) graphs++; nodes += i.effects.length; versions += Object.keys(i.gradeVersions ?? {}).length; }
  }), { numRuns: 500 });
  console.log(JSON.stringify({ maxItems, graphs, nodes, versions }));
});
