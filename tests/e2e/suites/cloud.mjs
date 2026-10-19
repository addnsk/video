import { Editor, fixture } from '../harness.mjs';
import { startS3 } from '../lib/s3-server.mjs';

const isRed = ([r, , b]) => r > 180 && b < 80;

export default {
  name: 'cloud',
  tags: ['media'],
  async run({ browser, url, checks }) {
    const s3 = await startS3();
    const editor = await Editor.open(browser, url);
    const { page } = editor;
    page.on('dialog', (d) => d.accept());
    await editor.import([fixture('red.mov'), fixture('testsrc.mov')]);
    await editor.run(() => {
      const [red, test] = montage.assets();
      for (const c of montage.clips()) montage.remove(c.id);
      montage.edit.append({ asset: red.id, in: 0, out: 1 });
      montage.edit.append({ asset: test.id, in: 0, out: 1 });
    });

    await page.click('#cloud-open');
    const fill = async (secret) => {
      await page.fill('#cloud-endpoint', s3.endpoint);
      await page.fill('#cloud-bucket', s3.bucket);
      await page.fill('#cloud-prefix', 'team');
      await page.fill('#cloud-key', s3.accessKeyId);
      await page.fill('#cloud-secret', secret);
      await page.click('#cloud-connect');
    };
    await fill('wrong');
    await page.waitForFunction(() => /SignatureDoesNotMatch/.test(document.querySelector('.modal')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => undefined);
    checks.check(s3.log.rejected > 0 && !(await editor.run(() => montage.remote.status().connected)), 'a wrong secret key is refused by the storage');
    await fill(s3.secretAccessKey);
    await editor.until(() => montage.remote.status().connected, undefined, 15000);
    checks.check(s3.log.rejected === 1, `requests signed with the right key are accepted (${s3.log.requests} requests)`);

    await page.click('#cloud-upload');
    await page.waitForFunction(() => document.querySelectorAll('#cloud-media [data-media]').length === 2, null, { timeout: 120000 });
    const keys = [...s3.objects.keys()].sort();
    checks.check(JSON.stringify(keys) === '["team/media/red.mov","team/media/testsrc.mov"]', `project media upload into the bucket folder (${keys})`);
    checks.check(s3.log.parts === 2 && s3.objects.get('team/media/testsrc.mov').data.length === 33125817, `a large file goes up in parts and arrives whole (${s3.log.parts} parts)`);
    checks.check((await editor.run(() => montage.assets().filter((a) => a.remote).length)) === 2, 'uploaded media remember where they live');

    await page.fill('#cloud-project-name', 'Cut A');
    await page.click('#cloud-save');
    await page.waitForSelector('#cloud-projects [data-project="team/projects/Cut A.montage.json"]', { timeout: 15000 });
    checks.check(s3.objects.has('team/projects/Cut A.montage.json'), 'the project is saved to the bucket');
    await page.click('#cloud-close');

    await editor.close();

    const fresh = await Editor.open(browser, url);
    const config = { endpoint: s3.endpoint, bucket: s3.bucket, region: s3.region, prefix: 'team', accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey };
    await fresh.run((config) => montage.remote.connect(config), config);
    const ranges = s3.log.ranges;
    await fresh.run(() => montage.remote.openProject('team/projects/Cut A.montage.json'));
    await fresh.until(() => montage.assets().length === 2 && montage.interchange.offline().length === 0 && montage.clips().length === 2, undefined, 30000);
    checks.check((await fresh.run(() => montage.assets().filter((a) => a.remote).length)) === 2, 'another browser opens the project from the bucket with its media');
    await fresh.run(() => montage.seek(0.5));
    await fresh.frame();
    const red = await fresh.previewColor();
    checks.check(isRed(red) && s3.log.ranges > ranges, `media stream from the bucket with range requests (${red.map(Math.round)}, ${s3.log.ranges - ranges} ranges)`);
    const sampled = await fresh.run(() => montage.sample({ x: 0, y: 0 }, 1.5));
    checks.check(sampled.some((v) => v > 0.05), 'the second clip decodes from the bucket too');

    await fresh.page.click('#project-new');
    await fresh.page.click('.modal .btn.primary');
    await fresh.until(() => montage.assets().length === 0);
    await fresh.page.click('#cloud-open');
    await fresh.page.waitForSelector('[data-import="team/media/red.mov"]:not([disabled])');
    await fresh.page.click('[data-import="team/media/red.mov"]');
    await fresh.until(() => montage.assets().length === 1 && montage.clips().length === 1, undefined, 30000);
    await fresh.page.click('#cloud-close');
    await fresh.run(() => montage.seek(0.5));
    await fresh.frame();
    checks.check(isRed(await fresh.previewColor()), 'media can be imported straight from the bucket');
    const out = await fresh.run(async () => (await montage.render({ height: 180, prores: 'proxy' })).file.size);
    checks.check(out > 10000, `a timeline built on bucket media exports (${out} bytes)`);
    checks.check(fresh.errors.length === 0, `no page errors ${fresh.errors.join('; ')}`);
    await fresh.close();
    await s3.stop();
  },
};
