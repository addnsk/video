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
    await editor.run(() => {
      montage.clearKeyframes(0, 'x');
      montage.clearKeyframes(0, 'y');
      montage.set(0, { transform: { x: 0.05, y: -0.03, scale: 0.8, rotation: 30 } });
    });
    const rotated = await editor.run(async () => {
      const angle = (30 * Math.PI) / 180;
      const w = 640 * 0.8;
      const h = 360 * 0.8;
      const dx = (160 / 640 - 0.5) * w;
      const dy = (180 / 360 - 0.5) * h;
      const start = { x: 0.05 + (Math.cos(angle) * dx + Math.sin(angle) * dy) / 640, y: -0.03 + (-Math.sin(angle) * dx + Math.cos(angle) * dy) / 360 };
      const path = await montage.track(0, start);
      const last = path.at(-1);
      const [before] = await montage.sample([start], 0);
      const [after] = await montage.sample([{ x: last.x, y: last.y }], last.t);
      const ex = (256 / 640 - 0.5) * w;
      const expected = { x: 0.05 + (Math.cos(angle) * ex + Math.sin(angle) * dy) / 640, y: -0.03 + (-Math.sin(angle) * ex + Math.cos(angle) * dy) / 360 };
      return { before, after, last, expected, frames: path.length };
    });
    const diff = Math.max(...rotated.before.map((v, i) => Math.abs(v - rotated.after[i])));
    const gray = rotated.after.every((v) => Math.abs(v - 0x40 / 255) < 0.03);
    checks.check(rotated.frames >= 20 && diff < 0.08 && !gray, `on a rotated, scaled clip the tracked point stays on the same picture detail (${rotated.before.map((v) => v.toFixed(2))} → ${rotated.after.map((v) => v.toFixed(2))})`);
    checks.check(Math.hypot(rotated.last.x - rotated.expected.x, rotated.last.y - rotated.expected.y) < 0.01, `and lands where the patch moved to in frame space (${rotated.last.x.toFixed(3)},${rotated.last.y.toFixed(3)} vs ${rotated.expected.x.toFixed(3)},${rotated.expected.y.toFixed(3)})`);
    await editor.run(() => montage.set(0, { transform: { x: 0, y: 0, scale: 1, rotation: 0 } }));

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
