import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { captureGrade, loadGradeVersion, saveGradeVersion } from '../../../src/core/grades';
import { captureTemplate, placeTemplate } from '../../../src/core/graph-templates';
import { materialize } from '../../../src/core/graph';
import { enableGraph } from '../../../src/core/graph-operations';
import type { Item, Project } from '../../../src/core/model';
import { itemLength, sourceTimeAt } from '../../../src/core/model';
import { copyEffects, setSpeed, splitAt, trimItem, upsertEffect } from '../../../src/core/operations';
import { resolveItem } from '../../../src/core/resolve';
import { compositionAt, findPlacement, placeTrack, projectDuration } from '../../../src/core/timeline';
import { action, items, registry, run } from './world';

const RUNS = Number(process.env.FUZZ_RUNS ?? 200);
export const exercised: Record<string, number> = {};
const hit = (name: string) => (exercised[name] = (exercised[name] ?? 0) + 1);
const project = fc.array(action, { minLength: 10, maxLength: 120 }).map((actions) => run(actions).store.project);
const unit = fc.double({ min: 0.05, max: 0.95, noNaN: true });

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

function resolvedEqual(a: Item, ta: number, b: Item, tb: number): string | null {
  const ra = resolveItem(a, ta);
  const rb = resolveItem(b, tb);
  const pairs: [string, number, number][] = [
    ['opacity', ra.opacity, rb.opacity],
    ['volume', ra.volume, rb.volume],
    ['x', ra.transform.x, rb.transform.x],
    ['y', ra.transform.y, rb.transform.y],
    ['scale', ra.transform.scale, rb.transform.scale],
    ['rotation', ra.transform.rotation, rb.transform.rotation],
  ];
  const byType = (r: typeof ra) => r.effects.map((e) => JSON.stringify([e.type, e.enabled, e.params]));
  const [ea, eb] = [byType(ra), byType(rb)];
  for (const [name, x, y] of pairs) if (!close(x, y, 1e-4)) return `${name} ${x} vs ${y}`;
  if (ea.length !== eb.length) return 'effect count differs';
  for (let i = 0; i < ea.length; i++) {
    const [pa, pb] = [JSON.parse(ea[i]), JSON.parse(eb[i])];
    if (pa[0] !== pb[0] || pa[1] !== pb[1]) return `effect ${i} differs`;
    for (const k of Object.keys(pa[2])) {
      const [x, y] = [pa[2][k], pb[2][k]];
      if (typeof x === 'number' && !close(x, y, 1e-4)) return `param ${pa[0]}.${k} ${x} vs ${y}`;
    }
  }
  return null;
}

const hasEasing = (item: Item) => Object.keys(item.presets).length > 0 || Object.values(item.animations).some((keys) => keys.some((k) => k.ease && k.ease !== 'linear'));

function shape(item: Pick<Item, 'effects' | 'graph'>): string {
  const graph = materialize(item.effects, item.graph, registry);
  const order = new Map(graph.nodes.map((n, i) => [n.id, `${n.type}#${graph.nodes.filter((m, j) => j < i && m.type === n.type).length}`]));
  return JSON.stringify({
    nodes: graph.nodes.map((n) => [order.get(n.id), n.enabled, n.params]).sort(),
    links: graph.links.map((l) => [order.get(l.from), order.get(l.to), l.input]).sort(),
  });
}

describe('metamorphic properties of edits', () => {
  afterAll(() => {
    for (const name of ['split', 'trim', 'speed', 'version', 'copy', 'template']) expect(exercised[name] ?? 0, `${name} was exercised`).toBeGreaterThan(RUNS / 25);
  });

  it('splitting a clip changes nothing that is visible on either side of the cut', () => {
    fc.assert(
      fc.property(project, fc.nat(), unit, unit, (p, which, cut, probe) => {
        const candidates = p.tracks.flatMap((t) => placeTrack(t).filter((pl) => !pl.fadeIn && !pl.fadeOut).map((pl) => ({ pl, t })));
        if (!candidates.length) return;
        const { pl, t } = candidates[which % candidates.length];
        if (hasEasing(pl.item)) return;
        const length = itemLength(pl.item);
        const local = cut * length;
        const next = splitAt(pl.start + local, t.id, 'right_part')(p);
        const left = findPlacement(next, pl.item.id)?.item;
        const right = findPlacement(next, 'right_part')?.item;
        if (!left || !right || left === pl.item) return;
        const at = probe * length;
        const [part, partLocal] = at < local ? [left, at] : [right, at - local];
        hit('split');
        const problem = resolvedEqual(pl.item, at, part, partLocal);
        expect(problem, `split at ${local.toFixed(4)}, probe ${at.toFixed(4)}, len ${length}, ${JSON.stringify(pl.item.animations)} -> ${JSON.stringify(part.animations)} effects ${JSON.stringify(pl.item.effects.map((e) => e.type))} -> ${JSON.stringify(part.effects.map((e) => e.type))}`).toBeNull();
        if (pl.item.kind === 'media' && part.kind === 'media') expect(close(sourceTimeAt(pl.item, at), sourceTimeAt(part, partLocal))).toBe(true);
        expect(close(projectDuration(next), projectDuration(p))).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it('trimming the head keeps the remaining frames and animation in place', () => {
    fc.assert(
      fc.property(project, fc.nat(), unit, unit, (p, which, amount, probe) => {
        const media = items(p).filter((i): i is Extract<Item, { kind: 'media' }> => i.kind === 'media' && !hasEasing(i));
        if (!media.length) return;
        const item = media[which % media.length];
        const shiftSource = amount * (item.source.out - item.source.in) * 0.8;
        const next = findPlacement(trimItem(item.id, { in: item.source.in + shiftSource })(p), item.id)!.item;
        if (next.kind !== 'media') return;
        hit('trim');
        const shift = (next.source.in - item.source.in) / item.speed;
        const at = probe * itemLength(next);
        expect(resolvedEqual(item, at + shift, next, at)).toBeNull();
        expect(close(sourceTimeAt(item, at + shift), sourceTimeAt(next, at))).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it('changing speed keeps the animation pinned to the same source frames', () => {
    fc.assert(
      fc.property(project, fc.nat(), fc.constantFrom(0.25, 0.5, 2, 3.7), unit, (p, which, speed, probe) => {
        const media = items(p).filter((i): i is Extract<Item, { kind: 'media' }> => i.kind === 'media' && !hasEasing(i));
        if (!media.length) return;
        const item = media[which % media.length];
        const next = findPlacement(setSpeed(item.id, speed)(p), item.id)!.item;
        if (next.kind !== 'media') return;
        const at = probe * itemLength(next);
        hit('speed');
        const original = (sourceTimeAt(next, at) - item.source.in) / item.speed;
        expect(resolvedEqual(item, original, next, at)).toBeNull();
      }),
      { numRuns: RUNS },
    );
  });

  it('a saved grade version comes back exactly after other edits', () => {
    fc.assert(
      fc.property(project, fc.nat(), unit, (p, which, exposure) => {
        const all = items(p);
        if (!all.length) return;
        const item = all[which % all.length];
        hit('version');
        let q = saveGradeVersion(item.id, 'X')(p);
        const saved = shape(captureGrade(findPlacement(q, item.id)!.item));
        q = upsertEffect(item.id, 'grade', { exposure })(q);
        q = saveGradeVersion(item.id, 'Y')(q);
        q = loadGradeVersion(item.id, 'X')(q);
        expect(shape(findPlacement(q, item.id)!.item)).toBe(saved);
      }),
      { numRuns: RUNS },
    );
  });

  it('copying a grade or a full template reproduces the same node graph', () => {
    fc.assert(
      fc.property(project, fc.nat(), fc.nat(), (p, a, b) => {
        const all = items(p);
        if (all.length < 2) return;
        const from = all[a % all.length];
        const to = all[b % all.length];
        if (from.id === to.id) return;
        hit('copy');
        const copied = findPlacement(copyEffects(from.id, [to.id])(p), to.id)!.item;
        expect(shape(copied)).toBe(shape(from));
        if (!from.effects.length) return;
        const template = captureTemplate(from, from.effects.map((e) => e.id), 'T');
        expect(template.nodes.length).toBe(from.effects.length);
        const target = enableGraph(to.id, registry)(p);
        const blank = findPlacement(target, to.id)!.item;
        const placed = placeTemplate(to.id, template, [0, 0]);
        const result = findPlacement(placed.operation(target), to.id)!.item;
        hit('template');
        expect(result.effects.length).toBe(blank.effects.length + from.effects.length);
        const added = result.effects.filter((e) => !blank.effects.some((x) => x.id === e.id));
        expect(added.map((e) => e.type).sort()).toEqual(from.effects.map((e) => e.type).sort());
        const inner = (result.graph?.links ?? []).filter((l) => added.some((e) => e.id === l.from) && added.some((e) => e.id === l.to));
        expect(inner.length).toBe(template.links.length);
      }),
      { numRuns: RUNS },
    );
  });

  it('every visible frame comes from an item that covers that time', () => {
    fc.assert(
      fc.property(project, unit, (p, f) => {
        const time = projectDuration(p) * f;
        for (const layer of compositionAt(p, time).layers) {
          const pl = layer.base.placement;
          expect(time >= pl.start - 1e-9 && time < pl.end + 1e-9).toBe(true);
          if (pl.item.kind === 'media') {
            const source = sourceTimeAt(pl.item, layer.base.local);
            expect(source >= pl.item.source.in - 1e-6 && source <= pl.item.source.out + 1e-6).toBe(true);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });
});
