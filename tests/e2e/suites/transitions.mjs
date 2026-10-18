import { Editor, fixture } from '../harness.mjs';

export default {
  name: 'transitions',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('red.mov'), fixture('blue.mov')]);
    const [r] = await editor.previewColorAt(0.5);
    checks.check(r > 200, `red clip renders red (${r.toFixed(0)})`);

    await editor.run(() => montage.transition(1, { type: 'dissolve', duration: 1 }));
    const mid = await editor.run(() => montage.clip(1).start + montage.clip(1).transition.duration / 2);
    const [mr, , mb] = await editor.previewColorAt(mid);
    checks.check(mr > 80 && mb > 80, `dissolve midpoint mixes both clips (r ${mr.toFixed(0)}, b ${mb.toFixed(0)})`);

    const builtins = await editor.run(() => montage.transitions.list().map((t) => t.id));
    for (const type of builtins) {
      await editor.run((type) => montage.transition(1, { type, duration: 1 }), type);
      await editor.seekAndSettle(mid, 800);
    }
    checks.check(editor.errors.length === 0, `all ${builtins.length} built-in transitions render without errors`);

    await editor.run(() => {
      montage.transitions.register({
        id: 'to-green',
        name: 'To green',
        glsl: 'uniform vec3 tint; // = vec3(0.0, 1.0, 0.0)\nvec4 transition(vec2 uv) { return vec4(tint, 1.0); }',
      });
      montage.transition(1, { type: 'to-green', duration: 1 });
    });
    const [gr, gg, gb] = await editor.previewColorAt(mid);
    checks.check(gg > 200 && gr < 60 && gb < 60, `custom transition shader drives the frame (${[gr, gg, gb].map((v) => v.toFixed(0))})`);

    await editor.run(() => montage.transition(1, { type: 'to-green', duration: 1, params: { tint: [1, 1, 0] } }));
    const [pr, pg] = await editor.previewColorAt(mid);
    checks.check(pr > 200 && pg > 200, 'custom transition params reach the shader');

    const after = await editor.run(() => montage.clip(1).start + 1.5);
    const [, , ab] = await editor.previewColorAt(after);
    checks.check(ab > 200, 'incoming clip shows after the transition');
    await editor.close();
  },
};
