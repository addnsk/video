import { Editor, fixture } from '../harness.mjs';

const advance = async (editor, ms) => {
  const from = await editor.run(() => montage.time);
  await editor.settle(ms);
  return (await editor.run(() => montage.time)) - from;
};

export default {
  name: 'playback',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('testsrc.mov'), fixture('bars.mov')]);
    const key = (k) => editor.page.keyboard.press(k);

    await key('KeyL');
    await editor.settle(500);
    const normal = await advance(editor, 1000);
    checks.near(normal, 1, 0.35, 'L plays at normal speed');
    await key('KeyL');
    await key('KeyL');
    await editor.settle(400);
    const fast = await advance(editor, 1000);
    checks.check(fast > 2.8, `L L L shuttles at 4x (${fast.toFixed(2)} s per second)`);
    checks.check((await editor.page.textContent('#rate')) === '4×', 'rate badge shows 4×');

    await key('KeyK');
    const paused = await editor.run(() => montage.time);
    checks.check(Math.abs((await advance(editor, 500))) < 1e-6, 'K stops');
    checks.check(await editor.page.isHidden('#rate'), 'rate badge hides when stopped');

    await key('KeyJ');
    await key('KeyJ');
    await editor.settle(300);
    const back = await advance(editor, 1000);
    checks.check(back < -1.4, `J J shuttles backward at 2x (${back.toFixed(2)} s per second)`);
    await key('KeyK');
    checks.check((await editor.run(() => montage.time)) < paused, 'reverse shuttle moved the playhead back');

    await editor.run(() => montage.seek(1));
    await key('KeyJ');
    await editor.until(() => montage.time === 0, null, 5000);
    await editor.settle(300);
    checks.check(await editor.page.isHidden('#rate'), 'reverse shuttle stops at the start');

    await editor.settle(1000);
    const s = await editor.stats();
    checks.check((s.resources.videoSample?.live ?? 0) === 0, 'no decoded frames held after shuttling');
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
