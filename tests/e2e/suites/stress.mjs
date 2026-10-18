import { Editor, fixture } from '../harness.mjs';

async function stress(browser, url, checks, inline) {
  const tag = inline ? 'inline' : 'worker';
  const editor = await Editor.open(browser, url, { inline });
  await editor.import([fixture('testsrc.mov')]);
  await editor.run(async () => {
    const asset = montage.assets()[0];
    await montage.batch(() => {
      montage.clear();
      for (let i = 0; i < 150; i++) {
        const start = (i * 0.37) % 3.4;
        montage.add(asset.id, { in: start, out: start + 0.6 });
      }
      for (const c of montage.clips().slice(1)) montage.transition(c.id, { type: 'dissolve', duration: 0.2 });
    });
  });
  checks.check((await editor.run(() => montage.clips().length)) === 150, `${tag}: 150 clips on the timeline`);

  await editor.run(async () => {
    for (let i = 0; i < 300; i++) {
      montage.seek(Math.random() * montage.duration);
      await new Promise((r) => setTimeout(r, 5));
    }
  });
  await editor.settle(4000);
  let s = await editor.stats();
  checks.check(s.frameCacheBytes <= s.budget.frameCacheBytes, `${tag}: frame cache within budget (${(s.frameCacheBytes / 1048576).toFixed(0)} MB)`);
  checks.check((s.resources.videoSample?.live ?? 0) === 0, `${tag}: no decoded frames held after seeking`);

  await editor.run(() => montage.seek(10));
  await editor.run(() => montage.play());
  await editor.settle(4000);
  const played = await editor.run(() => montage.time);
  await editor.run(() => montage.pause());
  checks.check(played > 12.5, `${tag}: playback advanced (${played.toFixed(2)} s)`);
  await editor.settle(1500);
  s = await editor.stats();
  checks.check((s.resources.videoSample?.live ?? 0) === 0, `${tag}: no decoded frames held after playback`);
  checks.check((s.resources.framebuffer?.live ?? 0) <= 8, `${tag}: render targets bounded (${s.resources.framebuffer?.live})`);

  await editor.run(() => montage.batch(() => {
    while (montage.clips().length > 12) montage.remove(-1);
  }));
  const size = await editor.run(async () => (await montage.render({ height: 360, quality: 'medium' })).file?.size ?? 0);
  checks.check(size > 10000, `${tag}: export produced a file (${size} bytes)`);
  s = await editor.stats();
  checks.check((s.resources.videoSample?.live ?? 0) === 0, `${tag}: no decoded frames held after export`);
  checks.check((s.resources.audioSample?.live ?? 0) === 0, `${tag}: no audio samples held after export`);
  checks.check(editor.errors.length === 0, `${tag}: no page errors ${editor.errors.join('; ')}`);
  await editor.close();
}

export default {
  name: 'stress',
  tags: ['media'],
  exclusive: true,
  async run({ browser, url, checks }) {
    await stress(browser, url, checks, false);
    await stress(browser, url, checks, true);
  },
};
