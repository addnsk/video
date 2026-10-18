import { Editor, fixture } from '../harness.mjs';

const fmt = (c) => c.map((v) => v.toFixed(3)).join(',');

export default {
  name: 'edge-cases',
  tags: ['media'],
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url, { inline: true });
    await editor.import([fixture('gray.mov'), fixture('red.mov')]);
    await editor.run(() => montage.renderCache(false));
    const sample = (points, time = 0.5) =>
      editor.run(async ({ points, time }) => {
        for (let i = 0; i < 20; i++) {
          try {
            return await montage.sample(points, time);
          } catch {
            await new Promise((r) => setTimeout(r, 250));
          }
        }
        return montage.sample(points, time);
      }, { points, time });
    const throws = (fn, arg) => editor.run(async ({ body, arg }) => {
      try {
        await new Function('arg', body)(arg);
        return null;
      } catch (e) {
        return e.message;
      }
    }, { body: `return (${fn})(arg)`, arg });

    const text = await editor.run(() => {
      const id = montage.graph.add(0, 'text', { text: '' });
      const merge = montage.graph.add(0, 'merge');
      montage.graph.connect(0, 'source', merge, 'background');
      montage.graph.connect(0, id, merge, 'foreground');
      montage.graph.connect(0, merge, 'output');
      return id;
    });
    const [empty] = await sample([{ x: 0, y: 0 }]);
    checks.check(Math.abs(empty[0] - 0.502) < 0.01, `empty text renders nothing (${fmt(empty)})`);
    await editor.run((id) => montage.graph.set(0, id, { text: '█'.repeat(40) + '\n' + 'Ünïcødé ✓ 😀 '.repeat(20), size: 0.05, progress: 0.5 }), text);
    const [long] = await sample([{ x: 0, y: -0.02 }]);
    checks.check(long.every(Number.isFinite), `300 glyphs with emoji and accents render without errors (${fmt(long)})`);
    await editor.run((id) => montage.graph.set(0, id, { text: 'A\n\n\nB', size: 0.3, lineSpacing: 0.5, tracking: -0.2, outlineWidth: 0.3 }), text);
    await sample([{ x: 0, y: 0 }]);

    await editor.run(() => montage.graph.disconnect(0, 'output'));
    const [unplugged] = await sample([{ x: 0, y: 0 }]);
    checks.check(unplugged.every(Number.isFinite), `a graph with nothing connected to the output renders (${fmt(unplugged)})`);
    const cycle = await throws(() => {
      const a = montage.graph.add(0, 'blur');
      const b = montage.graph.add(0, 'invert');
      montage.graph.connect(0, a, b);
      montage.graph.connect(0, b, a);
    });
    checks.check(!!cycle, `connecting a cycle is refused (${cycle})`);
    const unknown = await throws(() => montage.graph.add(0, 'no-such-node'));
    checks.check(/Unknown node/.test(unknown ?? ''), `adding an unknown node type explains the choices (${unknown?.slice(0, 40)})`);
    const space = await throws(() => montage.colorSpace(0, 'cineon'));
    checks.check(/Unknown color space/.test(space ?? ''), 'setting an unknown color space is refused');
    const version = await throws(() => montage.versions.load(0, 'missing'));
    checks.check(/No grade version/.test(version ?? ''), 'loading a missing grade version is refused');
    const science = await throws(() => montage.colorScience('acescg'));
    checks.check(!!science, 'an unknown color science is refused');

    const keyed = await editor.run(() => {
      const id = montage.graph.add(0, 'blur');
      montage.graph.keyframe(0, id, 'radius', 0, 1);
      montage.graph.keyframe(0, id, 'radius', 1, 5);
      montage.graph.remove(0, id);
      return Object.keys(montage.clip(0).animations).filter((k) => k.includes(id)).length;
    });
    checks.check(keyed === 0, `removing a node drops its keyframes (${keyed} left)`);

    await editor.run(() => {
      montage.graph.disable(0);
      montage.graph.enable(0);
      for (const n of montage.graph.get(0).nodes) if (n.id !== 'source' && n.id !== 'output') montage.graph.remove(0, n.id);
      const g = montage.graph.add(0, 'grade', { exposure: 0.5 });
      const t = montage.graph.add(0, 'temporal-denoise');
      montage.graph.connect(0, 'source', g);
      montage.graph.connect(0, g, t);
      montage.graph.connect(0, t, 'output');
      montage.renderCache(true);
    });
    await editor.seekAndSettle(0.4);
    await editor.seekAndSettle(0.44);
    const [beforeLoss] = await sample([{ x: 0, y: 0 }], 0.48);
    await editor.run(() => {
      const gl = document.querySelector('.screen canvas').getContext('webgl2');
      const ext = gl.getExtension('WEBGL_lose_context');
      ext.loseContext();
      return new Promise((r) => setTimeout(() => {
        ext.restoreContext();
        setTimeout(r, 500);
      }, 300));
    });
    await editor.settle(1500);
    const [afterLoss] = await sample([{ x: 0, y: 0 }], 0.48);
    checks.check(Math.abs(afterLoss[0] - beforeLoss[0]) < 0.01, `rendering recovers after a lost GPU context with caches and history (${fmt(beforeLoss)} → ${fmt(afterLoss)})`);

    const small = await editor.run(async () => (await montage.render({ height: 90, quality: 'low' })).file?.size ?? 0);
    checks.check(small > 1000, `a tiny export with nodes works (${small} bytes)`);
    await editor.run(() => montage.speed(0, 3.7));
    const [fast] = await sample([{ x: 0, y: 0 }], 0.2);
    checks.check(fast.every(Number.isFinite), 'speed changes with temporal nodes render');
    await editor.run(() => montage.remove(0));
    const left = await editor.run(() => montage.clips().length);
    checks.check(left === 1, 'deleting a graded clip leaves the rest');
    const ignored = editor.errors.filter((e) => !/context/i.test(e));
    checks.check(ignored.length === 0, `no page errors ${ignored.join('; ')}`);
    await editor.close();
  },
};
