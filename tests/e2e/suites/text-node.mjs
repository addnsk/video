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
