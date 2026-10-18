import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';

const FIXTURE_DIR = join(tmpdir(), 'montage-fixtures');

const FIXTURES = {
  'testsrc.mov': ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '4', '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s24le'],
  'bars.mov': ['-f', 'lavfi', '-i', 'smptehdbars=size=1920x1080:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000',
    '-t', '4', '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s24le'],
  'red.mov': ['-f', 'lavfi', '-i', 'color=c=red:size=640x360:rate=25', '-t', '2', '-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le'],
  'blue.mov': ['-f', 'lavfi', '-i', 'color=c=blue:size=640x360:rate=25', '-t', '2', '-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le'],
  'gray.mov': ['-f', 'lavfi', '-i', 'color=c=0x808080:size=640x360:rate=25', '-t', '2', '-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le'],
  'bmdlog.mov': ['-f', 'lavfi', '-i', 'color=c=0x808080:size=640x360:rate=25', '-t', '1', '-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le',
    '-movflags', 'use_metadata_tags', '-metadata', 'com.apple.proapps.customgamma=com.blackmagic-design.cinemacamera.filmlog'],
  'prores-1080-10s.mov': ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '10', '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s24le'],
  'prores-2160-4s.mov': ['-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '4', '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s24le'],
  'vp9-1080-10s.webm': ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25', '-t', '10', '-c:v', 'libvpx-vp9', '-b:v', '8M', '-deadline', 'realtime', '-cpu-used', '8'],
  'greenscreen.mov': ['-f', 'lavfi', '-i', 'color=c=0x10d020:size=640x360:rate=25', '-f', 'lavfi', '-i', 'color=c=0xd03030:size=200x200:rate=25',
    '-filter_complex', '[0][1]overlay=220:80', '-t', '1', '-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le'],
  'moving.mov': ['-f', 'lavfi', '-i', 'color=c=0x404040:size=640x360:rate=25', '-f', 'lavfi', '-i', 'testsrc2=size=100x100:rate=25',
    '-filter_complex', "[1]trim=end_frame=1,loop=-1:1,setpts=N/25/TB[p];[0][p]overlay=x='100+t*100':y=130", '-t', '1', '-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le'],
  'noisy.mov': ['-f', 'lavfi', '-i', 'color=c=0x808080:size=640x360:rate=25', '-vf', 'noise=alls=30:allf=t+u', '-t', '2', '-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le'],
  'cam1.mov': ['-f', 'lavfi', '-i', 'color=c=red:size=640x360:rate=25', '-f', 'lavfi', '-i', "aevalsrc='0.8*sin(2*PI*600*t)*lt(mod(t*t*0.7,1),0.25)':s=48000",
    '-t', '6', '-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s16le'],
  'cam2.mov': ['-f', 'lavfi', '-i', 'color=c=blue:size=640x360:rate=25', '-f', 'lavfi', '-i', "aevalsrc='0.8*sin(2*PI*600*(t+1.3))*lt(mod((t+1.3)*(t+1.3)*0.7,1),0.25)':s=48000",
    '-t', '4.7', '-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s16le'],
  'music.wav': ['-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100', '-t', '6', '-c:a', 'pcm_s16le'],
};

export function fixture(name) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const path = join(FIXTURE_DIR, name);
  if (!existsSync(path)) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...FIXTURES[name], path]);
  return path;
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

export async function startServer() {
  const port = await freePort();
  const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true });
  const stop = () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  };
  process.once('exit', stop);
  const url = `http://localhost:${port}/`;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`Preview server exited; port ${port}`);
    try {
      if ((await fetch(url)).ok) return { url, stop };
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  stop();
  throw new Error(`Preview server did not start on ${port}`);
}

const SOFTWARE_GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export const launchBrowser = () =>
  chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: process.env.CHROME_CHANNEL ?? 'chrome' }),
    headless: process.env.HEADLESS !== '0',
    args: [...(process.env.SOFTWARE_GL === '1' ? SOFTWARE_GL : ['--enable-gpu', '--ignore-gpu-blocklist']), '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'],
  });

export class Checks {
  failures = [];
  constructor(prefix) {
    this.prefix = prefix;
  }
  check(condition, message) {
    if (!condition) this.failures.push(`${this.prefix}: ${message}`);
    console.log(condition ? 'ok  ' : 'FAIL', `${this.prefix}: ${message}`);
  }
  near(actual, expected, tolerance, message) {
    this.check(Math.abs(actual - expected) <= tolerance, `${message} (${actual.toFixed?.(3) ?? actual} vs ${expected})`);
  }
}

export class Editor {
  constructor(context, page, url) {
    this.context = context;
    this.page = page;
    this.url = url;
    this.errors = [];
    page.on('pageerror', (e) => {
      this.errors.push(e.message);
      console.log('PAGE ERROR', e.stack ?? e.message);
    });
  }

  static async open(browser, url, { inline = false, viewport = { width: 1280, height: 800 }, device = null } = {}) {
    const context = await browser.newContext({ viewport, acceptDownloads: true, hasTouch: !!device?.touch });
    await context.addInitScript(({ inline, device }) => {
      delete window.showSaveFilePicker;
      delete window.showOpenFilePicker;
      if (inline) delete HTMLCanvasElement.prototype.transferControlToOffscreen;
      if (device) {
        Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => device.memoryGb });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => device.cores });
        Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => (device.touch ? 5 : 0) });
      }
    }, { inline, device });
    const page = await context.newPage();
    const editor = new Editor(context, page, url);
    await page.goto(url);
    await editor.ready();
    return editor;
  }

  async ready() {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.page.waitForFunction(() => window.montage && (!window.isSecureContext || crossOriginIsolated), null, { timeout: 20000 });
      } catch (e) {
        if (attempt > 3 || !/context was destroyed|navigat/i.test(e.message)) throw e;
      }
    }
  }

  async pick(selector, files) {
    const chooser = this.page.waitForEvent('filechooser');
    await this.page.click(selector);
    await (await chooser).setFiles(files);
  }

  async import(files, expectedAssets = files.length) {
    await this.pick('#import', files);
    await this.page.waitForFunction((n) => montage.assets().length >= n, expectedAssets, { timeout: 60000 });
  }

  run(fn, arg) {
    return this.page.evaluate(fn, arg);
  }

  until(fn, arg, timeout = 20000) {
    return this.page.waitForFunction(fn, arg, { timeout });
  }

  async settle(ms = 1500) {
    await this.page.waitForTimeout(ms);
  }

  async frame() {
    await this.run(() => montage.idle());
    await this.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await this.page.waitForTimeout(Number(process.env.FRAME_EXTRA ?? 0));
  }

  async seekAndSettle(time) {
    await this.run((t) => montage.seek(t), time);
    await this.frame();
  }

  async regionPixels(region, screen = 'timeline') {
    const box = await this.page.locator(screen === 'source' && (await this.page.locator('#source-screen').isVisible()) ? '#source-screen canvas' : '#timeline-screen canvas').boundingBox();
    const w = Math.max(1, box.width * region.size);
    const h = Math.max(1, box.height * region.size);
    const clip = { x: box.x + box.width * region.x - w / 2, y: box.y + box.height * region.y - h / 2, width: w, height: h };
    const shot = await this.page.screenshot({ clip, scale: 'css' });
    return this.page.evaluate(async (data) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      return Array.from(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data);
    }, shot.toString('base64'));
  }

  async previewNoise(region = { x: 0.5, y: 0.5, size: 0.2 }, screen = 'timeline') {
    const pixels = await this.regionPixels(region, screen);
    let sum = 0;
    let squares = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      sum += pixels[i + 1];
      squares += pixels[i + 1] * pixels[i + 1];
    }
    const n = pixels.length / 4;
    return Math.sqrt(Math.max(0, squares / n - (sum / n) ** 2));
  }

  async previewColor(region = { x: 0.5, y: 0.5, size: 0.1 }, screen = 'timeline') {
    const pixels = await this.regionPixels(region, screen);
    const sum = [0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += pixels[i + c];
    const n = pixels.length / 4;
    return sum.map((v) => v / n);
  }

  stats() {
    return this.run(() => montage.stats());
  }

  async close() {
    await this.context.close();
  }
}

Editor.prototype.previewColorAt = async function (time, region) {
  await this.seekAndSettle(time);
  return this.previewColor(region);
};

if (process.env.E2E_PROFILE) {
  for (const name of ['open', 'import', 'run', 'until', 'settle', 'frame', 'previewColor', 'previewNoise', 'pick']) {
    const target = name === 'open' ? Editor : Editor.prototype;
    const original = target[name];
    if (!original) continue;
    target[name] = async function (...args) {
      const started = Date.now();
      try {
        return await original.apply(this, args);
      } finally {
        const label = typeof args[0] === 'function' ? args[0].toString().replace(/\s+/g, ' ').slice(0, 90) : JSON.stringify(args[0] ?? '').slice(0, 90);
        console.log(`PROF ${name} ${Date.now() - started} ${label}`);
      }
    };
  }
}
