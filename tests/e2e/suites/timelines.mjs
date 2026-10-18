import { Editor, fixture } from '../harness.mjs';

const isBlue = ([r, , b]) => b > 180 && r < 80;
const isRed = ([r, , b]) => r > 180 && b < 80;

export default {
  name: 'timelines',
  tags: ['edit'],
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    const { page } = editor;
    const answers = [];
    page.on('dialog', (d) => d.accept(answers.shift() ?? ''));
    await editor.import([fixture('red.mov'), fixture('blue.mov'), fixture('testsrc.mov')]);
    const ids = await editor.run(() => Object.fromEntries(montage.assets().map((a) => [a.name, a.id])));
    await editor.run(() => {
      for (const c of montage.clips().filter((x) => x.name !== 'red.mov')) montage.remove(c.id);
    });
    const main = await editor.run(() => montage.timelines.active().id);

    await page.click('#timeline-menu');
    await page.click('#timeline-new');
    const created = await editor.run(() => montage.timelines.active());
    checks.check(created.id !== main && (await page.locator('#timeline-select option').count()) === 2, `the menu creates and opens a new timeline (${created.name})`);
    checks.check((await editor.run(() => montage.duration)) === 0, 'the new timeline starts empty');
    await editor.run((ids) => {
      montage.edit.append({ asset: ids['blue.mov'] });
      montage.edit.append({ asset: ids['testsrc.mov'], in: 0, out: 2, video: null });
    }, ids);
    checks.check((await editor.run(() => montage.clips('a1').length)) === 1, 'the new timeline has its own audio');

    await page.selectOption('#timeline-select', main);
    await editor.until((main) => montage.timelines.active().id === main, main);
    checks.check(JSON.stringify(await editor.run(() => montage.clips().map((c) => c.name))) === '["red.mov"]', 'switching back shows the first timeline unchanged');

    await editor.run(() => montage.seek(2));
    await page.click(`[data-insert-timeline="${created.id}"]`);
    const nested = await editor.run(() => montage.clips().map((c) => [c.name, c.start, c.duration]));
    checks.check(JSON.stringify(nested) === JSON.stringify([['red.mov', 0, 2], [created.name, 2, 2]]), `the media panel inserts the timeline as a nested clip (${JSON.stringify(nested)})`);
    await editor.run(() => montage.seek(2.5));
    await editor.frame();
    checks.check(isBlue(await editor.previewColor()), 'the viewer shows the nested timeline');
    const sampled = await editor.run(() => montage.sample({ x: 0.5, y: 0.5 }, 2.5));
    checks.check(sampled[2] > 0.6 && sampled[0] < 0.2, `the engine composites the nested timeline (${sampled.map((v) => v.toFixed(2))})`);
    const loud = await editor.run(async () => (await montage.loudness()).integrated);
    checks.check(Number.isFinite(loud) && loud > -40, `sound from inside the nested timeline reaches the mix (${loud})`);
    await editor.run(() => montage.set(1, { opacity: 0.5 }));
    await editor.frame();
    const half = await editor.previewColor();
    checks.check(half[2] > 60 && half[2] < 200, `effects on the nested clip apply to its whole picture (${half.map((v) => v.toFixed(0))})`);

    await editor.run(() => montage.select(0));
    answers.push('Opening');
    await page.click('#timeline-menu');
    await page.click('#compound-clip');
    const compound = await editor.run(() => montage.clips().map((c) => c.name));
    checks.check(compound[0] === 'Opening', `the compound clip button nests the selected clip (${compound})`);
    await editor.run(() => montage.seek(1));
    await editor.frame();
    checks.check(isRed(await editor.previewColor()), 'the compound clip still shows its content');
    checks.check((await editor.run(() => montage.timelines.list().length)) === 3, 'the compound clip is a timeline of its own');

    const saved = await editor.run(() => montage.project());
    checks.check(Object.keys(saved.timelines ?? {}).length === 2 && saved.timeline.id === main, 'the project file stores every timeline');
    await page.keyboard.press('Control+z');
    checks.check((await editor.run(() => montage.clips()[0].name)) === 'red.mov', 'undo takes the compound clip apart');
    const vertical = await editor.run(() => montage.timelines.create('Vertical', { width: 360, height: 640, fps: 25 }));
    checks.check(JSON.stringify(await editor.run(() => montage.size)) === '{"width":360,"height":640}', 'a new timeline can have its own frame size');
    await editor.run((main) => montage.edit.insert({ asset: montage.timelines.asset(main), in: 0, at: 0, audio: null }), main);
    await editor.run(() => montage.seek(1));
    await editor.frame();
    const middle = await editor.previewColor({ x: 0.5, y: 0.5, size: 0.05 });
    const top = await editor.previewColor({ x: 0.5, y: 0.1, size: 0.05 });
    checks.check(middle[0] > 180 && top[0] < 30 && top[2] < 30, `a wide timeline nested in a tall one keeps its shape (middle ${middle.map(Math.round)}, top ${top.map(Math.round)})`);
    await page.selectOption('#timeline-select', main);
    await editor.until((main) => montage.timelines.active().id === main, main);
    checks.check((await editor.run(() => montage.size.width)) === 640, 'switching back restores the first frame size');
    await editor.run((id) => montage.timelines.remove(id), vertical);

    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
