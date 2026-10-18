import { Editor, fixture } from '../harness.mjs';

export default {
  name: 'proxies',
  tags: ['media'],
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('testsrc.mov')]);
    const id = await editor.run(() => montage.assets()[0].id);
    await editor.run((id) => montage.proxy(id), id);
    await editor.until((id) => ['ready', 'failed'].includes(montage.proxies()[id]?.state), id, 120000);
    const state = await editor.run((id) => montage.proxies()[id].state, id);
    checks.check(state === 'ready', `proxy builds (${state})`);

    const stored = await editor.run(async () => {
      const root = await navigator.storage.getDirectory();
      const names = [];
      const walk = async (dir) => {
        for await (const [name, handle] of dir.entries()) {
          if (handle.kind === 'directory') await walk(handle);
          else names.push([name, (await handle.getFile()).size]);
        }
      };
      await walk(root);
      return names;
    });
    checks.check(stored.some(([, size]) => size > 1000), `proxy stored in OPFS (${stored.map(([n, s]) => `${n}:${s}`).join(', ')})`);

    const [r, g, b] = await editor.previewColorAt(1.2);
    checks.check(r + g + b > 60, 'proxy playback renders frames');
    await editor.run(() => montage.play());
    await editor.settle(2000);
    const time = await editor.run(() => montage.time);
    await editor.run(() => montage.pause());
    checks.check(time > 1.5, `playback runs on the proxy (${time.toFixed(2)} s)`);
    await editor.settle(1000);
    const s = await editor.stats();
    checks.check((s.resources.videoSample?.live ?? 0) === 0, 'no decoded frames held after proxy playback');
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
