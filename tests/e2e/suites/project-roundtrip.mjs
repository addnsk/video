import { Editor, fixture } from '../harness.mjs';

const CANONICAL = `const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v; return JSON.stringify(canon(montage.project()));`;
const snapshot = (editor) => editor.run(new Function(CANONICAL));
const sample = (editor) =>
  editor.run(async (p) => {
    for (let i = 0; i < 20; i++) {
      try {
        return await montage.sample(p, 1.2);
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    return montage.sample(p, 1.2);
  }, POINTS);

const POINTS = [{ x: -0.3, y: -0.2 }, { x: 0, y: 0 }, { x: 0.2, y: 0.25 }, { x: 0.4, y: -0.3 }];
const near = (a, b, t = 0.01) => a.every((p, i) => p.every((v, c) => Math.abs(v - b[i][c]) <= t));

async function build(editor) {
  return editor.run(async () => {
    montage.colorSpace(0, 'slog3');
    montage.effect(0, 'hdr-wheels', { highlight: [0.05, 0, -0.2] });
    const mask = montage.graph.add(0, 'bezier-mask', { feather: 0.02 });
    const poly = montage.graph.add(0, 'polygon-mask', { points: [-0.2, -0.2, 0.2, -0.2, 0, 0.2] });
    const text = montage.graph.add(0, 'text', { text: 'Round trip', size: 0.08, outlineWidth: 0.05 });
    const combine = montage.graph.add(0, 'mask-combine', { mode: 'union' });
    const merge = montage.graph.add(0, 'merge', { mode: 'screen' });
    const grade = montage.graph.add(0, 'grade', { exposure: 0.3 });
    montage.graph.connect(0, mask, combine, 'a');
    montage.graph.connect(0, poly, combine, 'b');
    montage.graph.connect(0, 'source', grade);
    montage.graph.connect(0, grade, merge, 'background');
    montage.graph.connect(0, text, merge, 'foreground');
    montage.graph.connect(0, combine, merge, 'mask');
    montage.graph.connect(0, merge, 'output');
    montage.graph.keyframe(0, text, 'progress', 0, 0);
    montage.graph.keyframe(0, text, 'progress', 1, 1);
    montage.graph.keyframe(0, mask, 'points.0', 0, -0.3);
    montage.graph.keyframe(0, mask, 'points.0', 1.5, -0.1);
    montage.graph.move(0, text, [420, 260]);
    montage.versions.save(0, 'First');
    montage.graph.set(0, grade, { exposure: -0.2 });
    montage.versions.save(0, 'Second');
    montage.colorScience('aces');
    await montage.stills.grab({ name: 'Look', clip: 0 });
  });
}

export default {
  name: 'project-roundtrip',
  tags: ['edit'],
  async run({ browser, url, checks }) {
    const files = [fixture('gray.mov'), fixture('red.mov')];
    const editor = await Editor.open(browser, url);
    await editor.import(files);
    await editor.run(() => montage.renderCache(false));
    await build(editor);
    const project = await snapshot(editor);
    const pixels = await sample(editor);
    await editor.until(() => /saved/i.test(document.querySelector('.save-status')?.textContent ?? ''), null, 10000).catch(() => undefined);
    await editor.settle(1500);

    await editor.page.reload();
    await editor.ready();
    await editor.until(() => montage.clips().length > 0);
    if (await editor.page.isVisible('.offline')) await editor.pick('#media-locate', files);
    await editor.until(() => !document.querySelector('.offline') || document.querySelector('.offline').hidden);
    const restored = await snapshot(editor);
    checks.check(restored === project, `the whole project model survives a reload (${project.length} bytes${restored === project ? '' : `, first difference at ${[...project].findIndex((c, i) => c !== restored[i])}`})`);
    await editor.run(() => montage.renderCache(false));
    const after = await sample(editor);
    checks.check(near(pixels, after), `the reloaded project renders the same pixels (${JSON.stringify(pixels.map((p) => p.map((v) => +v.toFixed(3))))} vs ${JSON.stringify(after.map((p) => p.map((v) => +v.toFixed(3))))})`);

    const download = editor.page.waitForEvent('download');
    await editor.page.click('#project-save');
    const file = await (await download).path();
    await editor.page.click('#project-new');
    await editor.page.click('.modal .btn.primary');
    await editor.until(() => montage.clips().length === 0);
    await editor.pick('#project-open', [file]);
    await editor.until(() => montage.clips().length > 0);
    const reopened = await snapshot(editor);
    checks.check(reopened === project, 'the project file reopens with graph, keyframes, versions, stills and color settings');
    const versions = await editor.run(() => montage.versions.list(0));
    checks.check(versions.names.join() === 'First,Second', `grade versions are kept (${versions.names})`);
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
