import { mkdirSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Editor, fixture, launchBrowser, startServer } from '../e2e/harness.mjs';

const PROFILES = {
  desktop: null,
  phone: { memoryGb: 4, cores: 4, touch: true },
};

const SOURCES = [
  ...['prores-1080-10s.mov', 'prores-2160-4s.mov', 'vp9-1080-10s.webm'].map((name) => ({ name, path: () => fixture(name) })),
  ...(process.env.BENCH_MEDIA ?? '').split(',').filter(Boolean).map((path) => ({ name: basename(path), path: () => path })),
];

const args = process.argv.slice(2);
const names = args.filter((a) => !a.startsWith('--'));
const profiles = names.filter((n) => n in PROFILES);
const sources = names.filter((n) => !(n in PROFILES));
const quick = args.includes('--quick');

const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const timing = (m, name) => m.timings[name] ?? { count: 0, mean: 0, p95: 0, max: 0 };

async function heavyStack() {
  const [main] = montage.clips();
  montage.grade(0, { exposure: 0.3, contrast: 1.2, saturation: 1.1, lift: { x: 0.02 } });
  montage.effect(0, 'curves', { master: [0, 0, 0.5, 0.55, 1, 1] });
  const pip = montage.add(main.assetId, { track: 'v2', start: 0, in: 0, out: Math.min(4, main.duration) });
  montage.set(pip.id, { transform: { scale: 0.4, x: 0.25, y: -0.2 } });
  montage.grade(pip.id, { saturation: 0 });
  const title = montage.title('Benchmark', { start: 0, duration: main.duration, size: 0.08, background: '#000000b3' });
  montage.animate(title.id, 'whole', 'drift');
}

async function scenario(editor, name, fn) {
  await editor.run(() => montage.resetMetrics());
  const heapBefore = await editor.run(() => performance.memory?.usedJSHeapSize ?? 0);
  const started = Date.now();
  const extra = await fn();
  const stats = await editor.stats();
  const heapAfter = await editor.run(() => performance.memory?.usedJSHeapSize ?? 0);
  const peakBytes = Object.values(stats.resources).reduce((n, r) => n + r.bytes, 0);
  return { name, ms: Date.now() - started, metrics: stats.metrics, resources: stats.resources, peakBytes, heapMb: round((heapAfter - heapBefore) / 1048576), ...extra };
}

async function seekStorm(editor, count = 40) {
  return scenario(editor, 'seek', async () => {
    for (let i = 0; i < count; i++) {
      await editor.run(async () => {
        montage.seek(Math.random() * montage.duration);
        await new Promise((r) => setTimeout(r, 120));
      });
    }
    await editor.settle(800);
  });
}

async function playFor(editor, label, seconds) {
  return scenario(editor, label, async () => {
    await editor.run(() => montage.seek(0));
    await editor.run(() => montage.play());
    await editor.settle(seconds * 1000);
    const played = await editor.run(() => montage.time);
    await editor.run(() => montage.pause());
    await editor.settle(500);
    return { played: round(played, 2) };
  });
}

async function exportRun(editor, label, settings) {
  return scenario(editor, label, async () => {
    const t0 = Date.now();
    const size = await editor.run(async (s) => (await montage.render(s)).file?.size ?? 0, settings);
    const frames = await editor.run(() => Math.round(montage.duration * montage.fps));
    return { size, fps: round(frames / ((Date.now() - t0) / 1000), 2) };
  });
}

function summarize(profile, source, r) {
  const m = r.metrics;
  const row = { profile, source, scenario: r.name, seconds: round(r.ms / 1000) };
  if (r.name === 'seek') Object.assign(row, { seekMeanMs: round(timing(m, 'still.total').mean), seekP95Ms: round(timing(m, 'still.total').p95), stale: m.counters['still.stale'] ?? 0 });
  if (r.name.startsWith('play')) {
    const presented = m.counters['playback.presented'] ?? 0;
    const dropped = m.counters['playback.dropped'] ?? 0;
    Object.assign(row, { played: r.played, presented, dropped, dropPct: round((100 * dropped) / Math.max(1, presented + dropped)), loadP95Ms: round(timing(m, 'playback.load').p95), renderP95Ms: round(timing(m, 'playback.render').p95) });
  }
  if (r.name.startsWith('export')) Object.assign(row, { fps: r.fps, mb: round(r.size / 1048576), loadMs: round(timing(m, 'export.load').mean), renderMs: round(timing(m, 'export.render').mean), encodeMs: round(timing(m, 'export.encode').mean) });
  row.gpuMb = round(((r.resources.texture?.bytes ?? 0) + (r.resources.framebuffer?.bytes ?? 0)) / 1048576);
  row.decoders = r.resources.decoder?.peak ?? 0;
  row.heapMb = r.heapMb;
  return row;
}

const server = await startServer();
const browser = await launchBrowser();
const rows = [];
const raw = [];
try {
  for (const [profile, device] of Object.entries(PROFILES)) {
    if (profiles.length && !profiles.includes(profile)) continue;
    for (const { name: source, path } of SOURCES) {
      if (sources.length && !sources.includes(source)) continue;
      const editor = await Editor.open(browser, server.url, { device, viewport: device ? { width: 390, height: 844 } : undefined });
      await editor.import([path()]);
      await editor.until(() => montage.clips().length === 1, null, 60000);
      const results = [await seekStorm(editor), await playFor(editor, 'play', 5)];
      await editor.run(heavyStack);
      results.push(await playFor(editor, 'play-heavy', 5));
      if (!quick) {
        results.push(await exportRun(editor, 'export-mp4-720', { height: 720, quality: 'medium' }));
        results.push(await exportRun(editor, 'export-prores-hq', { prores: 'hq' }));
      }
      for (const r of results) {
        const row = summarize(profile, source, r);
        rows.push(row);
        raw.push({ profile, source, ...r });
        console.log(JSON.stringify(row));
      }
      if (editor.errors.length) console.log('page errors', editor.errors);
      await editor.close();
    }
  }
} finally {
  await browser.close();
  server.stop();
}
mkdirSync('bench-results', { recursive: true });
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const environment = { node: process.version, platform: process.platform, softwareGl: process.env.SOFTWARE_GL === '1', chrome: browser.version?.() };
writeFileSync(`bench-results/${stamp}.json`, JSON.stringify({ environment, rows, raw }, null, 2));
const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
const table = [`| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${columns.map((c) => r[c] ?? '').join(' | ')} |`)].join('\n');
writeFileSync(`bench-results/${stamp}.md`, `# Benchmark ${stamp}\n\n${JSON.stringify(environment)}\n\n${table}\n`);
console.log(`\n${table}\n\nSaved bench-results/${stamp}.json and .md`);
