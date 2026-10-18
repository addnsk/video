import { Editor, fixture } from '../harness.mjs';

const fmt = (c) => c.map((v) => v.toFixed(0)).join(',');
const CENTER = { x: 0.5, y: 0.5, size: 0.04 };

export default {
  name: 'color-nodes',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('red.mov'), fixture('gray.mov')]);
    const grayAt = await editor.run(() => montage.clip(1).start + 0.5);
    const color = (time = 0.5) => editor.previewColorAt(time, CENTER);
    const reset = (ref) =>
      editor.run((ref) => {
        montage.graph.enable(ref);
        for (const n of montage.graph.get(ref).nodes) if (n.id !== 'source' && n.id !== 'output') montage.graph.remove(ref, n.id);
        montage.graph.connect(ref, 'source', 'output');
      }, ref);
    const maskOf = async (type, params) => {
      for (const ref of [0, 1]) {
        await reset(ref);
        await editor.run(({ ref, type, params }) => {
          const id = montage.graph.add(ref, type, params);
          montage.graph.connect(ref, 'source', id);
          montage.graph.connect(ref, id, 'output');
        }, { ref, type, params });
      }
      return [await color(), await color(grayAt)];
    };

    await editor.run(() => montage.diagnostics.clear());
    const [redHsl, grayHsl] = await maskOf('qualifier', { hueCenter: 0, hueWidth: 0.05 });
    checks.check(redHsl[0] > 240 && grayHsl[0] < 10, `HSL qualifier selects red and rejects gray (${fmt(redHsl)} / ${fmt(grayHsl)})`);
    const [red3d, gray3d] = await maskOf('qualifier-3d', { key1: [1, 0, 0, 1], tolerance: 0.1 });
    checks.check(red3d[0] > 240 && gray3d[0] < 10, `3D qualifier selects the picked color (${fmt(red3d)} / ${fmt(gray3d)})`);

    await reset(0);
    await editor.run(() => {
      const a = montage.graph.add(0, 'background', { color: [1, 0, 0, 1] });
      const b = montage.graph.add(0, 'background', { color: [0, 0, 1, 1] });
      const mix = montage.graph.add(0, 'parallel-mixer');
      montage.graph.connect(0, a, mix, 'a');
      montage.graph.connect(0, b, mix, 'b');
      montage.graph.connect(0, mix, 'output');
    });
    const mixed = await color();
    checks.check(mixed[0] > 100 && mixed[2] > 100 && mixed[1] < 20, `parallel mixer averages its inputs (${fmt(mixed)})`);
    for (const ref of [0, 1]) {
      await reset(ref);
      await editor.run((ref) => montage.graph.disable(ref), ref);
    }

    const gray = await color(grayAt);
    await editor.run(() => montage.effect(1, 'hdr-wheels', { global: [0, 0, 0.5] }));
    const brighter = await color(grayAt);
    checks.check(brighter[0] > gray[0] + 30, `HDR wheels global exposure brightens (${fmt(gray)} → ${fmt(brighter)})`);
    await editor.run(() => montage.effect(1, 'hdr-wheels', { shadow: [0.3, 0, 0], light: [0.3, 0, 0], global: [0, 0, 0] }));
    const tinted = await color(grayAt);
    checks.check(tinted[0] > tinted[2] + 15, `HDR wheels tint the tonal zones (${fmt(tinted)})`);
    await editor.run(() => montage.effect(1, 'hdr-wheels', null));

    await editor.run(() => montage.effect(0, 'color-warper', { red: [1, 0, 0] }));
    const warped = await color();
    checks.check(warped[1] > 60 && warped[0] > 200, `color warper shifts red toward yellow (${fmt(warped)})`);
    await editor.run(() => montage.effect(0, 'color-warper', null));

    await editor.run(() => montage.effect(0, 'curves', { hueHue: [0, 0.6, 0.5, 0.5, 1, 0.6] }));
    const hueShifted = await color();
    checks.check(hueShifted[1] > 60, `hue vs hue curve rotates red (${fmt(hueShifted)})`);
    await editor.run(() => montage.effect(0, 'curves', { hueHue: [0, 0.5, 1, 0.5], satSat: [0, 0, 1, 0] }));
    const desaturated = await color();
    checks.check(Math.abs(desaturated[0] - desaturated[2]) < 10, `sat vs sat curve can remove saturation (${fmt(desaturated)})`);
    const errors = await editor.run(() => montage.diagnostics.entries().filter((e) => e.level === 'error').map((e) => e.message));
    checks.check(!errors.length, `color nodes compile without errors (${errors.join('; ')})`);
    await editor.close();
  },
};
