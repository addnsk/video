import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Editor, fixture } from '../harness.mjs';

const probe = (path) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration', '-of', 'json', path]).toString());
const centre = (path, width, height) => [...execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.3', '-i', path, '-frames:v', '1', '-vf', `crop=4:4:${width / 2 - 2}:${height / 2 - 2}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).subarray(0, 3)];

export default {
  name: 'render-queue',
  tags: ['export'],
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    const { page } = editor;
    await editor.import([fixture('red.mov'), fixture('blue.mov')]);
    const { main, vertical } = await editor.run(() => {
      const [red, blue] = montage.assets();
      for (const c of montage.clips()) montage.remove(c.id);
      montage.edit.append({ asset: red.id, in: 0, out: 1 });
      const main = montage.timelines.active().id;
      const vertical = montage.timelines.create('Vertical', { width: 360, height: 640 });
      montage.edit.append({ asset: blue.id, in: 0, out: 0.8 });
      montage.timelines.open(main);
      return { main, vertical };
    });

    await page.click('#queue-open');
    await page.check(`#queue-timelines input[value="${vertical}"]`);
    await page.check('#queue-presets input[value="review"]');
    await page.click('#queue-add');
    checks.check((await page.locator('#queue-list [data-job]').count()) === 4, 'two timelines times two outputs make four jobs');
    await page.click(`#queue-list [data-job]:nth-child(4) [data-remove]`);
    await page.click('#queue-start');
    await page.waitForFunction(() => document.querySelectorAll('#queue-list [data-status="done"]').length === 3, null, { timeout: 120000 });
    checks.check((await page.locator('#queue-list [data-save]').count()) === 3, 'every finished job offers its file');

    const jobs = await editor.run(() => montage.queue.list());
    const dir = mkdtempSync(join(tmpdir(), 'montage-queue-'));
    const files = [];
    for (const job of jobs) {
      const data = await editor.run(async (id) => {
        const bytes = new Uint8Array(await montage.queue.file(id).arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(binary);
      }, job.id);
      const path = join(dir, job.name);
      writeFileSync(path, Buffer.from(data, 'base64'));
      files.push({ job, path, info: probe(path) });
    }
    const [master, review, verticalMaster] = files;
    const video = (f) => f.info.streams.find((s) => s.codec_type === 'video');
    checks.check(master.job.timeline === main && video(master).codec_name === 'prores' && video(master).width === 640 && video(master).height === 360, `the master is ProRes at the timeline size (${video(master).codec_name} ${video(master).width}×${video(master).height})`);
    checks.check(video(review).codec_name !== 'prores' && review.path.endsWith('.mp4') && video(review).height === 360, `the review copy is an MP4 that never upscales past the timeline (${video(review).codec_name} ${video(review).height})`);
    checks.check(verticalMaster.job.timeline === vertical && video(verticalMaster).width === 360 && video(verticalMaster).height === 640, `the second timeline renders in its own frame size (${video(verticalMaster).width}×${video(verticalMaster).height})`);
    checks.near(Number(verticalMaster.info.format.duration), 0.8, 0.08, 'the second timeline renders its own length');
    const red = centre(master.path, 640, 360);
    const blue = centre(verticalMaster.path, 360, 640);
    checks.check(red[0] > 180 && red[2] < 80 && blue[2] > 180 && blue[0] < 80, `each output shows its own timeline (red ${red}, blue ${blue})`);
    checks.check((await editor.run(() => montage.timelines.active().id)) === main, 'rendering does not switch the open timeline');
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
