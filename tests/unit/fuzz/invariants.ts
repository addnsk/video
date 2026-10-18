import { PROPERTY, valueAt } from '../../../src/core/animation';
import { materialize, validateGraph } from '../../../src/core/graph';
import { migrateProject } from '../../../src/core/migrate';
import type { Item, Project } from '../../../src/core/model';
import { MAX_SPEED, MIN_SPEED, accepts, itemLength } from '../../../src/core/model';
import { resolveItem } from '../../../src/core/resolve';
import { compositionAt, placeTrack, projectDuration } from '../../../src/core/timeline';
import { graphContext, registry } from './world';

const KNOWN_PATHS = new Set(Object.values(PROPERTY));
const EPS = 1e-6;

const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;

export const sameProject = (a: Project, b: Project) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

function checkGraph(owner: string, effects: Item['effects'], graph: Item['graph'], problems: string[]) {
  const ids = new Set<string>();
  for (const e of effects) {
    if (ids.has(e.id)) problems.push(`${owner}: duplicate effect id ${e.id}`);
    ids.add(e.id);
    if (!registry.get(e.type) && !e.type.startsWith('audio')) problems.push(`${owner}: unknown effect ${e.type}`);
  }
  if (!graph) return;
  for (const l of graph.links) {
    for (const end of [l.from, l.to]) if (end !== 'source' && end !== 'output' && !ids.has(end)) problems.push(`${owner}: link to missing node ${end}`);
  }
  for (const id of Object.keys(graph.positions)) if (!ids.has(id) && id !== 'source' && id !== 'output') problems.push(`${owner}: position of missing node ${id}`);
  const nodes = materialize(effects, graph, graphContext);
  for (const p of validateGraph(nodes, (t) => {
    const inputs = registry.inputsOf(t);
    return inputs ? { inputs } : undefined;
  }))
    problems.push(`${owner}: ${p}`);
}

function checkAnimations(owner: string, item: Item, problems: string[]) {
  const effectIds = new Set(item.effects.map((e) => e.id));
  for (const [path, keys] of Object.entries(item.animations)) {
    const [kind, id] = path.split('.');
    if (kind === 'node' && !effectIds.has(id)) problems.push(`${owner}: keyframes of missing node ${path}`);
    if (kind !== 'node' && kind !== 'fx' && !KNOWN_PATHS.has(path as never)) problems.push(`${owner}: unknown animated path ${path}`);
    if (!keys.length) problems.push(`${owner}: empty keyframe list ${path}`);
    for (let i = 0; i < keys.length; i++) {
      if (!Number.isFinite(keys[i].t) || !Number.isFinite(keys[i].v)) problems.push(`${owner}: non-finite key in ${path}`);
      if (i && keys[i].t <= keys[i - 1].t) problems.push(`${owner}: unsorted or duplicate key times in ${path}`);
    }
  }
}

export function problemsOf(project: Project): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const track of project.tracks) {
    const placements = placeTrack(track);
    for (const item of track.items) {
      const owner = `${track.id}/${item.id}`;
      if (ids.has(item.id)) problems.push(`duplicate item id ${item.id}`);
      ids.add(item.id);
      if (!accepts(track, item, project.assets)) problems.push(`${owner}: ${item.kind} not accepted on ${track.kind} track`);
      const length = itemLength(item);
      if (!(length > 0) || !Number.isFinite(length)) problems.push(`${owner}: bad length ${length}`);
      if (!(item.start >= 0) || !Number.isFinite(item.start)) problems.push(`${owner}: bad start ${item.start}`);
      if (item.kind === 'media') {
        const asset = project.assets[item.source.assetId];
        if (!asset) problems.push(`${owner}: missing asset`);
        else if (item.source.in < asset.start - EPS || item.source.out > asset.end + EPS || item.source.in >= item.source.out) problems.push(`${owner}: source range ${item.source.in}..${item.source.out} outside ${asset.start}..${asset.end}`);
        if (item.speed < MIN_SPEED - EPS || item.speed > MAX_SPEED + EPS) problems.push(`${owner}: speed ${item.speed}`);
      }
      if (item.opacity < 0 || item.opacity > 1) problems.push(`${owner}: opacity ${item.opacity}`);
      checkGraph(owner, item.effects, item.graph, problems);
      checkAnimations(owner, item, problems);
      for (const [name, version] of Object.entries(item.gradeVersions ?? {})) checkGraph(`${owner} version ${name}`, version.effects, version.graph, problems);
      if (item.gradeVersion && !item.gradeVersions?.[item.gradeVersion]) problems.push(`${owner}: active version ${item.gradeVersion} is missing`);
      for (const t of [0, length / 3, length - EPS]) {
        const r = resolveItem(item, t);
        if (![r.opacity, r.volume, r.transform.x, r.transform.y, r.transform.scale, r.transform.rotation].every(Number.isFinite)) problems.push(`${owner}: non-finite resolved values at ${t}`);
      }
    }
    for (const p of placements) if (p.index === 0 && p.fadeIn > 0) problems.push(`${track.id}: first item fades in`);
  }
  for (const still of project.stills ?? []) checkGraph(`still ${still.id}`, still.grade.effects, still.grade.graph, problems);
  const duration = projectDuration(project);
  if (!Number.isFinite(duration) || duration < 0) problems.push(`bad project duration ${duration}`);
  for (const f of [0, 0.37, 0.71, 0.999]) {
    const frame = compositionAt(project, duration * f);
    for (const layer of frame.layers) {
      const len = itemLength(layer.base.placement.item);
      if (layer.base.local < -EPS || layer.base.local > len + EPS) problems.push(`layer local time ${layer.base.local} outside 0..${len}`);
      if (layer.transition && (layer.transition.progress < -EPS || layer.transition.progress > 1 + EPS)) problems.push(`transition progress ${layer.transition.progress}`);
    }
  }
  if (!sameProject(migrateProject(JSON.parse(JSON.stringify(project))), project)) problems.push('project does not survive save and load');
  return problems;
}

export { valueAt };
