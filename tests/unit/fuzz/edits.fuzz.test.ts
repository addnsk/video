import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { problemsOf, sameProject } from './invariants';
import { action, run } from './world';

const RUNS = Number(process.env.FUZZ_RUNS ?? 300);
const sequence = fc.array(action, { minLength: 10, maxLength: 150 });

describe('random edit sequences', () => {
  it('keep every project invariant after every step', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        run(actions, (project, a) => {
          const problems = problemsOf(project);
          if (problems.length) throw new Error(`after ${a.kind}: ${problems.slice(0, 5).join('; ')}`);
        });
      }),
      { numRuns: RUNS },
    );
  });

  it('undo walks back to the start and redo replays to the end exactly', () => {
    fc.assert(
      fc.property(sequence.map((list) => list.filter((a) => a.kind !== 'undo' && a.kind !== 'redo')), (actions) => {
        const snapshots: ReturnType<typeof run>['store']['project'][] = [];
        const { store } = run([], () => undefined);
        snapshots.push(store.project);
        const outcome = run(actions, (project) => {
          if (snapshots.at(-1) !== project) snapshots.push(project);
        });
        const s = outcome.store;
        const history = [s.project];
        while (s.undo()) history.push(s.project);
        expect(sameProject(s.project, snapshots[0])).toBe(true);
        const forward = [s.project];
        while (s.redo()) forward.push(s.project);
        expect(sameProject(s.project, history[0])).toBe(true);
        expect(forward.length).toBe(history.length);
      }),
      { numRuns: RUNS },
    );
  });

  it('operations never throw except for refused links', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const { thrown } = run(actions);
        const unexpected = thrown.filter((t) => !/cycle|no input|Unknown node|cannot hold/i.test(t));
        expect(unexpected).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });
});
