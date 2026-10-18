import { Editor, fixture } from '../harness.mjs';

const geometry = async (editor) => {
  const box = await editor.page.locator('#timeline').boundingBox();
  const { pps, scroll } = await editor.run(() => {
    const { pps, scroll } = document.querySelector('#timeline').dataset;
    return { pps: Number(pps), scroll: Number(scroll) };
  });
  return {
    lane: (index) => box.y + 30 + index * 60 + 28,
    at: (seconds) => box.x + 44 + seconds * pps - scroll,
    above: box.y - 40,
  };
};

const drag = async (editor, from, to, steps = 12) => {
  await editor.page.mouse.move(from.x, from.y);
  await editor.page.mouse.down();
  await editor.page.mouse.move(to.x, to.y, { steps });
  await editor.page.mouse.up();
};

export default {
  name: 'media-drag',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('red.mov'), fixture('blue.mov'), fixture('music.wav')]);
    const layout = await editor.run(() => ({ main: montage.clips().length, overlay: montage.clips('v2').length }));
    const { lane, at, above } = await geometry(editor);
    const lanes = await editor.run(() => montage.tracks().map((t) => t.id));
    checks.check(lanes.join() === 'v1,v2,a1', `default lanes (${lanes})`);

    const item = (name) => editor.page.locator('.media-item', { hasText: name });
    const box = async (name, part) => {
      await item(name).scrollIntoViewIfNeeded();
      return item(name).locator(part).boundingBox();
    };
    const v2 = lane(0);
    const v1 = lane(1);

    const blue = await box('blue.mov', 'b');
    await drag(editor, { x: blue.x + 10, y: blue.y + 5 }, { x: at(0.2), y: v1 });
    const main = await editor.run(() => montage.clips().map((c) => c.name));
    checks.check(main.length === layout.main + 1 && main[0] === 'blue.mov', `dragging onto the main track inserts at the drop point (${main})`);

    const grip = await box('red.mov', '.grip');
    await drag(editor, { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }, { x: at(2), y: v2 });
    const overlay = await editor.run(() => montage.clips('v2').map((c) => [c.name, +c.start.toFixed(2)]));
    checks.check(overlay.length === layout.overlay + 1 && overlay[0][0] === 'red.mov' && Math.abs(overlay[0][1] - 2) < 0.3, `grip drag places on an overlay track at the pointer (${JSON.stringify(overlay)})`);

    const music = await box('music.wav', 'b');
    await drag(editor, { x: music.x + 10, y: music.y + 5 }, { x: at(1), y: v2 });
    checks.check((await editor.run(() => montage.clips('v2').length)) === layout.overlay + 1, 'audio-only media is refused by video tracks');

    await drag(editor, { x: music.x + 10, y: music.y + 5 }, { x: at(0.5), y: above });
    checks.check((await editor.page.locator('.drag-ghost').count()) === 0, 'drag ghost is removed after a drop outside');
    const undo = await editor.run(() => {
      const before = montage.clips('v2').length;
      montage.undo();
      return [before, montage.clips('v2').length];
    });
    checks.check(undo[1] === undo[0] - 1, 'a drop is one undo step');
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
