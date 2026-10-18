import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Editor, fixture } from '../harness.mjs';
import { decodeFrame } from '../lib/prores-frame.mjs';
import { randomPlan, rng } from '../lib/random-project.mjs';

const COUNT = Number(process.env.RANDOM_PROJECTS ?? 3);
const BASE_SEED = Number(process.env.RANDOM_SEED ?? Date.now() % 100000);
const FILES = () => [fixture('prores-1080-10s.mov'), fixture('red.mov'), fixture('gray.mov'), fixture('moving.mov')];

const pointDiff = (a, b) => Math.max(...a.map((p, i) => Math.max(...p.slice(0, 3).map((v, c) => Math.abs(Math.min(1, Math.max(0, v)) - Math.min(1, Math.max(0, b[i][c])))))));

const maxDiff = (a, b) => Math.max(...a.map((probe, k) => pointDiff(probe, b[k])));

async function samples(editor, probes) {
  const out = [];
  for (const { time, points } of probes)
    out.push(
      await editor.run(async ({ time, points }) => {
        for (let i = 0; i < 30; i++) {
          try {
            return await montage.sample(points, time);
          } catch {
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        return montage.sample(points, time);
      }, { time, points }),
    );
  return out;
}

export default {
  name: 'random-projects',
  async run({ browser, url, checks }) {
    for (let n = 0; n < COUNT; n++) {
      const seed = BASE_SEED + n;
      const tag = `seed ${seed}`;
      const editor = await Editor.open(browser, url, { viewport: { width: 1000, height: 700 } });
      await editor.import(FILES());
      const plan = randomPlan(seed, 4);
      if (process.env.SHOW_PLAN) console.log(plan.join('\n'));
      for (const step of plan) await editor.run(new Function(`return (async () => { ${step} })()`));
      await editor.run(() => montage.renderCache(false));
      const duration = await editor.run(() => montage.duration);
      const fps = await editor.run(() => montage.project().settings.fps);
      const r = rng(seed * 7 + 1);
      const probes = Array.from({ length: 4 }, () => ({
        time: Math.floor(r() * (duration - 0.1) * fps) / fps,
        points: Array.from({ length: 6 }, () => ({ x: +(r() * 0.9 - 0.45).toFixed(3), y: +(r() * 0.9 - 0.45).toFixed(3) })),
      }));
      const base = await samples(editor, probes);
      const again = await samples(editor, probes);
      checks.check(maxDiff(base, again) === 0, `${tag}: rendering is deterministic (${maxDiff(base, again)})`);

      const size = await editor.run(async () => (await montage.stats()).previewSize);
      const b64 = await editor.run(async (height) => {
        const res = await montage.render({ prores: 'hq', height });
        const bytes = new Uint8Array(await res.file.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(binary);
      }, size.height);
      const path = join(mkdtempSync(join(tmpdir(), 'montage-random-')), 'r.mov');
      writeFileSync(path, Buffer.from(b64, 'base64'));
      let exportWorst = 0;
      const BLOCK = 2;
      for (const [k, { time, points }] of probes.entries()) {
        const frame = Math.round(time * fps);
        const w = size.width;
        const pixel = decodeFrame(path, frame, w, size.height);
        const centers = points.map(({ x, y }) => [Math.min(w - 1 - BLOCK, Math.max(BLOCK, Math.floor((x + 0.5) * w))), Math.min(size.height - 1 - BLOCK, Math.max(BLOCK, Math.floor((y + 0.5) * size.height)))]);
        const RING = BLOCK + 1;
        const grid = centers.flatMap(([px, py]) => {
          const cells = [];
          for (let dy = -RING; dy <= RING; dy++) for (let dx = -RING; dx <= RING; dx++) cells.push({ x: (px + dx + 0.5) / w - 0.5, y: (py + dy + 0.5) / size.height - 0.5 });
          return cells;
        });
        const preview = await editor.run(({ grid, time }) => montage.sample(grid, time), { grid, time });
        const cell = (2 * BLOCK + 1) ** 2;
        const ring = (2 * RING + 1) ** 2;
        const inner = (j) => Math.abs((j % (2 * RING + 1)) - RING) <= BLOCK && Math.abs(Math.floor(j / (2 * RING + 1)) - RING) <= BLOCK;
        centers.forEach(([px, py], i) => {
          const mean = [0, 0, 0];
          const pmean = [0, 0, 0];
          for (let dy = -BLOCK; dy <= BLOCK; dy++)
            for (let dx = -BLOCK; dx <= BLOCK; dx++)
              for (let c = 0; c < 3; c++) mean[c] += pixel(px + dx, py + dy)[c] / cell;
          for (let j = 0; j < ring; j++) if (inner(j)) for (let c = 0; c < 3; c++) pmean[c] += Math.min(1, Math.max(0, preview[i * ring + j][c])) / cell;
          const luma = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
          const cells = Array.from({ length: ring }, (_, j) => preview[i * ring + j].slice(0, 3).map((v) => Math.min(1, Math.max(0, v))));
          const flat = [0, 1, 2].every((c) => Math.max(...cells.map((v) => v[c])) - Math.min(...cells.map((v) => v[c])) <= 0.02);
          const d = Math.max(Math.abs(luma(mean) - luma(pmean)), flat ? Math.max(...mean.map((v, c) => Math.abs(v - pmean[c]))) * (2 / 3) : 0);
          if (d > 0.02) console.log(tag, 'export mismatch at', time, JSON.stringify([points[i], pmean.map((v) => +v.toFixed(3)), mean.map((v) => +v.toFixed(3))]));
          exportWorst = Math.max(exportWorst, d);
        });
      }
      checks.check(exportWorst < 0.02, `${tag}: export matches the preview (block luma everywhere, RGB in chroma-flat blocks; worst ${exportWorst.toFixed(4)})`);

      const project = await editor.run(() => JSON.stringify(montage.project()));
      const cutInfo = await editor.run(() => {
        const c = montage.clips('v1').find((x) => !x.transition && x.duration > 0.4 && !(montage.clips('v1')[x.index + 1]?.transition));
        return c ? { at: c.start + c.duration / 2, start: c.start, end: c.start + c.duration } : null;
      });
      if (cutInfo) {
        await editor.run((t) => montage.split(t), cutInfo.at);
        const split = await samples(editor, probes);
        checks.check(maxDiff(base, split) < 1e-4, `${tag}: splitting a clip leaves every frame unchanged (${maxDiff(base, split).toFixed(5)})`);
        await editor.run(() => montage.undo());
      }
      await editor.run(() => {
        const c = montage.clips()[0];
        montage.grade(c.id, { exposure: 0.77 });
      });
      await editor.run(() => montage.undo());
      const undone = await samples(editor, probes);
      checks.check(maxDiff(base, undone) < 1e-4 && (await editor.run(() => JSON.stringify(montage.project()))) === project, `${tag}: edit plus undo restores model and pixels`);

      await editor.until(() => /saved/i.test(document.querySelector('.save-status')?.textContent ?? ''), null, 10000).catch(() => undefined);
      await editor.settle(1500);
      await editor.page.reload();
      await editor.ready();
      await editor.until(() => montage.clips().length > 0);
      if (await editor.page.isVisible('.offline')) await editor.pick('#media-locate', FILES());
      await editor.until(() => !document.querySelector('.offline') || document.querySelector('.offline').hidden);
      await editor.run(() => montage.renderCache(false));
      const reloaded = await samples(editor, probes);
      checks.check(maxDiff(base, reloaded) < 1e-4, `${tag}: a reload renders the same pixels (${maxDiff(base, reloaded).toFixed(5)})`);

      await editor.run(() => montage.renderCache(true));
      const shots = [];
      for (const { time } of probes.slice(0, 2)) {
        await editor.seekAndSettle(time, 600);
        const first = await editor.previewColor({ x: 0.5, y: 0.5, size: 0.3 });
        await editor.seekAndSettle(0.01, 300);
        await editor.seekAndSettle(time, 600);
        const second = await editor.previewColor({ x: 0.5, y: 0.5, size: 0.3 });
        shots.push(Math.max(...first.map((v, i) => Math.abs(v - second[i]))));
      }
      checks.check(Math.max(...shots) <= 2, `${tag}: frames served from the render cache match fresh renders (${shots.map((v) => v.toFixed(2))})`);
      checks.check(editor.errors.length === 0, `${tag}: no page errors ${editor.errors.join('; ')}`);
      await editor.close();
    }
  },
};
