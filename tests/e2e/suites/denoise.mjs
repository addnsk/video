import { Editor, fixture } from '../harness.mjs';

export default {
  name: 'denoise',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('noisy.mov')]);
    await editor.run(() => montage.renderCache(false));
    await editor.seekAndSettle(0.5);
    const noisy = await editor.previewNoise();
    const spatial = await editor.run(() => {
      const id = montage.graph.add(0, 'denoise', { luma: 0.15, chroma: 0.15, radius: 2 });
      montage.graph.connect(0, 'source', id);
      montage.graph.connect(0, id, 'output');
      return id;
    });
    await editor.seekAndSettle(0.5);
    const cleaned = await editor.previewNoise();
    checks.check(cleaned < noisy * 0.6, `spatial noise reduction lowers noise (${noisy.toFixed(1)} → ${cleaned.toFixed(1)})`);

    await editor.run((id) => {
      montage.graph.remove(0, id);
      const t = montage.graph.add(0, 'temporal-denoise', { strength: 0.8, motion: 0.3 });
      montage.graph.connect(0, 'source', t);
      montage.graph.connect(0, t, 'output');
    }, spatial);
    await editor.seekAndSettle(0.4);
    const first = await editor.previewNoise();
    for (let i = 1; i <= 6; i++) await editor.seekAndSettle(0.4 + i / 25, 400);
    const settled = await editor.previewNoise();
    checks.check(first > noisy * 0.8, `temporal noise reduction has no history after a jump (${first.toFixed(1)})`);
    checks.check(settled < first * 0.7, `temporal noise reduction accumulates over consecutive frames (${first.toFixed(1)} → ${settled.toFixed(1)})`);
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
