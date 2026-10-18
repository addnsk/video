import { Editor, fixture } from '../harness.mjs';

const fmt = (c) => c.map((v) => v.toFixed(0)).join(',');
const near = (a, b, d = 6) => a.every((v, i) => Math.abs(v - b[i]) <= d);

export default {
  name: 'fusion-nodes',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('prores-1080-10s.mov')]);
    await editor.run(() => montage.diagnostics.clear());
    const types = await editor.run(() => montage.graph.types().filter((t) => t.category !== 'color').map((t) => ({ id: t.id, inputs: t.inputs.map((i) => i.name ?? i) })));
    const reset = () =>
      editor.run(() => {
        montage.graph.enable(0);
        for (const n of montage.graph.get(0).nodes) if (n.id !== 'source' && n.id !== 'output') montage.graph.remove(0, n.id);
        montage.graph.connect(0, 'source', 'output');
      });
    const failed = [];
    for (const { id, inputs } of types) {
      await reset();
      await editor.run(({ id, inputs }) => {
        const node = montage.graph.add(0, id);
        if (inputs.length) montage.graph.connect(0, 'source', node, inputs[0]);
        montage.graph.connect(0, node, 'output');
      }, { id, inputs });
      await editor.previewColorAt(1, { x: 0.5, y: 0.5, size: 0.05 });
      const errors = await editor.run(() => montage.diagnostics.entries().filter((e) => e.level === 'error').map((e) => e.message));
      if (errors.length) failed.push(`${id}: ${errors[0]}`);
      await editor.run(() => montage.diagnostics.clear());
    }
    checks.check(!failed.length, `every built-in node compiles and renders (${types.length} nodes${failed.length ? `; ${failed.join('; ')}` : ''})`);

    const single = async (id, params = {}) => {
      await reset();
      return editor.run(({ id, params }) => {
        const node = montage.graph.add(0, id, params);
        const inputs = montage.graph.types().find((t) => t.id === id).inputs;
        if (inputs.length) montage.graph.connect(0, 'source', node, inputs[0].name ?? inputs[0]);
        montage.graph.connect(0, node, 'output');
        return node;
      }, { id, params });
    };
    await reset();
    const plain = await editor.previewColorAt(1, { x: 0.3, y: 0.4, size: 0.05 });
    await single('corner-pin');
    const pinned = await editor.previewColorAt(1, { x: 0.3, y: 0.4, size: 0.05 });
    checks.check(near(plain, pinned), `default corner pin keeps the image (${fmt(plain)} vs ${fmt(pinned)})`);
    await single('corner-pin', { topLeft: [0, 0], topRight: [0.5, 0], bottomRight: [0.5, 0.5], bottomLeft: [0, 0.5] });
    const topLeft = await editor.previewColorAt(1, { x: 0.25, y: 0.25, size: 0.05 });
    checks.check(topLeft.every((v) => v < 5), `corner pin moves the image into its quad (${fmt(topLeft)})`);

    await single('letterbox', { ratio: 2.39 });
    const bar = await editor.previewColorAt(1, { x: 0.5, y: 0.03, size: 0.02 });
    checks.check(bar.every((v) => v < 5), `letterbox draws bars (${fmt(bar)})`);

    await single('noise', { speed: 4 });
    const n1 = await editor.previewColorAt(1, { x: 0.5, y: 0.5, size: 0.01 });
    const n2 = await editor.previewColorAt(2.3, { x: 0.5, y: 0.5, size: 0.01 });
    checks.check(!near(n1, n2, 2), `noise animates over time (${fmt(n1)} → ${fmt(n2)})`);

    await single('vignette', { amount: 1, radius: 0.3, softness: 0.2 });
    const corner = await editor.previewColorAt(1, { x: 0.12, y: 0.95, size: 0.02 });
    checks.check(corner.every((v) => v < 10), `vignette darkens corners (${fmt(corner)})`);

    await reset();
    await editor.run(() => {
      const a = montage.graph.add(0, 'rectangle-mask', { center: [-0.2, 0], size: [0.5, 0.5], softness: 0 });
      const b = montage.graph.add(0, 'rectangle-mask', { center: [0.2, 0], size: [0.5, 0.5], softness: 0 });
      const combine = montage.graph.add(0, 'mask-combine', { mode: 'intersect' });
      montage.graph.connect(0, a, combine, 'a');
      montage.graph.connect(0, b, combine, 'b');
      montage.graph.connect(0, combine, 'output');
    });
    const middle = await editor.previewColorAt(1, { x: 0.5, y: 0.5, size: 0.02 });
    const side = await editor.previewColorAt(1, { x: 0.3, y: 0.5, size: 0.02 });
    checks.check(middle[0] > 240 && side[0] < 10, `mask intersection keeps only the overlap (${fmt(middle)} / ${fmt(side)})`);
    await editor.close();
  },
};
