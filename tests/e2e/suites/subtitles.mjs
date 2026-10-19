import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Editor, fixture } from '../harness.mjs';
import { exportProres } from '../lib/parity.mjs';

const SRT = '1\n00:00:00,400 --> 00:00:01,200\nFirst line\n\n2\n00:00:01,600 --> 00:00:02,400\nSecond\nsubtitle\n';

const pixel = (path, time, x, y) => [...execFileSync('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', path, '-frames:v', '1', '-vf', `crop=4:4:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).subarray(0, 3)];

export default {
  name: 'subtitles',
  tags: ['edit', 'export'],
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    const { page } = editor;
    await editor.import([fixture('red.mov')]);
    const dir = mkdtempSync(join(tmpdir(), 'montage-subs-'));
    const srt = join(dir, 'Dialog EN.srt');
    writeFileSync(srt, SRT);

    await editor.pick('#subtitle-import', [srt]);
    await editor.until(() => montage.subtitles.tracks().length === 1);
    const [track] = await editor.run(() => montage.subtitles.tracks());
    checks.check(track.name === 'Dialog EN' && track.count === 2 && !track.burnIn, `the panel imports an SRT file as a subtitle track (${JSON.stringify(track)})`);
    checks.check((await page.locator('#subtitles [data-cue]').count()) === 2, 'the panel lists the subtitles');

    await editor.run(() => montage.seek(0.8));
    await editor.frame();
    const overlay = await page.locator('#timeline-screen .subtitle-overlay:not([hidden])').innerText().catch(() => '');
    checks.check(overlay.trim() === 'First line', `the viewer shows the current subtitle (${JSON.stringify(overlay)})`);
    const clean = await editor.run(() => montage.sample({ x: 0, y: 0.38 }, 0.8));
    checks.check(clean[0] > 0.8 && clean[1] < 0.2, `subtitles that are only shown stay out of the rendered picture (${clean.map((v) => v.toFixed(2))})`);

    await editor.run((id) => montage.subtitles.style(id, { size: 0.1, background: '#000000ff', position: 0.05 }), track.id);
    await page.check('#subtitle-burn');
    await editor.until(() => montage.subtitles.tracks()[0].burnIn);
    await editor.frame();
    checks.check(await page.locator('#timeline-screen .subtitle-overlay').evaluate((el) => el.hidden), 'burned-in subtitles are drawn by the engine, not the overlay');
    const burned = await editor.run(() => montage.sample({ x: 0, y: 0.38 }, 0.8));
    const after = await editor.run(() => montage.sample({ x: 0, y: 0.38 }, 1.4));
    checks.check(burned[0] < 0.3 && after[0] > 0.8, `the subtitle box is burned into the frame while the subtitle is on (${burned.map((v) => v.toFixed(2))} then ${after.map((v) => v.toFixed(2))})`);

    await page.locator('#subtitles [data-cue] textarea').first().fill('Edited');
    await page.locator('#subtitles [data-cue] textarea').first().dispatchEvent('change');
    checks.check((await editor.run(() => montage.subtitles.cues()[0].text)) === 'Edited', 'subtitle text is edited in the panel');
    const exported = await editor.run(() => montage.subtitles.export(undefined, 'srt'));
    checks.check(exported.startsWith('1\n00:00:00,400 --> 00:00:01,200\nEdited\n'), 'the track exports back to SRT');

    const size = await editor.run(async () => (await montage.stats()).previewSize);
    const path = await exportProres(editor, 360, 2);
    const width = Math.round((360 * size.width) / size.height / 2) * 2;
    const on = pixel(path, 0.8, width / 2 - 2, 360 - 0.08 * 360);
    const off = pixel(path, 1.4, width / 2 - 2, 360 - 0.08 * 360);
    checks.check(on[0] < 80 && off[0] > 180, `the export carries the burned-in subtitles at the right time (${on} then ${off})`);
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
