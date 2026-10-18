import { Editor, fixture } from '../harness.mjs';

const CENTER = { x: 0.5, y: 0.5, size: 0.04 };
const EDGE = { x: 0.08, y: 0.5, size: 0.04 };
const fmt = (c) => c.map((v) => v.toFixed(0)).join(',');

export default {
  name: 'fusion',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('red.mov'), fixture('gray.mov')]);
    const color = (region = CENTER, time = 0.5) => editor.previewColorAt(time, region);

    const grayTime = await editor.run(() => montage.clip(1).start + 0.5);
    await editor.run(() => montage.grade(1, { exposure: 0.5 }));
    const chain = await color(CENTER, grayTime);
    await editor.run(() => montage.graph.enable(1));
    const converted = await color(CENTER, grayTime);
    checks.check(Math.abs(chain[0] - converted[0]) < 2, `converting the effect chain to a graph keeps the image (${fmt(chain)} vs ${fmt(converted)})`);
    checks.check((await editor.run(() => montage.graph.get(1).editable)) === true, 'graph is editable after enabling');

    const invert = await editor.run(() => {
      const id = montage.graph.add(0, 'invert');
      montage.graph.connect(0, 'source', id);
      montage.graph.connect(0, id, 'output');
      return id;
    });
    const [ir, ig, ib] = await color();
    checks.check(ir < 40 && ig > 200 && ib > 200, `invert node renders (${fmt([ir, ig, ib])})`);
    await editor.run((id) => montage.graph.toggle(0, id, false), invert);
    checks.check((await color())[0] > 200, 'disabled node passes its input through');
    await editor.run((id) => montage.graph.remove(0, id), invert);

    const nodes = await editor.run(() => {
      const bg = montage.graph.add(0, 'background', { color: [0, 1, 0, 1] });
      const mask = montage.graph.add(0, 'ellipse-mask', { size: [0.3, 0.3], softness: 0 });
      const merge = montage.graph.add(0, 'merge');
      montage.graph.connect(0, bg, merge, 'background');
      montage.graph.connect(0, 'source', merge, 'foreground');
      montage.graph.connect(0, mask, merge, 'mask');
      montage.graph.connect(0, merge, 'output');
      return { bg, mask, merge };
    });
    const [cr, cg] = await color();
    const [er, eg] = await color(EDGE);
    checks.check(cr > 200 && cg < 50 && eg > 200 && er < 50, `merge with an ellipse mask composites (center ${fmt([cr, cg])}, edge ${fmt([er, eg])})`);

    await editor.run(({ merge }) => montage.graph.set(0, merge, { mode: 'add' }), nodes);
    const [ar, ag] = await color();
    checks.check(ar > 200 && ag > 200, `add blend mode mixes layers (${fmt([ar, ag])})`);
    await editor.run(({ merge }) => montage.graph.set(0, merge, { mode: 'normal' }), nodes);

    await editor.run(({ merge }) => {
      montage.graph.keyframe(0, merge, 'opacity', 0, 0);
      montage.graph.keyframe(0, merge, 'opacity', 1, 1);
    }, nodes);
    const start = await color(CENTER, 0.01);
    const later = await color(CENTER, 1.5);
    checks.check(start[1] > 200 && later[0] > 200, `node parameters animate with keyframes (${fmt(start)} → ${fmt(later)})`);

    const transform = await editor.run(({ merge }) => {
      const t = montage.graph.add(0, 'transform', { scale: 0.25 });
      montage.graph.connect(0, 'source', t);
      montage.graph.connect(0, t, merge, 'foreground');
      montage.graph.disconnect(0, merge, 'mask');
      return t;
    }, nodes);
    const tc = await color(CENTER, 1.5);
    const te = await color(EDGE, 1.5);
    checks.check(tc[0] > 200 && te[1] > 200, `transform node scales the input over the background (center ${fmt(tc)}, edge ${fmt(te)})`);

    await editor.run((t) => montage.graph.set(0, t, { scale: 1 }), transform);
    for (const type of ['blur', 'glow', 'crop', 'gradient', 'rectangle-mask']) {
      await editor.run(({ type, merge }) => {
        const id = montage.graph.add(0, type);
        if (type !== 'gradient' && type !== 'rectangle-mask') montage.graph.connect(0, 'source', id);
        montage.graph.connect(0, id, merge, 'foreground');
      }, { type, ...nodes });
      await color(CENTER, 1.5);
    }
    checks.check(editor.errors.length === 0, 'blur, glow, crop, gradient and rectangle mask render without errors');

    await editor.run(({ merge }) => montage.batch(() => {
      montage.nodes.register({
        id: 'channel-swap',
        name: 'Channel swap',
        passes: ['vec4 process(vec2 uv) { vec4 c = input_source(uv); return vec4(c.b, c.r, c.g, c.a); }', 'vec4 process(vec2 uv) { return previous(uv) * gain; }'],
        params: [{ name: 'gain', type: 'float', default: 1 }],
      });
      const id = montage.graph.add(0, 'channel-swap', { gain: 1 });
      montage.graph.connect(0, 'source', id);
      montage.graph.connect(0, id, merge, 'foreground');
    }), nodes);
    const [sr, sg] = await color(CENTER, 1.5);
    checks.check(sr < 50 && sg > 200, `custom multi-pass node from the API renders (${fmt([sr, sg])})`);

    const undone = await editor.run(() => {
      montage.undo();
      return montage.graph.get(0).nodes.some((n) => n.type === 'channel-swap');
    });
    checks.check(!undone, 'graph edits undo');
    await editor.run(() => montage.graph.disable(0));
    checks.check((await color(CENTER, 1.5))[0] > 200, 'disabling the graph restores the plain clip');

    const stats = await editor.stats();
    checks.check((stats.resources.framebuffer?.live ?? 0) <= 12, `render targets stay pooled (${stats.resources.framebuffer?.live})`);
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
