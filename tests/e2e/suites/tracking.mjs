import { Editor, fixture } from '../harness.mjs';

export default {
  name: 'tracking',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('moving.mov')]);
    const start = { x: 150 / 640 - 0.5, y: 0 };
    const path = await editor.run((p) => montage.track(0, { x: p.x, y: p.y }), start);
    const last = path.at(-1);
    const expected = (100 + 0.96 * 100 + 50) / 640 - 0.5;
    checks.check(path.length >= 20, `tracker returns a point per frame (${path.length})`);
    checks.check(last && Math.abs(last.x - expected) < 0.01 && Math.abs(last.y) < 0.01, `tracker follows the moving patch (${last?.x.toFixed(3)},${last?.y.toFixed(3)} vs ${expected.toFixed(3)},0)`);

    const mask = await editor.run(async (p) => {
      const id = montage.graph.add(0, 'ellipse-mask');
      await montage.track(0, { x: p.x, y: p.y, apply: { node: id, param: 'center' } });
      return montage.clip(0).animations[`node.${id}.center.0`]?.length ?? 0;
    }, start);
    checks.check(mask >= 20, `follow writes node keyframes (${mask})`);

    const stable = await editor.run(async (p) => {
      await montage.track(0, { x: p.x, y: p.y, apply: 'stabilize' });
      const keys = montage.clip(0).animations['transform.x'];
      return keys ? keys.at(-1).v : null;
    }, start);
    checks.check(stable !== null && Math.abs(stable + (expected - start.x)) < 0.01, `stabilize offsets the clip against the motion (${stable?.toFixed(3)})`);
    await editor.run(() => {
      montage.clearKeyframes(0, 'x');
      montage.clearKeyframes(0, 'y');
      montage.select(0);
      montage.seek(0);
    });
    await editor.page.click('#item-stabilize');
    await editor.page.waitForSelector('#point-picker:not([hidden])');
    const box = await editor.page.locator('.screen').boundingBox();
    const aspect = 640 / 360;
    const w = box.width / box.height > aspect ? box.height * aspect : box.width;
    const hgt = box.width / box.height > aspect ? box.height : box.width / aspect;
    await editor.page.mouse.click(box.x + (box.width - w) / 2 + (150 / 640) * w, box.y + (box.height - hgt) / 2 + 0.5 * hgt);
    const picked = await editor.until(() => montage.clip(0).animations['transform.x']?.length >= 20, null, 30000).then(() => true, () => false);
    checks.check(picked, 'stabilize from the viewer pick writes keyframes');
    await editor.close();
  },
};
