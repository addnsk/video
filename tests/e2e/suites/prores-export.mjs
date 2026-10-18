import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Editor, fixture } from '../harness.mjs';

const probe = (path) =>
  JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,codec_tag_string,width,height,pix_fmt,sample_rate,color_primaries:format=duration', '-of', 'json', path]).toString());

export default {
  name: 'prores-export',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('red.mov'), fixture('bars.mov'), fixture('blue.mov')]);
    await editor.run(() => {
      montage.trim(1, { out: 1 });
      const blue = montage.clip(2);
      montage.remove(2);
      const pip = montage.add(blue.assetId, { track: 'v2', start: 0 });
      montage.set(pip.id, { transform: { scale: 0.3, y: 0.3 } });
    });
    const dir = mkdtempSync(join(tmpdir(), 'montage-prores-'));
    for (const profile of ['hq', 'proxy']) {
      const result = await editor.run(async (profile) => {
        const r = await montage.render({ height: 360, prores: profile });
        const bytes = new Uint8Array(await r.file.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { name: r.name, data: btoa(binary) };
      }, profile);
      const path = join(dir, `${profile}.mov`);
      writeFileSync(path, Buffer.from(result.data, 'base64'));
      checks.check(result.name.endsWith('.mov'), `${profile}: export is named .mov`);
      const info = probe(path);
      const video = info.streams.find((s) => s.codec_type === 'video');
      const audio = info.streams.find((s) => s.codec_type === 'audio');
      const tag = { hq: 'apch', proxy: 'apco' }[profile];
      checks.check(video?.codec_name === 'prores' && video.codec_tag_string === tag, `${profile}: ffprobe sees ProRes ${tag} (${video?.codec_name} ${video?.codec_tag_string})`);
      checks.check(video?.width === 640 && video?.height === 360 && video?.pix_fmt === 'yuv422p10le', `${profile}: 640×360 10-bit 4:2:2`);
      checks.check(/^pcm_s(24|16)/.test(audio?.codec_name ?? ''), `${profile}: PCM audio (${audio?.codec_name})`);
      checks.near(Number(info.format.duration), 3, 0.1, `${profile}: duration`);
      const decode = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
      checks.check(decode.trim() === '', `${profile}: ffmpeg decodes every frame without errors`);
      const red = execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', path, '-frames:v', '1', '-vf', 'crop=10:10:315:175', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      checks.check(red[0] > 200 && red[1] < 50 && red[2] < 50, `${profile}: picture content survives (${[...red.subarray(0, 3)]})`);
      const top = execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', path, '-frames:v', '1', '-vf', 'crop=10:10:315:60', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      const bottom = execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', path, '-frames:v', '1', '-vf', 'crop=10:10:315:280', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      checks.check(top[0] > 200 && bottom[2] > 200 && bottom[0] < 60, `${profile}: overlay at the bottom stays at the bottom (top ${[...top.subarray(0, 3)]}, bottom ${[...bottom.subarray(0, 3)]})`);
    }
    await editor.run(() => montage.clear());
    await editor.import([join(dir, 'hq.mov')], 4);
    await editor.until(() => montage.clips().length === 1);
    const reimported = await editor.run(() => montage.clips().map((c) => [c.name, +c.duration.toFixed(2)]));
    checks.check(reimported.length === 1 && reimported[0][0] === 'hq.mov' && reimported[0][1] === 3, `exported ProRes imports back (${JSON.stringify(reimported)})`);
    const [r, g, b] = await editor.previewColorAt(0.5, { x: 0.5, y: 0.2, size: 0.05 });
    checks.check(r > 200 && g < 50 && b < 50, 'reimported ProRes decodes in the editor');

    await editor.page.click('#export');
    await editor.page.selectOption('#export-format', 'hq');
    checks.check(await editor.page.isHidden('#export-quality'), 'dialog hides MP4 quality for ProRes');
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
