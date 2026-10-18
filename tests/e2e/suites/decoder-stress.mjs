import { Editor, fixture } from '../harness.mjs';

const MINUTES = Number(process.env.STRESS_MINUTES ?? 0);

export default {
  name: 'decoder-stress',
  tags: ['media'],
  async run({ browser, url, checks }) {
    const deadline = Date.now() + MINUTES * 60000;
    let rounds = 0;
    const errors = [];
    do {
      const editor = await Editor.open(browser, url);
      await editor.import([fixture('red.mov'), fixture('blue.mov'), fixture('gray.mov'), fixture('moving.mov'), fixture('prores-1080-10s.mov'), fixture('music.wav')]);
      await editor.run(async () => {
        const assets = montage.assets().filter((a) => a.hasVideo);
        await montage.batch(() => {
          const overlay = montage.addTrack('video');
          for (let i = 0; i < 12; i++) montage.add(assets[i % assets.length].id, { track: overlay, start: i * 0.7, in: 0, out: 0.6 });
        });
        const tracking = montage.track(3, { x: -0.27, y: 0 }).catch(() => null);
        const grabs = [montage.stills.grab().catch(() => null), montage.stills.grab().catch(() => null)];
        for (let k = 0; k < 60; k++) {
          montage.seek(Math.random() * montage.duration);
          if (k % 7 === 0) montage.play(k % 14 === 0 ? 1 : -2);
          if (k % 7 === 3) montage.pause();
          if (k % 20 === 0) montage.renderCache(k % 40 === 0);
          await new Promise((r) => setTimeout(r, 25 + Math.random() * 60));
        }
        montage.pause();
        await Promise.all([tracking, ...grabs]);
      });
      await editor.settle(1500);
      const stats = await editor.stats();
      if ((stats.resources.videoSample?.live ?? 0) !== 0) errors.push(`round ${rounds}: ${stats.resources.videoSample.live} decoded frames held`);
      errors.push(...editor.errors.map((e) => `round ${rounds}: ${e}`));
      await editor.close();
      rounds++;
    } while (Date.now() < deadline);
    checks.check(!errors.length, `concurrent decoding of six files with thumbnails, stills, tracking, seeking and shuttling stays clean (${rounds} rounds${errors.length ? `; ${errors.slice(0, 3).join('; ')}` : ''})`);
  },
};
