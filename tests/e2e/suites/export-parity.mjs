import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Editor, fixture } from '../harness.mjs';
import { compareWithExport, exportProres } from '../lib/parity.mjs';

const POINTS = [{ x: -0.35, y: -0.3 }, { x: 0, y: 0 }, { x: 0.25, y: 0.2 }, { x: -0.2, y: 0.35 }];
const TIMES = [0.5, 1.2, 3.04];

export default {
  name: 'export-parity',
  tags: ['export'],
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('gray.mov'), fixture('red.mov')]);
    await editor.run(() => {
      montage.renderCache(false);
      montage.colorScience('aces');
      montage.grade(0, { exposure: 0.4, saturation: 1.2 });
      const mask = montage.graph.add(0, 'bezier-mask', { feather: 0 });
      const fill = montage.graph.add(0, 'background', { color: [0.9, 0.7, 0.1, 1] });
      const text = montage.graph.add(0, 'text', { text: '██', size: 0.25, center: [0.25, 0.2], stagger: 0 });
      const keyed = montage.graph.add(0, 'merge');
      const titled = montage.graph.add(0, 'merge');
      montage.graph.connect(0, 'source', keyed, 'background');
      montage.graph.connect(0, fill, keyed, 'foreground');
      montage.graph.connect(0, mask, keyed, 'mask');
      montage.graph.connect(0, keyed, titled, 'background');
      montage.graph.connect(0, text, titled, 'foreground');
      montage.graph.connect(0, titled, 'output');
      montage.graph.keyframe(0, text, 'progress', 1, 0);
      montage.graph.keyframe(0, text, 'progress', 1.5, 1);
      montage.set(1, { transform: { scale: 0.6, x: 0.1 } });
      const vignette = montage.graph.add(1, 'vignette', { amount: 0.6 });
      montage.graph.connect(1, 'source', vignette);
      montage.graph.connect(1, vignette, 'output');
      montage.transition(1, { type: 'dissolve', duration: 0.5 });
    });
    const { size } = await editor.run(async () => ({ size: (await montage.stats()).previewSize }));
    const probes = TIMES.map((time) => ({ time, points: POINTS }));
    const { worst, notes } = await compareWithExport(editor, await exportProres(editor, size.height), size, 25, probes);
    checks.check(worst <= 0.02, `exported ProRes matches the preview with ACES, masks, an animated text node, transforms and a dissolve (worst ${worst.toFixed(4)}${notes.length ? `; ${notes.slice(0, 4).join('; ')}` : ''})`);
    const exportFile = async () => {
      const b64 = await editor.run(async () => {
        const r = await montage.render({ prores: 'hq' });
        const bytes = new Uint8Array(await r.file.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(binary);
      });
      const file = join(mkdtempSync(join(tmpdir(), 'montage-parity-')), 'noise.mov');
      writeFileSync(file, Buffer.from(b64, 'base64'));
      return file;
    };
    const noiseAt = (file, time) => {
      const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'crop=200:120:220:120', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 64 * 1024 * 1024 });
      let sum = 0;
      let squares = 0;
      for (const v of raw) {
        sum += v;
        squares += v * v;
      }
      return Math.sqrt(squares / raw.length - (sum / raw.length) ** 2);
    };
    await editor.run(() => montage.batch(() => {
      montage.clear();
      montage.colorScience('display');
    }));
    await editor.import([fixture('noisy.mov')], 3);
    await editor.run(() => montage.batch(() => {
      montage.clear();
      montage.add(montage.assets().find((a) => a.name === 'noisy.mov').id);
    }));
    const plain = noiseAt(await exportFile(), 1.02);
    await editor.run(() => {
      const t = montage.graph.add(0, 'temporal-denoise', { strength: 0.8, motion: 0.3 });
      montage.graph.connect(0, 'source', t);
      montage.graph.connect(0, t, 'output');
    });
    const cleaned = noiseAt(await exportFile(), 1.02);
    checks.check(cleaned < plain * 0.7, `temporal noise reduction works in export, where frames render in order (${plain.toFixed(1)} → ${cleaned.toFixed(1)})`);
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
