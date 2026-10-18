import { Editor, fixture } from '../harness.mjs';

const fmt = (c) => c.map((v) => v.toFixed(0)).join(',');
const isRed = (c) => c[0] > 200 && c[1] < 60 && c[2] < 60;

export default {
  name: 'text-node',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('red.mov')]);
    const text = await editor.run(() => {
      const id = montage.graph.add(0, 'text', { text: '█████', size: 0.3, fill: [1, 1, 1, 1], stagger: 0 });
      const merge = montage.graph.add(0, 'merge');
      montage.graph.connect(0, 'source', merge, 'background');
      montage.graph.connect(0, id, merge, 'foreground');
      montage.graph.connect(0, merge, 'output');
      return id;
    });
    const at = (x, y = 0.5) => editor.previewColorAt(0.5, { x, y, size: 0.02 });
    const center = await at(0.5);
    checks.check(center[1] > 150 && center[2] > 150, `text node draws glyphs over the clip (${fmt(center)})`);
    checks.check(isRed(await at(0.5, 0.1)), 'outside the text the clip shows through');

    await editor.run((id) => montage.graph.set(0, id, { progress: 0, fromOpacity: 0 }), text);
    checks.check(isRed(await at(0.5)), 'progress 0 with zero start opacity hides the text');

    await editor.run((id) => {
      montage.graph.set(0, id, { progress: 1 });
      montage.graph.keyframe(0, id, 'progress', 0, 0);
      montage.graph.keyframe(0, id, 'progress', 1, 1);
    }, text);
    const early = await editor.previewColorAt(0.05, { x: 0.5, y: 0.5, size: 0.02 });
    const late = await editor.previewColorAt(1.2, { x: 0.5, y: 0.5, size: 0.02 });
    checks.check(isRed(early) && !isRed(late), `keyframed progress animates the text in (${fmt(early)} → ${fmt(late)})`);

    await editor.run((id) => montage.graph.set(0, id, { center: [0, -0.3], outline: [0, 0, 1, 1], outlineWidth: 0.1 }), text);
    const moved = await at(0.5, 0.2);
    checks.check(!isRed(moved) && isRed(await at(0.5)), `center moves the text up (${fmt(moved)})`);

    await editor.run((id) => montage.graph.set(0, id, { text: '', shadow: [0, 0, 0, 1] }), text);
    checks.check(isRed(await at(0.5, 0.2)), 'empty text renders nothing');
    await editor.run((id) => montage.graph.set(0, id, { text: '█████', center: [0, 0], outlineWidth: 0, progress: 1 }), text);
    await editor.run(() => montage.clearKeyframes(0, Object.keys(montage.clip(0).animations)[0]));
    const many = await editor.run(async (id) => {
      const text = Array.from({ length: 16 }, () => '█'.repeat(20)).join('\n');
      montage.graph.set(0, id, { text, size: 0.05, lineSpacing: 1.1, progress: 0.6, stagger: 0, fromOpacity: 0.5, fromOffset: [0, 0] });
      const [first, last] = await montage.sample([{ x: -0.1, y: -0.38 }, { x: 0.1, y: 0.38 }], 0.5);
      return { first: first.map((v) => v * 255), last: last.map((v) => v * 255) };
    }, text);
    checks.check(!isRed(many.first) && !isRed(many.last), `all 320 glyphs animate, not only the first 128 (${fmt(many.first)} / ${fmt(many.last)})`);

    const bleed = await editor.run(async (id) => {
      const grid = [];
      for (let y = -0.2; y <= 0.02; y += 0.02) for (let x = -0.45; x <= 0.1; x += 0.01) grid.push({ x, y });
      const render = async (text) => {
        montage.graph.set(0, id, { text, size: 0.25, align: 'left', tracking: -0.25, lineSpacing: 1.2, progress: 0.05, stagger: 0.9, order: 'forward', fromOpacity: 0, fromOffset: [0, 0], fromScale: 1 });
        return montage.sample(grid, 0.5);
      };
      const withHidden = await render('r.\nWWWWWW');
      const alone = await render('r\nWWWWWW');
      const lit = alone.filter((c) => c[1] > 0.5).length;
      let worst = 0;
      withHidden.forEach((c, i) => (worst = Math.max(worst, Math.abs(c[1] - alone[i][1]))));
      return { lit, worst };
    }, text);
    checks.check(bleed.lit > 3 && bleed.worst < 0.05, `an animating glyph does not carry pieces of a tightly kerned neighbour (${JSON.stringify(bleed)})`);
    await editor.run((id) => montage.graph.set(0, id, { text: '█████', size: 0.3, tracking: 0, lineSpacing: 1.2, stagger: 0, fromOpacity: 0, progress: 1 }), text);
    await editor.import([fixture('blue.mov')], 2);
    const inserted = await editor.run((id) => {
      const merge = montage.graph.get(0).links.find((l) => l.from === id).to;
      montage.templates.save(montage.graph.template(0, [id, merge], 'Block title'));
      const ids = montage.graph.insert(1, 'Block title', { source: 'source' });
      montage.graph.connect(1, ids.output, 'output');
      return { saved: montage.templates.list().map((t) => t.name), ids, start: montage.clip(1).start };
    }, text);
    const blueCenter = await editor.previewColorAt(inserted.start + 0.5, { x: 0.5, y: 0.5, size: 0.02 });
    const blueEdge = await editor.previewColorAt(inserted.start + 0.5, { x: 0.5, y: 0.1, size: 0.02 });
    checks.check(inserted.saved.includes('Block title') && blueCenter[0] > 200 && blueEdge[2] > 200 && blueEdge[0] < 60, `saved template inserts the title into another clip (${fmt(blueCenter)} / ${fmt(blueEdge)})`);

    const custom = await editor.run(() => {
      montage.nodes.register({
        id: 'text-boxes',
        name: 'Text boxes',
        inputs: [],
        raster: 'text',
        params: [{ name: 'text', type: 'text', default: 'AB' }, { name: 'size', type: 'float', default: 0.3 }],
        passes: `vec4 process(vec2 uv) {
          for (int i = 0; i < 128; i++) {
            if (i >= glyph_count()) break;
            vec4 r = glyph(i);
            if (all(greaterThan(uv, r.xy)) && all(lessThan(uv, r.zw))) return vec4(0.0, 1.0, 0.0, 1.0);
          }
          return vec4(0.0);
        }`,
      });
      const id = montage.graph.add(0, 'text-boxes');
      montage.graph.connect(0, id, 'output');
      return montage.graph.types().some((t) => t.id === 'text-boxes');
    });
    const box = await at(0.5);
    checks.check(custom && box[1] > 200 && box[0] < 60, `custom raster nodes get glyph boxes (${fmt(box)})`);
    await editor.close();
  },
};
