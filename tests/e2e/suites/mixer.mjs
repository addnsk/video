import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Editor, fixture } from '../harness.mjs';

const integrated = (editor) => editor.run(async () => (await montage.loudness()).integrated);

const ffmpegLoudness = (path, upmix = false) => {
  const filter = `${upmix ? 'pan=stereo|c0=c0|c1=c0,' : ''}ebur128=peak=sample`;
  const log = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-vn', '-af', filter, '-f', 'null', '-']).stderr.toString();
  const summary = log.slice(log.lastIndexOf('Summary:'));
  return { integrated: Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]), peak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]) };
};

const levelsWhilePlaying = async (editor) => {
  await editor.run(() => montage.seek(0.2));
  await editor.run(() => montage.play());
  await editor.settle(400);
  const peak = [0, 0];
  for (let i = 0; i < 8; i++) {
    const levels = await editor.run(() => montage.levels());
    peak[0] = Math.max(peak[0], levels[0]);
    peak[1] = Math.max(peak[1], levels[1]);
    await editor.settle(100);
  }
  await editor.run(() => montage.pause());
  return peak;
};

export default {
  name: 'mixer',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('bars.mov')]);
    const dry = await integrated(editor);
    const source = ffmpegLoudness(fixture('bars.mov'), true);
    checks.near(dry, source.integrated, 0.15, `the loudness meter agrees with ffmpeg's EBU R128 meter on the source (${dry.toFixed(2)} vs ${source.integrated} LUFS)`);

    await editor.run(() => montage.mixer.set('master', { volume: -6 }));
    checks.near(await integrated(editor), dry - 6, 0.1, 'master volume moves the loudness by its dB');
    await editor.run(() => {
      montage.mixer.set('master', { volume: 0 });
      montage.mixer.set('v1', { volume: -10 });
    });
    checks.near(await integrated(editor), dry - 10, 0.1, 'track volume moves the loudness by its dB');

    const bus = await editor.run(() => {
      const id = montage.mixer.addBus('Dialogue');
      montage.mixer.route('v1', id);
      montage.mixer.set(id, { volume: -4 });
      return id;
    });
    checks.near(await integrated(editor), dry - 14, 0.1, 'a bus adds its own gain after the track');
    await editor.run((id) => montage.mixer.set(id, { mute: true }), bus);
    checks.check((await integrated(editor)) === null || !Number.isFinite(await integrated(editor)), 'a muted bus silences the tracks routed to it');
    await editor.run((id) => montage.mixer.removeBus(id), bus);
    checks.check((await editor.run(() => montage.mixer.state().tracks.find((t) => t.id === 'v1').output)) === 'master', 'removing a bus sends its tracks back to the master');

    await editor.run(() => montage.mixer.set('v1', { volume: 0, pan: -1 }));
    const [left, right] = await levelsWhilePlaying(editor);
    checks.check(left > 0.05 && right < left * 0.05, `hard left pan silences the right channel (L ${left.toFixed(3)}, R ${right.toFixed(3)})`);
    await editor.run(() => montage.mixer.set('v1', { pan: 0 }));

    await editor.run(() => {
      montage.mixer.keyframe('master', 'volume', 0, 0);
      montage.mixer.keyframe('master', 'volume', 1, -20);
    });
    const automated = await editor.run(async () => (await montage.loudness()).shortTerm);
    checks.check(automated < dry - 15, `master volume automation reaches the end of the mix (short-term ${automated.toFixed(1)})`);
    await editor.run(() => montage.mixer.clearKeyframe('master', 'volume'));

    const result = await editor.run(() => montage.normalize('ebu'));
    checks.near(result.gain, -23 - dry, 0.15, `normalize moves the master by the measured difference (${result.gain.toFixed(2)} dB)`);
    checks.near(await integrated(editor), -23, 0.2, 'after normalizing the project measures -23 LUFS');

    const exported = await editor.run(async () => {
      const r = await montage.render({ height: 360, prores: 'proxy' });
      const bytes = new Uint8Array(await r.file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    });
    const path = join(mkdtempSync(join(tmpdir(), 'montage-mixer-')), 'mix.mov');
    writeFileSync(path, Buffer.from(exported, 'base64'));
    const reference = ffmpegLoudness(path);
    checks.near(reference.integrated, -23, 0.5, `ffmpeg's EBU R128 meter agrees on the export (${reference.integrated} LUFS)`);

    await editor.run(() => montage.mixer.set('master', { volume: 20 }));
    await editor.run(() => montage.normalize('youtube'));
    const loud = await editor.run(() => montage.loudness());
    checks.check(loud.peak <= -0.95, `normalizing up adds a limiter that holds the -1 dBFS ceiling (peak ${loud.peak.toFixed(2)})`);
    checks.check(loud.integrated > -15.5 && loud.integrated < -13.5, `and lands near the -14 LUFS target (${loud.integrated.toFixed(2)})`);

    await editor.run(() => montage.mixer.effect('v1', 'eq', { low: 6 }));
    await editor.page.click('#mixer summary');
    await editor.page.click('#mixer-add-bus');
    checks.check((await editor.page.$$('.mixer-strip.bus')).length === 1, 'the add bus button creates a strip');
    await editor.page.click('#mixer-v1-edit');
    await editor.page.click('#strip-eq summary');
    const low = await editor.page.textContent('#strip-eq output');
    checks.check(low === '6', `the strip effect editor shows the track's effects (${low})`);
    await editor.page.fill('#mixer-v1-volume', '-12');
    await editor.page.dispatchEvent('#mixer-v1-volume', 'input');
    checks.check((await editor.run(() => montage.mixer.state().tracks.find((t) => t.id === 'v1').volume)) === -12, 'the fader writes the track volume');
    await editor.page.click('#loudness-measure');
    await editor.page.waitForFunction(() => /LUFS/.test(document.querySelector('#loudness-reading')?.textContent ?? ''), null, { timeout: 30000 });
    checks.check(true, 'the panel shows a loudness reading');
    await editor.run(() => montage.undo());
    checks.check((await editor.run(() => montage.mixer.state().tracks.find((t) => t.id === 'v1').volume)) === 0, 'undo restores the fader');

    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
