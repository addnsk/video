import { Editor, fixture } from '../harness.mjs';

const RULER = 26;
const GUTTER = 44;
const V1_TOP = RULER + 4 + 56 + 4;

export default {
  name: 'edit-page',
  tags: ['edit'],
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    const { page } = editor;
    await editor.import([fixture('red.mov'), fixture('testsrc.mov')]);
    const asset = await editor.run(() => montage.assets().find((a) => a.name === 'testsrc.mov').id);
    await editor.run(() => {
      for (const c of montage.clips().filter((x) => x.name === 'testsrc.mov')) montage.remove(c.id);
    });
    await editor.run(() => montage.seek(0.5));
    await editor.frame();
    const timelineColor = await editor.previewColor();

    await page.dblclick(`.media-item[data-asset="${asset}"] b`);
    await editor.until(() => montage.source.state().viewer === 'source');
    checks.check((await page.getAttribute('#viewer-source', 'aria-selected')) === 'true', 'double-clicking a media item opens it in the source viewer');
    await editor.run(() => montage.source.seek(0.5));
    await editor.frame();
    const sourceColor = await editor.previewColor({ x: 0.1, y: 0.1, size: 0.05 });
    checks.check(Math.abs(sourceColor[0] - timelineColor[0]) > 0.05 || Math.abs(sourceColor[2] - timelineColor[2]) > 0.05, `the viewer shows the source clip, not the timeline (${sourceColor.map((v) => v.toFixed(2))} vs ${timelineColor.map((v) => v.toFixed(2))})`);

    await page.keyboard.press('ArrowRight');
    const sourceTime = await editor.run(() => montage.source.state().time);
    checks.near(sourceTime, 0.54, 0.001, 'arrow keys step the source playhead');
    checks.near(await editor.run(() => montage.time), 0.5, 1e-6, 'the timeline playhead stays where it was');

    await editor.run(() => montage.source.seek(1));
    await page.keyboard.press('KeyI');
    await editor.run(() => montage.source.seek(2));
    await page.keyboard.press('KeyO');
    checks.check(JSON.stringify(await editor.run(() => montage.source.state().marks)) === '{"in":1,"out":2}', 'I and O mark the source clip');
    await editor.run(() => montage.seek(1));
    await page.keyboard.press('F9');
    await editor.until(() => montage.clips().length === 3);
    const main = await editor.run(() => montage.clips().map((c) => [c.name, c.start, c.duration, c.audio, c.link !== null]));
    checks.check(JSON.stringify(main) === JSON.stringify([['red.mov', 0, 1, false, false], ['testsrc.mov', 1, 1, false, true], ['red.mov', 2, 1, false, false]]), `F9 inserts the marked source range at the playhead (${JSON.stringify(main)})`);
    const audio = await editor.run(() => montage.clips('a1').map((c) => [c.name, c.start, c.in, c.link !== null]));
    checks.check(JSON.stringify(audio) === JSON.stringify([['testsrc.mov', 1, 1, true]]), `the sound goes to a linked clip on the audio track (${JSON.stringify(audio)})`);
    checks.check((await editor.run(() => montage.source.state().viewer)) === 'timeline', 'the viewer returns to the timeline after the edit');
    const insertedId = await editor.run(() => montage.clips()[1].id);

    await page.keyboard.press('KeyT');
    checks.check((await page.getAttribute('#tool-ripple', 'aria-checked')) === 'true', 'T picks the ripple tool');
    const canvas = page.locator('#timeline');
    const box = await canvas.boundingBox();
    const view = async () => ({ pps: Number(await canvas.getAttribute('data-pps')), scroll: Number(await canvas.getAttribute('data-scroll')) });
    const xAt = async (time) => {
      const { pps, scroll } = await view();
      return box.x + GUTTER + time * pps - scroll;
    };
    const dragX = async (from, to, y = box.y + V1_TOP + 28) => {
      await page.mouse.move(from, y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) await page.mouse.move(from + ((to - from) * i) / 6, y);
      await page.mouse.up();
    };
    const pps = (await view()).pps;
    await dragX((await xAt(2)) - 2, (await xAt(2)) - 2 - 0.4 * pps);
    const rippled = await editor.run((id) => [montage.clip(id).duration, montage.clips()[2].start, montage.clips('a1')[0].duration, montage.duration], insertedId);
    checks.near(rippled[0], 0.6, 0.041, `ripple drag shortens the clip (${rippled[0]})`);
    checks.near(rippled[1], 1.6, 0.041, 'and pulls the next clip in');
    checks.near(rippled[2], rippled[0], 1e-6, 'the linked audio is trimmed with it');
    checks.near(rippled[3], 2.6, 0.041, 'the sequence gets shorter');

    await page.keyboard.press('KeyR');
    const cut = await editor.run((id) => montage.clip(id).start + montage.clip(id).duration, insertedId);
    await dragX((await xAt(cut)) - 2, (await xAt(cut)) - 2 + 0.2 * pps);
    const rolled = await editor.run((id) => [montage.clip(id).duration, montage.duration], insertedId);
    checks.near(rolled[0], rippled[0] + 0.2, 0.041, `roll drag moves the cut (${rolled[0]})`);
    checks.near(rolled[1], rippled[3], 1e-6, 'and keeps the sequence length');

    await page.keyboard.press('KeyY');
    const before = await editor.run((id) => montage.clip(id).in, insertedId);
    await page.keyboard.press('Period');
    const slipped = await editor.run((id) => [montage.clip(id).in, montage.clips('a1')[0].in], insertedId);
    checks.near(slipped[0] - before, 0.04, 1e-6, 'the period key slips the selected clip by one frame');
    checks.near(slipped[1], slipped[0], 1e-6, 'and its linked audio');

    await editor.run(() => montage.seek(0.3));
    await page.keyboard.press('KeyM');
    const markers = await editor.run(() => montage.markers.list().map((m) => m.time));
    checks.check(markers.length === 1 && Math.abs(markers[0] - 0.3) < 1e-6, 'M drops a marker at the playhead');
    await editor.until(() => document.querySelectorAll('#markers .marker-row').length === 1);
    await page.fill('#markers .marker-row input[type=text]', 'Cue');
    await page.locator('#markers .marker-row input[type=text]').first().dispatchEvent('change');
    checks.check((await editor.run(() => montage.markers.list()[0].name)) === 'Cue', 'the markers panel renames a marker');
    await editor.run(() => montage.seek(2.5));
    await page.keyboard.press('Shift+ArrowUp');
    checks.near(await editor.run(() => montage.time), 0.3, 1e-6, 'Shift+Up jumps to the previous marker');

    await page.keyboard.press('KeyA');
    await editor.run((id) => montage.select(id), insertedId);
    const length = await editor.run(() => montage.duration);
    const clipLength = await editor.run((id) => montage.clip(id).duration, insertedId);
    await page.keyboard.press('Shift+Delete');
    const after = await editor.run(() => [montage.clips().length, montage.clips('a1').length, montage.duration]);
    checks.check(after[0] === 2 && after[1] === 0, 'Shift+Delete ripple-deletes the clip with its linked audio');
    checks.near(after[2], length - clipLength, 1e-6, 'and closes the gap');
    await page.keyboard.press('Control+z');
    checks.check((await editor.run(() => montage.clips('a1').length)) === 1, 'undo brings both back');

    await editor.run(() => montage.marks({ in: 0, out: 0.5 }));
    await page.keyboard.press('Alt+KeyX');
    checks.check(JSON.stringify(await editor.run(() => montage.marks())) === '{}', 'Alt+X clears the timeline marks');
    await editor.close();
  },
};
