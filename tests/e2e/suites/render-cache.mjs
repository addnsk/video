import { Editor, fixture } from '../harness.mjs';

const fmt = (c) => c.map((v) => v.toFixed(0)).join(',');

export default {
  name: 'render-cache',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('prores-1080-10s.mov')]);
    await editor.run(() => {
      let last = 'source';
      for (let i = 0; i < 5; i++) {
        const blur = montage.graph.add(0, 'blur', { radius: 6 });
        montage.graph.connect(0, last, blur);
        last = blur;
      }
      montage.graph.connect(0, last, 'output');
      montage.resetMetrics();
    });
    const first = await editor.previewColorAt(2, { x: 0.3, y: 0.4, size: 0.05 });
    await editor.previewColorAt(3, { x: 0.3, y: 0.4, size: 0.05 });
    const again = await editor.previewColorAt(2, { x: 0.3, y: 0.4, size: 0.05 });
    const stats = await editor.run(async () => {
      const s = await montage.stats();
      return { cache: s.renderCache, counters: s.metrics.counters ?? s.metrics };
    });
    const counters = JSON.stringify(stats.counters);
    checks.check(stats.cache && stats.cache.memory >= 2, `heavy frames are kept in the render cache (${JSON.stringify(stats.cache)})`);
    checks.check(counters.includes('renderCache.hit.memory'), 'returning to a frame is served from the cache');
    checks.check(first.every((v, i) => Math.abs(v - again[i]) <= 2), `cached frame matches the rendered one (${fmt(first)} vs ${fmt(again)})`);

    const hits = async () => {
      const s = await editor.run(async () => (await montage.stats()).metrics);
      const text = JSON.stringify(s);
      const match = (name) => Number(text.match(new RegExp(`"${name}":\\{?"?(?:count"?:)?(\\d+)`))?.[1] ?? 0);
      return { memory: match('renderCache.hit.memory'), disk: match('renderCache.hit.disk') };
    };
    const before = await editor.run(async () => (await montage.stats()).renderCache.memory);
    await editor.run(() => {
      montage.graph.set(0, montage.graph.get(0).nodes.find((n) => n.type === 'blur').id, { radius: 2 });
    });
    await editor.previewColorAt(2, { x: 0.3, y: 0.4, size: 0.05 });
    const after = await editor.run(async () => (await montage.stats()).renderCache.memory);
    checks.check(after === before + 1, `an edit renders and caches a new frame instead of reusing the old one (${before} → ${after})`);

    await editor.run(() => montage.renderCache({ memoryBytes: 2.5e6 }));
    await editor.previewColorAt(4, { x: 0.3, y: 0.4, size: 0.05 });
    await editor.previewColorAt(5, { x: 0.3, y: 0.4, size: 0.05 });
    await editor.settle(1500);
    await editor.run(() => montage.resetMetrics());
    const fromDisk = await editor.previewColorAt(4, { x: 0.3, y: 0.4, size: 0.05 });
    const diskStats = await editor.run(async () => (await montage.stats()).renderCache);
    checks.check((await hits()).disk >= 1, `evicted frames spill to disk and come back (${JSON.stringify(diskStats)}, ${fmt(fromDisk)})`);

    await editor.run(() => montage.renderCache(false));
    const off = await editor.run(async () => (await montage.stats()).renderCache);
    checks.check(off.memory === 0, 'disabling the cache empties it');
    await editor.close();
  },
};
