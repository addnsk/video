import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Editor, fixture } from '../harness.mjs';

const POINTS = [{ x: -0.35, y: -0.3 }, { x: 0, y: 0 }, { x: 0.25, y: 0.2 }, { x: -0.2, y: 0.35 }];
const TIMES = [0.5, 1.22, 3.02];

function exportedPixels(path, time, width, height) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb48le', '-'], { maxBuffer: 256 * 1024 * 1024 });
  return POINTS.map(({ x, y }) => {
    const px = Math.min(width - 1, Math.floor((x + 0.5) * width));
    const py = Math.min(height - 1, Math.floor((y + 0.5) * height));
    const i = (py * width + px) * 6;
    return [0, 1, 2].map((c) => raw.readUInt16LE(i + c * 2) / 65535);
  });
}

export default {
  name: 'export-parity',
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
    const preview = [];
    for (const t of TIMES) preview.push(await editor.run(({ t, p }) => montage.sample(p, t), { t, p: POINTS }));
    const settings = await editor.run(() => montage.project().settings);
    const data = await editor.run(async () => {
      const r = await montage.render({ prores: 'hq' });
      const bytes = new Uint8Array(await r.file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    });
    const path = join(mkdtempSync(join(tmpdir(), 'montage-parity-')), 'parity.mov');
    writeFileSync(path, Buffer.from(data, 'base64'));
    const mismatches = [];
    let worst = 0;
    TIMES.forEach((t, k) => {
      const exported = exportedPixels(path, t, settings.width, settings.height);
      exported.forEach((rgb, i) => {
        const diff = Math.max(...rgb.map((v, c) => Math.abs(v - Math.min(1, Math.max(0, preview[k][i][c])))));
        worst = Math.max(worst, diff);
        if (diff > 0.025) mismatches.push(`t=${t} p${i}: preview ${preview[k][i].slice(0, 3).map((v) => v.toFixed(3))} export ${rgb.map((v) => v.toFixed(3))}`);
      });
    });
    checks.check(!mismatches.length, `exported ProRes matches the preview with ACES, masks, an animated text node, transforms and a dissolve (worst ${worst.toFixed(4)}${mismatches.length ? `; ${mismatches.slice(0, 4).join('; ')}` : ''})`);
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
