import { Editor, fixture } from '../harness.mjs';

export default {
  name: 'qualifier-pick',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('bars.mov')]);
    const bars = await editor.run(async () => {
      montage.renderCache(false);
      const xs = Array.from({ length: 7 }, (_, i) => -0.5 + (i + 0.5) / 7);
      return { xs, colors: await montage.sample(xs.map((x) => ({ x, y: -0.2 })), 0.5) };
    });
    const target = bars.xs[2];
    const other = bars.xs[5];
    const result = await editor.run(async ({ target, other }) => {
      const q = montage.graph.add(0, 'qualifier');
      montage.graph.connect(0, 'source', q);
      montage.graph.connect(0, q, 'output');
      const params = await montage.graph.pick(0, q, { x: target, y: -0.2 }, { time: 0.5 });
      const [on, off] = await montage.sample([{ x: target, y: -0.2 }, { x: other, y: -0.2 }], 0.5);
      return { params, on, off, q };
    }, { target, other });
    checks.check(result.on[0] > 0.9 && result.off[0] < 0.1, `picking a bar selects that bar only (on ${result.on[0].toFixed(2)}, off ${result.off[0].toFixed(2)}, hue ${result.params.hueCenter.toFixed(3)})`);

    await editor.run(() => montage.colorScience('aces'));
    const aces = await editor.run(async ({ target, other, q }) => {
      await montage.graph.pick(0, q, { x: target, y: -0.2 }, { time: 0.5 });
      const [on, off] = await montage.sample([{ x: target, y: -0.2 }, { x: other, y: -0.2 }], 0.5);
      return { on, off };
    }, { target, other, q: result.q });
    checks.check(aces.on[0] > 0.9 && aces.off[0] < 0.1, `picking works on ACEScct working values too (on ${aces.on[0].toFixed(2)}, off ${aces.off[0].toFixed(2)})`);
    await editor.run(() => montage.colorScience('display'));

    const q3 = await editor.run(() => {
      const id = montage.graph.add(0, 'qualifier-3d');
      montage.graph.connect(0, 'source', id);
      montage.graph.connect(0, id, 'output');
      montage.select(0);
      return id;
    });
    await editor.page.click('#view-nodes');
    await editor.until((id) => (document.querySelector('#node-canvas').dataset.ports ?? '').includes(id), q3);
    const ports = JSON.parse(await editor.page.getAttribute('#node-canvas', 'data-ports'));
    const box = await editor.page.locator('#node-canvas').boundingBox();
    await editor.page.mouse.click(box.x + ports[q3].center[0], box.y + ports[q3].center[1]);
    await editor.page.waitForSelector('#qualifier-add', { timeout: 10000 });
    await editor.page.click('#qualifier-add');
    await editor.page.waitForSelector('#point-picker:not([hidden])');
    const screen = await editor.page.locator('.screen').boundingBox();
    const aspect = 16 / 9;
    const w = screen.width / screen.height > aspect ? screen.height * aspect : screen.width;
    const hgt = screen.width / screen.height > aspect ? screen.height : screen.width / aspect;
    await editor.page.mouse.click(screen.x + (screen.width - w) / 2 + (other + 0.5) * w, screen.y + (screen.height - hgt) / 2 + 0.3 * hgt);
    const added = await editor.until((id) => (montage.graph.get(0).nodes.find((n) => n.id === id).params.key2?.[3] ?? 0) > 0, q3, 15000).then(() => true, () => false);

    checks.check(added, 'the add button picks a second key color from the viewer');
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
