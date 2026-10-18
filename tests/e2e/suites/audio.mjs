import { Editor, fixture } from '../harness.mjs';

const playFor = async (editor, ms) => {
  await editor.run(() => montage.seek(0.2));
  await editor.run(() => montage.play());
  await editor.settle(300);
  let peak = 0;
  for (let i = 0; i < ms / 100; i++) {
    peak = Math.max(peak, ...(await editor.run(() => montage.levels())));
    await editor.settle(100);
  }
  await editor.run(() => montage.pause());
  return peak;
};

export default {
  name: 'audio',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('bars.mov')]);

    const dry = await playFor(editor, 1200);
    checks.check(dry > 0.05, `playback reaches the output bus (peak ${dry.toFixed(3)})`);
    const lit = await editor.run(() => {
      const canvas = document.querySelector('#meter');
      return canvas.width > 0;
    });
    checks.check(lit, 'level meter is mounted');

    await editor.run(() => montage.audioEffect(0, 'highpass', { cutoff: 1000 }));
    const cut = await playFor(editor, 1200);
    checks.check(cut < dry * 0.5, `low cut at 1 kHz attenuates a 220 Hz tone (${cut.toFixed(3)} vs ${dry.toFixed(3)})`);

    await editor.run(() => {
      montage.audioEffect(0, 'highpass', null);
      montage.audioEffect(0, 'eq', { low: 12, mid: 12 });
    });
    const boosted = await playFor(editor, 1200);
    checks.near(boosted / dry, 10 ** (2.15 / 20), 0.12, 'equalizer gives the designed +2.15 dB at 220 Hz for low and mid +12 dB');

    await editor.run(() => montage.select(0));
    await editor.page.click('#audio-eq summary');
    const value = await editor.page.textContent('#audio-eq output');
    checks.check(value === '12', `audio effect controls reflect the clip (${value})`);
    await editor.page.click('#audio-eq-reset');
    checks.check((await editor.run(() => montage.clip(0).effects.length)) === 0, 'reset removes the audio effect');

    let failed = null;
    await editor.run(() => montage.audioEffect(0, 'nope', {})).catch((e) => (failed = e.message));
    checks.check(/Unknown audio effect/.test(failed ?? ''), 'unknown audio effects are rejected');

    await editor.run(() => montage.audioEffect(0, 'compressor', { threshold: -30, ratio: 8 }));
    const size = await editor.run(async () => (await montage.render({ height: 360, quality: 'medium' })).file?.size ?? 0);
    checks.check(size > 5000, `export runs the audio chain (${size} bytes)`);
    const s = await editor.stats();
    checks.check((s.resources.audioSample?.live ?? 0) === 0, 'no audio samples held');
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
