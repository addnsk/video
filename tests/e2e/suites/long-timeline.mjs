import { Editor, fixture } from '../harness.mjs';

export default {
  name: 'long-timeline',
  tags: ['media'],
  exclusive: true,
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('prores-2160-4s.mov'), fixture('prores-1080-10s.mov')]);
    const duration = await editor.run(async () => {
      const [uhd, hd] = montage.assets();
      await montage.batch(() => {
        montage.clear();
        for (let i = 0; i < 60; i++) {
          const asset = i % 2 ? hd : uhd;
          montage.add(asset.id, { in: 0, out: Math.min(3.5, asset.end) });
        }
        const overlay = montage.addTrack('video');
        for (let i = 0; i < 20; i++) montage.add(hd.id, { in: 1, out: 4, track: overlay, start: i * 10 });
        for (const c of montage.clips().slice(1, 40)) montage.transition(c.id, { type: 'dissolve', duration: 0.3 });
      });
      return montage.duration;
    });
    checks.check(duration > 180, `long 4K timeline built (${duration.toFixed(0)} s, ${await editor.run(() => montage.clips().length)} clips on the main track)`);

    await editor.settle(3000);
    const peaks = [];
    for (const start of [5, 60, 120, 180]) {
      await editor.run((t) => {
        montage.seek(t);
        montage.play();
      }, start);
      await editor.settle(3000);
      const reached = await editor.run(() => montage.time);
      await editor.run(() => montage.pause());
      checks.check(reached > start + 0.25, `playback advances from ${start}s (${reached.toFixed(2)} s)`);
      const s = await editor.stats();
      peaks.push(s.memory?.bytes ?? 0);
      checks.check((s.memory?.bytes ?? 0) <= s.budget.memoryLimitBytes, `memory stays within the budget at ${start}s (${((s.memory?.bytes ?? 0) / 1048576).toFixed(0)} of ${(s.budget.memoryLimitBytes / 1048576).toFixed(0)} MB, ${s.memory?.level})`);
    }
    const s = await editor.stats();
    checks.check(s.frameCacheBytes <= s.budget.frameCacheBytes, `frame cache within budget (${(s.frameCacheBytes / 1048576).toFixed(0)} MB)`);
    checks.check((s.resources.decoder?.live ?? 0) <= s.budget.maxOpenSources * 2, `open decoders bounded (${s.resources.decoder?.live ?? 0})`);
    await editor.settle(1500);
    const after = await editor.stats();
    checks.check((after.resources.videoSample?.live ?? 0) === 0, 'no decoded frames held after playing across the timeline');
    checks.check(Math.max(...peaks) < after.budget.memoryLimitBytes, `peak tracked memory ${(Math.max(...peaks) / 1048576).toFixed(0)} MB`);
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
