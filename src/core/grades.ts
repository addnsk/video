import { remapGraph, remapNodeAnimations } from './graph';
import { createId } from './ids';
import type { GradeSnapshot, Item, Still } from './model';
import { updateItem, type Operation } from './operations';

const GRADE_PATH = /^(node|fx)\./;

export function captureGrade(item: Item): GradeSnapshot {
  const animations = Object.fromEntries(Object.entries(item.animations).filter(([path]) => GRADE_PATH.test(path)));
  return item.graph ? { effects: item.effects, graph: item.graph, animations } : { effects: item.effects, animations };
}

export function withGrade(item: Item, grade: GradeSnapshot): Item {
  const ids = new Map(grade.effects.map((e) => [e.id, createId('fx')]));
  const effects = grade.effects.map((e) => ({ ...e, id: ids.get(e.id)! }));
  const kept = Object.fromEntries(Object.entries(item.animations).filter(([path]) => !GRADE_PATH.test(path)));
  const { graph: _graph, ...rest } = item;
  const animations = { ...kept, ...remapNodeAnimations(grade.animations, ids) };
  return grade.graph ? { ...rest, effects, graph: remapGraph(grade.graph, ids), animations } : { ...rest, effects, animations };
}

export const applyGrade = (itemId: string, grade: GradeSnapshot): Operation => updateItem(itemId, (item) => withGrade(item, grade));

export const DEFAULT_VERSION = 'Version 1';

export const saveGradeVersion = (itemId: string, name: string): Operation =>
  updateItem(itemId, (item) => ({ ...item, gradeVersions: { ...item.gradeVersions, [name]: captureGrade(item) }, gradeVersion: name }));

export const loadGradeVersion = (itemId: string, name: string): Operation =>
  updateItem(itemId, (item) => {
    const target = item.gradeVersions?.[name];
    if (!target || item.gradeVersion === name) return item;
    const current = item.gradeVersion ?? DEFAULT_VERSION;
    const versions = { ...item.gradeVersions, [current]: captureGrade(item) };
    return { ...withGrade(item, target), gradeVersions: versions, gradeVersion: name };
  });

export const removeGradeVersion = (itemId: string, name: string): Operation =>
  updateItem(itemId, (item) => {
    if (!item.gradeVersions?.[name]) return item;
    const { [name]: _removed, ...versions } = item.gradeVersions;
    return { ...item, gradeVersions: versions, gradeVersion: item.gradeVersion === name ? undefined : item.gradeVersion };
  });

export const addStill = (still: Still): Operation => (project) => ({ ...project, stills: [...(project.stills ?? []), still] });

export const removeStill = (id: string): Operation => (project) =>
  project.stills?.some((s) => s.id === id) ? { ...project, stills: project.stills.filter((s) => s.id !== id) } : project;
