import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFrame } from './prores-frame.mjs';

const BLOCK = 2;
const RING = BLOCK + 1;
const SIDE = 2 * RING + 1;
const luma = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];

export async function exportProres(editor, height) {
  const b64 = await editor.run(async (h) => {
    const res = await montage.render({ prores: 'hq', height: h });
    const bytes = new Uint8Array(await res.file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }, height);
  const path = join(mkdtempSync(join(tmpdir(), 'montage-parity-')), 'export.mov');
  writeFileSync(path, Buffer.from(b64, 'base64'));
  return path;
}

export async function compareWithExport(editor, path, size, fps, probes) {
  let worst = 0;
  const notes = [];
  for (const { time, points } of probes) {
    const frame = Math.round(time * fps);
    const pixel = decodeFrame(path, frame, size.width, size.height);
    const centers = points.map(({ x, y }) => [Math.min(size.width - 1 - RING, Math.max(RING, Math.floor((x + 0.5) * size.width))), Math.min(size.height - 1 - RING, Math.max(RING, Math.floor((y + 0.5) * size.height)))]);
    const grid = centers.flatMap(([px, py]) => {
      const cells = [];
      for (let dy = -RING; dy <= RING; dy++) for (let dx = -RING; dx <= RING; dx++) cells.push({ x: (px + dx + 0.5) / size.width - 0.5, y: (py + dy + 0.5) / size.height - 0.5 });
      return cells;
    });
    const preview = await editor.run(({ grid, t }) => montage.sample(grid, t), { grid, t: frame / fps });
    centers.forEach(([px, py], i) => {
      const cells = preview.slice(i * SIDE * SIDE, (i + 1) * SIDE * SIDE).map((v) => v.slice(0, 3).map((c) => Math.min(1, Math.max(0, c))));
      const inner = cells.filter((_, j) => Math.abs((j % SIDE) - RING) <= BLOCK && Math.abs(Math.floor(j / SIDE) - RING) <= BLOCK);
      const pmean = [0, 1, 2].map((c) => inner.reduce((s, v) => s + v[c], 0) / inner.length);
      const emean = [0, 0, 0];
      for (let dy = -BLOCK; dy <= BLOCK; dy++) for (let dx = -BLOCK; dx <= BLOCK; dx++) pixel(px + dx, py + dy).forEach((v, c) => (emean[c] += v / inner.length));
      const flat = [0, 1, 2].every((c) => Math.max(...cells.map((v) => v[c])) - Math.min(...cells.map((v) => v[c])) <= 0.02);
      const d = Math.max(Math.abs(luma(emean) - luma(pmean)), flat ? Math.max(...emean.map((v, c) => Math.abs(v - pmean[c]))) * (2 / 3) : 0);
      if (d > 0.02) notes.push(`t=${(frame / fps).toFixed(2)} (${points[i].x},${points[i].y}) preview ${pmean.map((v) => v.toFixed(3))} export ${emean.map((v) => v.toFixed(3))}`);
      worst = Math.max(worst, d);
    });
  }
  return { worst, notes };
}

export async function sampleProbes(editor, probes) {
  const out = [];
  for (const { time, points } of probes)
    out.push(
      await editor.run(async ({ time, points }) => {
        for (let i = 0; i < 30; i++) {
          try {
            return await montage.sample(points, time);
          } catch {
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        return montage.sample(points, time);
      }, { time, points }),
    );
  return out;
}

export const maxDifference = (a, b) => Math.max(...a.map((probe, k) => Math.max(...probe.map((p, i) => Math.max(...p.slice(0, 3).map((v, c) => Math.abs(Math.min(1, Math.max(0, v)) - Math.min(1, Math.max(0, b[k][i][c])))))))));
