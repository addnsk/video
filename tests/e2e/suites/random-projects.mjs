import { Editor, fixture } from '../harness.mjs';
import { compareWithExport, exportProres, maxDifference, sampleProbes } from '../lib/parity.mjs';
import { randomPlan, rng } from '../lib/random-project.mjs';

const COUNT = Number(process.env.RANDOM_PROJECTS ?? 3);
const BASE_SEED = Number(process.env.RANDOM_SEED ?? Date.now() % 100000);
const FILES = () => [fixture('prores-1080-10s.mov'), fixture('red.mov'), fixture('gray.mov'), fixture('moving.mov')];


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
      const base = await sampleProbes(editor, probes);
      const again = await sampleProbes(editor, probes);
      checks.check(maxDifference(base, again) === 0, `${tag}: rendering is deterministic (${maxDifference(base, again)})`);

      const size = await editor.run(async () => (await montage.stats()).previewSize);
      const path = await exportProres(editor, size.height);
      const { worst: exportWorst, notes } = await compareWithExport(editor, path, size, fps, probes);
      for (const note of notes) console.log(tag, 'export mismatch', note);
      const exportLimit = plan.some((step) => step.includes('film-grain')) ? 0.035 : 0.02;
      checks.check(exportWorst < exportLimit, `${tag}: export matches the preview (block luma everywhere, RGB in chroma-flat areas; worst ${exportWorst.toFixed(4)})`);

      const project = await editor.run(() => JSON.stringify(montage.project()));
      const cutInfo = await editor.run(() => {
        const c = montage.clips('v1').find((x) => !x.transition && x.duration > 0.4 && !(montage.clips('v1')[x.index + 1]?.transition));
        return c ? { at: c.start + c.duration / 2, start: c.start, end: c.start + c.duration } : null;
      });
      if (cutInfo) {
        await editor.run((t) => montage.split(t), cutInfo.at);
        const split = await sampleProbes(editor, probes);
        checks.check(maxDifference(base, split) < 1e-4, `${tag}: splitting a clip leaves every frame unchanged (${maxDifference(base, split).toFixed(5)})`);
        await editor.run(() => montage.undo());
      }
      await editor.run(() => {
        const c = montage.clips()[0];
        montage.grade(c.id, { exposure: 0.77 });
      });
      await editor.run(() => montage.undo());
      const undone = await sampleProbes(editor, probes);
      checks.check(maxDifference(base, undone) < 1e-4 && (await editor.run(() => JSON.stringify(montage.project()))) === project, `${tag}: edit plus undo restores model and pixels`);

      await editor.until(() => /saved/i.test(document.querySelector('.save-status')?.textContent ?? ''), null, 10000).catch(() => undefined);
      await editor.settle(1500);
      await editor.page.reload();
      await editor.ready();
      await editor.until(() => montage.clips().length > 0);
      if (await editor.page.isVisible('.offline')) await editor.pick('#media-locate', FILES());
      await editor.until(() => !document.querySelector('.offline') || document.querySelector('.offline').hidden);
      await editor.run(() => montage.renderCache(false));
      const reloaded = await sampleProbes(editor, probes);
      checks.check(maxDifference(base, reloaded) < 1e-4, `${tag}: a reload renders the same pixels (${maxDifference(base, reloaded).toFixed(5)})`);

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
