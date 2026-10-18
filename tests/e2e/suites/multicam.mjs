import { Editor, fixture } from '../harness.mjs';

const isBlue = ([r, , b]) => b > 180 && r < 80;
const isRed = ([r, , b]) => r > 180 && b < 80;

export default {
  name: 'multicam',
  tags: ['edit', 'audio'],
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    const { page } = editor;
    const answers = [];
    page.on('dialog', (d) => d.accept(answers.shift() ?? ''));
    await editor.import([fixture('cam1.mov'), fixture('cam2.mov')]);
    await editor.run(() => montage.clear());
    const ids = await editor.run(() => Object.fromEntries(montage.assets().map((a) => [a.name, a.id])));
    const synced = await editor.run((ids) => montage.multicam.sync([ids['cam1.mov'], ids['cam2.mov']]), ids);
    checks.near(synced[1].offset, 1.3, 0.02, `audio sync finds the second camera's start (${synced[1].offset.toFixed(3)} s, confidence ${synced[1].confidence.toFixed(2)})`);

    answers.push('Scene');
    await page.click('#multicam-new');
    await editor.until(() => montage.source.state().viewer === 'source');
    const created = await editor.run(() => montage.timelines.list().find((t) => t.name === 'Scene'));
    checks.check(!!created, 'the media panel builds a multicam clip from the listed clips');
    await editor.run(() => montage.source.seek(2));
    await editor.frame();
    const left = await editor.previewColor({ x: 0.25, y: 0.25, size: 0.05 }, 'source');
    const right = await editor.previewColor({ x: 0.75, y: 0.25, size: 0.05 }, 'source');
    checks.check(isRed(left) && isBlue(right), `the multiview shows every angle side by side (${left.map(Math.round)} | ${right.map(Math.round)})`);

    await page.click('#viewer-timeline');
    await page.click(`[data-insert-timeline="${created.id}"]`);
    const clip = await editor.run(() => montage.clips()[0]);
    checks.near(clip.duration, 6, 0.05, `the multicam clip spans every angle (${clip.duration})`);
    await editor.run(() => montage.seek(3));
    await page.keyboard.press('Digit2');
    const cuts = await editor.run(() => montage.clips().map((c) => [c.start, montage.multicam.angles(c.id).video]));
    checks.check(JSON.stringify(cuts) === '[[0,0],[3,1]]', `pressing 2 cuts to angle 2 at the playhead (${JSON.stringify(cuts)})`);
    await editor.run(() => montage.seek(1.5));
    await editor.frame();
    checks.check(isRed(await editor.previewColor()), 'before the cut the first angle plays');
    await editor.run(() => montage.seek(4));
    await editor.frame();
    checks.check(isBlue(await editor.previewColor()), 'after the cut the second angle plays');
    const sampled = await editor.run(() => montage.sample({ x: 0.5, y: 0.5 }, 4));
    checks.check(sampled[2] > 0.6, 'the engine renders the chosen angle');

    const loud = await editor.run(async () => (await montage.loudness()).integrated);
    checks.check(Number.isFinite(loud), `the multicam clip carries the angle sound (${loud})`);
    await editor.run(() => montage.multicam.angle(1, { audio: 0 }));
    checks.check((await editor.run(() => montage.multicam.angles(1).audio)) === 0, 'audio can stay on another angle');
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
