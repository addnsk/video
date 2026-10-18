import { describe, expect, it } from 'vitest';
import { addStill, applyGrade, captureGrade, loadGradeVersion, removeGradeVersion, removeStill, saveGradeVersion } from '../../src/core/grades';
import { emptyProject, type Item, type Project } from '../../src/core/model';
import { createMediaItem } from '../../src/core/operations';

const asset = { id: 'a', width: 640, height: 360, fps: 25, start: 0, end: 4, hasVideo: true } as never;

const graded = (exposure: number, id = 'clip'): Item => ({
  ...createMediaItem(asset, { id }),
  effects: [{ id: 'blur', type: 'blur', enabled: true, params: { radius: exposure } }],
  graph: { links: [{ from: 'source', to: 'blur', input: 'source' }, { from: 'blur', to: 'output', input: 'input' }], positions: {} },
  animations: { 'node.blur.radius': [{ t: 0, v: exposure }], opacity: [{ t: 0, v: 0.5 }] },
});

const project = (...items: Item[]): Project => {
  const base = emptyProject();
  return { ...base, tracks: [{ ...base.tracks[0], items }, ...base.tracks.slice(1)] };
};

const item = (p: Project, i = 0) => p.tracks[0].items[i];

describe('grades', () => {
  it('captures only grade animations', () => {
    expect(Object.keys(captureGrade(graded(2)).animations)).toEqual(['node.blur.radius']);
  });

  it('applies a grade with fresh node ids and keeps other animations', () => {
    const target = { ...graded(0, 'other'), effects: [], graph: undefined, animations: { opacity: [{ t: 1, v: 1 }] } };
    const result = item(applyGrade('other', captureGrade(graded(5)))(project(graded(5), target)), 1);
    const id = result.effects[0].id;
    expect(id).not.toBe('blur');
    expect(result.graph!.links).toContainEqual({ from: id, to: 'output', input: 'input' });
    expect(result.animations[`node.${id}.radius`][0].v).toBe(5);
    expect(result.animations.opacity[0].t).toBe(1);
  });

  it('switches between grade versions and keeps the current one', () => {
    let p = project(graded(1));
    p = saveGradeVersion('clip', 'A')(p);
    p = { ...p, tracks: [{ ...p.tracks[0], items: [{ ...item(p), effects: [{ id: 'blur', type: 'blur', enabled: true, params: { radius: 9 } }] }] }, ...p.tracks.slice(1)] };
    p = saveGradeVersion('clip', 'B')(p);
    p = loadGradeVersion('clip', 'A')(p);
    expect(item(p).effects[0].params.radius).toBe(1);
    expect(item(p).gradeVersion).toBe('A');
    p = loadGradeVersion('clip', 'B')(p);
    expect(item(p).effects[0].params.radius).toBe(9);
    p = removeGradeVersion('clip', 'A')(p);
    expect(Object.keys(item(p).gradeVersions!)).toEqual(['B']);
  });

  it('adds and removes stills', () => {
    const still = { id: 's1', name: 'Still 1', time: 0, image: 'data:', grade: captureGrade(graded(1)) };
    const p = addStill(still)(project());
    expect(p.stills).toHaveLength(1);
    expect(removeStill('s1')(p).stills).toHaveLength(0);
  });
});
