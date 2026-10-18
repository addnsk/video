import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const mode = process.argv[2] === 'inline' ? 'inline' : 'worker';
const port = 4199;
const dir = mkdtempSync(join(tmpdir(), 'montage-'));
const fixture = join(dir, 'prores.mov');

execFileSync('ffmpeg', [
  '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
  '-t', '4', '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s24le', fixture,
]);

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
  console.log(condition ? 'ok  ' : 'FAIL', message);
};

try {
  await new Promise((r) => setTimeout(r, 3000));
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript((inline) => {
    delete window.showSaveFilePicker;
    if (inline) delete HTMLCanvasElement.prototype.transferControlToOffscreen;
  }, mode === 'inline');
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => window.montage, null, { timeout: 20000 });
  await page.setInputFiles('input[type=file][multiple]', [fixture]);
  await page.waitForFunction(() => montage.clips().length === 1, null, { timeout: 60000 });

  const stats = () => page.evaluate(() => montage.stats());
  await page.evaluate(async () => {
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
  check((await page.evaluate(() => montage.clips().length)) === 150, '150 clips on the timeline');

  await page.evaluate(async () => {
    for (let i = 0; i < 300; i++) {
      montage.seek(Math.random() * montage.duration);
      await new Promise((r) => setTimeout(r, 5));
    }
  });
  await page.waitForTimeout(4000);
  let s = await stats();
  check(s.frameCacheBytes <= s.budget.frameCacheBytes, `frame cache within budget (${(s.frameCacheBytes / 1048576).toFixed(0)} MB)`);
  check((s.resources.videoSample?.live ?? 0) === 0, 'no decoded frames held after seeking');

  await page.evaluate(() => montage.seek(10));
  await page.evaluate(() => montage.play());
  await page.waitForTimeout(4000);
  const played = await page.evaluate(() => montage.time);
  await page.evaluate(() => montage.pause());
  check(played > 12.5, `playback advanced (${played.toFixed(2)} s)`);
  await page.waitForTimeout(1500);
  s = await stats();
  check((s.resources.videoSample?.live ?? 0) === 0, 'no decoded frames held after playback');
  check((s.resources.framebuffer?.live ?? 0) <= 8, `render targets bounded (${s.resources.framebuffer?.live})`);

  await page.evaluate(async () => {
    await montage.batch(() => {
      while (montage.clips().length > 12) montage.remove(-1);
    });
  });
  const result = await page.evaluate(async () => {
    const r = await montage.render({ height: 360, quality: 'medium' });
    return { size: r.file?.size ?? 0 };
  });
  check(result.size > 10000, `export produced a file (${result.size} bytes)`);
  s = await stats();
  check((s.resources.videoSample?.live ?? 0) === 0, 'no decoded frames held after export');
  check((s.resources.audioSample?.live ?? 0) === 0, 'no audio samples held after export');
  await browser.close();
} finally {
  server.kill();
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
