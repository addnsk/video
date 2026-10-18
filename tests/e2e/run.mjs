import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Checks, launchBrowser, startServer } from './harness.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const names = args.filter((a) => !a.startsWith('--'));
const dir = new URL('./suites/', import.meta.url);

async function loadSuites(filter) {
  const out = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort()) {
    const suite = (await import(new URL(file, dir).href)).default;
    if (!filter.size || filter.has(suite.name) || (suite.tags ?? []).some((t) => filter.has(`@${t}`))) out.push(suite);
  }
  return out;
}

async function runChild(name, url) {
  const [suite] = await loadSuites(new Set([name]));
  const browser = await launchBrowser();
  const checks = new Checks(suite.name);
  const started = Date.now();
  try {
    await suite.run({ browser, url, checks });
  } catch (e) {
    checks.check(false, `threw ${e.stack ?? e}`);
  } finally {
    await browser.close().catch(() => undefined);
  }
  console.log(`---- ${suite.name} ${((Date.now() - started) / 1000).toFixed(1)} s`);
  process.exit(checks.failures.length ? 1 : 0);
}

function runOne(suite, url, logs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const log = join(logs, `${suite.name}.log`);
    const out = createWriteStream(log);
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', suite.name, url], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    child.on('exit', (code) => {
      out.end();
      const seconds = (Date.now() - started) / 1000;
      const failures = readFileSync(log, 'utf8').split('\n').filter((l) => l.startsWith('FAIL') || l.includes('threw'));
      if (code !== 0 && !failures.length) failures.push(`${suite.name}: exited with code ${code}`);
      console.log(`${failures.length ? 'FAIL' : 'ok  '} ${suite.name.padEnd(20)} ${seconds.toFixed(1).padStart(6)} s${failures.length ? `  (${failures.length} failed, see ${log})` : ''}`);
      resolve({ suite: suite.name, seconds, failures });
    });
  });
}

async function pool(items, jobs, fn) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, async () => {
    while (next < items.length) results.push(await fn(items[next++]));
  }));
  return results;
}

if (args[0] === '--child') {
  await runChild(args[1], args[2]);
} else {
  if (args.includes('--build')) {
    const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  const suites = await loadSuites(new Set(names));
  const jobs = Number(flag('jobs') ?? Math.max(1, Math.min(4, Math.floor(cpus().length / 2))));
  const logs = flag('logs') ?? join(tmpdir(), 'montage-e2e-logs');
  mkdirSync(logs, { recursive: true });
  const server = await startServer();
  const started = Date.now();
  let results;
  try {
    const shared = suites.filter((s) => !s.exclusive);
    const alone = suites.filter((s) => s.exclusive);
    results = [...(await pool(shared, jobs, (s) => runOne(s, server.url, logs))), ...(await pool(alone, 1, (s) => runOne(s, server.url, logs)))];
  } finally {
    server.stop();
  }
  const failures = results.flatMap((r) => r.failures);
  const total = results.reduce((sum, r) => sum + r.seconds, 0);
  console.log(`\n${suites.length} suite(s), ${jobs} parallel, wall ${((Date.now() - started) / 1000).toFixed(0)} s (sum ${total.toFixed(0)} s), logs in ${logs}`);
  if (failures.length) {
    console.error(`\n${failures.length} failure(s):\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log('all passed');
}
