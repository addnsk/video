import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Editor, fixture } from '../harness.mjs';

const integrated = (editor) => editor.run(async () => (await montage.loudness()).integrated);

const ffmpegLoudness = (path, upmix = false) => {
  const filter = `${upmix ? 'pan=stereo|c0=c0|c1=c0,' : ''}ebur128=peak=true`;
  const log = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-vn', '-af', filter, '-f', 'null', '-']).stderr.toString();
  const summary = log.slice(log.lastIndexOf('Summary:'));
  return { integrated: Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]), truePeak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]) };
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
    await editor.run(() => montage.seek(0));
    await editor.run(() => montage.play());
    await editor.settle(3500);
    const live = await editor.run(() => montage.liveLoudness());
    const shown = await editor.page.textContent('#loudness-live');
    await editor.run(() => montage.pause());
    checks.near(live?.shortTerm ?? 0, dry, 0.5, `the live meter reads the playing mix (${live?.shortTerm?.toFixed(2)} LUFS)`);
    checks.check(/LUFS/.test(shown ?? ''), `the transport shows live loudness (${shown})`);

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

    await editor.run(() => montage.mixer.set('v1', { volume: 12 }));
    const pushed = await editor.run(() => montage.normalize({ integrated: 0, peak: -1 }));
    const loud = await editor.run(() => montage.loudness());
    checks.check(pushed.limiter && pushed.before.truePeak + pushed.gain > 0, `normalizing far up needs the limiter (peaks would reach ${(pushed.before.truePeak + pushed.gain).toFixed(1)} dBTP)`);
    checks.check(loud.peak <= -0.95, `the limiter holds the -1 dBFS ceiling (peak ${loud.peak.toFixed(2)})`);
    checks.check(loud.truePeak <= -0.9, `the look-ahead limiter holds the true peak too (${loud.truePeak.toFixed(2)} dBTP)`);
    const limited = await editor.run(async () => {
      const r = await montage.render({ height: 360, prores: 'proxy' });
      const bytes = new Uint8Array(await r.file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    });
    const limitedPath = join(mkdtempSync(join(tmpdir(), 'montage-mixer-')), 'limited.mov');
    writeFileSync(limitedPath, Buffer.from(limited, 'base64'));
    const limitedReference = ffmpegLoudness(limitedPath);
    checks.check(limitedReference.truePeak <= -0.8 && limitedReference.truePeak > -2, `ffmpeg's true-peak meter agrees on the export (${limitedReference.truePeak} dBTP)`);

    await editor.run(() => montage.mixer.set('v1', { volume: 0 }));
    await editor.run(() => montage.normalize('youtube'));
    const youtube = await editor.run(() => montage.loudness());
    checks.check(youtube.integrated > -14.6 && youtube.integrated < -13.4, `normalizing back down lands near the -14 LUFS target (${youtube.integrated.toFixed(2)})`);
    await editor.run(() => {
      montage.mixer.set('master', { volume: 0, trim: 0 });
      montage.mixer.effect('master', 'limiter', null);
    });
    const plain = await integrated(editor);
    const reverb = await editor.run(() => {
      const id = montage.mixer.addBus('Reverb');
      montage.mixer.effect(id, 'reverb', { size: 0.8, mix: 100 });
      montage.mixer.send('v1', id, 0);
      return id;
    });
    const wet = await integrated(editor);
    checks.check(wet > plain + 0.5, `a send to a reverb bus adds to the mix (${plain.toFixed(2)} → ${wet.toFixed(2)} LUFS)`);
    const tailed = await editor.run(async () => {
      const r = await montage.render({ height: 360, prores: 'proxy' });
      const bytes = new Uint8Array(await r.file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    });
    const tailPath = join(mkdtempSync(join(tmpdir(), 'montage-mixer-')), 'tail.mov');
    writeFileSync(tailPath, Buffer.from(tailed, 'base64'));
    const streams = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'json', tailPath]).stdout.toString()).streams;
    const videoLength = Number(streams.find((x) => x.codec_type === 'video').duration);
    const audioLength = Number(streams.find((x) => x.codec_type === 'audio').duration);
    checks.check(audioLength > videoLength + 1 && audioLength < videoLength + 8, `the reverb tail rings out past the last frame in the export (video ${videoLength}s, audio ${audioLength}s)`);
    const group = await editor.run(() => montage.mixer.addBus('Group'));
    await editor.run(({ reverb, group }) => montage.mixer.route(reverb, group), { reverb, group });
    checks.near(await integrated(editor), wet, 0.1, 'routing the reverb bus through a group bus keeps the level');
    let loop = null;
    await editor.run(({ reverb, group }) => montage.mixer.route(group, reverb), { reverb, group }).catch((e) => (loop = e.message));
    checks.check(/loop/.test(loop ?? ''), 'a bus routing loop is refused');
    await editor.run(({ reverb, group }) => {
      montage.mixer.removeBus(reverb);
      montage.mixer.removeBus(group);
    }, { reverb, group });

    await editor.run(() => montage.mixer.effect('v1', 'eq', { low: 6 }));
    await editor.page.click('#mixer summary');
    await editor.page.click('#mixer-add-bus');
    checks.check((await editor.page.$$('.mixer-strip.bus')).length === 1, 'the add bus button creates a strip');
    const busId = await editor.run(() => montage.mixer.state().buses[0].id);
    await editor.page.fill(`#mixer-v1-send-${busId}`, '-6');
    await editor.page.dispatchEvent(`#mixer-v1-send-${busId}`, 'input');
    const sent = await editor.run(() => montage.mixer.state().tracks.find((t) => t.id === 'v1').sends);
    checks.check(sent.length === 1 && sent[0].level === -6, `the send slider creates a send (${JSON.stringify(sent)})`);
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
