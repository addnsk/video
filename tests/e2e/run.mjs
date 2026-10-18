import { readdirSync } from 'node:fs';
import { Checks, launchBrowser, startServer } from './harness.mjs';

const only = new Set(process.argv.slice(2));
const dir = new URL('./suites/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
const suites = [];
for (const file of files) {
  const suite = (await import(new URL(file, dir).href)).default;
  if (!only.size || only.has(suite.name)) suites.push(suite);
}

const server = await startServer(Number(process.env.E2E_PORT ?? 4199));
const browser = await launchBrowser();
const failures = [];
try {
  for (const suite of suites) {
    const checks = new Checks(suite.name);
    const started = Date.now();
    try {
      await suite.run({ browser, url: server.url, checks });
    } catch (e) {
      checks.check(false, `threw ${e.stack ?? e}`);
    }
    console.log(`---- ${suite.name} ${((Date.now() - started) / 1000).toFixed(1)} s`);
    failures.push(...checks.failures);
  }
} finally {
  await browser.close();
  server.stop();
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`\n${suites.length} suite(s) passed`);
