import { describe, expect, it } from 'vitest';
import { problemsOf } from './invariants';
import { run, type Action } from './world';

const cases: Record<string, Action[]> = {
  'removing the only overlay track survives save and load': [{ kind: 'removeTrack', track: 40 }] as Action[],
  'a multi-input node does not get chained after disabling and enabling the graph': [
    { kind: 'insert', asset: 0, track: 0, at: 0, span: 0 },
    { kind: 'enableGraph', item: 0 },
    { kind: 'addNode', item: 0, type: 318 },
    { kind: 'disableGraph', item: 0 },
    { kind: 'enableGraph', item: 0 },
  ] as Action[],
  'removing an effect drops the keyframes of its node': [
    { kind: 'insert', asset: 0, track: 0, at: 0, span: 0 },
    { kind: 'grade', item: 0, exposure: 0.2 },
    { kind: 'nodeKey', item: 0, node: 0, t: 0.5, v: 0.3 },
    { kind: 'removeEffect', item: 0, type: 'grade' },
  ] as Action[],
};

describe('fuzz regressions', () => {
  for (const [name, actions] of Object.entries(cases)) {
    it(name, () => {
      run(actions, (project, a) => expect(problemsOf(project), a.kind).toEqual([]));
    });
  }
});
