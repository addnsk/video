import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Editor, fixture } from '../harness.mjs';

export default {
  name: 'diagnostics',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    const broken = join(mkdtempSync(join(tmpdir(), 'montage-bad-')), 'broken.mov');
    writeFileSync(broken, 'this is not a video');
    await editor.pick('#import', [broken, fixture('red.mov')]);
    await editor.until(() => montage.assets().length === 1);
    await editor.until(() => montage.diagnostics.entries().length > 0);
    const first = await editor.run(() => montage.diagnostics.entries()[0]);
    checks.check(first.source === 'media' && first.message.startsWith('broken.mov'), `import failure is logged (${first.message})`);

    await editor.page.selectOption('#script-example', { index: 0 });
    await editor.page.fill('#script-code', 'montage.clip(99);');
    await editor.page.click('#script-run');
    await editor.until(() => montage.diagnostics.entries().some((e) => e.source === 'script'));
    await editor.run(() => setTimeout(() => { throw new Error('stray failure'); }));
    await editor.until(() => montage.diagnostics.entries().some((e) => e.source === 'ui'));
    checks.check(true, 'script errors and uncaught exceptions are logged');
    checks.check((await editor.page.textContent('#diagnostics .count')) === '3', 'the log button counts errors');

    await editor.page.click('#diagnostics');
    const items = await editor.page.locator('#log-list li').count();
    checks.check(items === 3, `dialog lists every entry (${items})`);
    const download = editor.page.waitForEvent('download');
    await editor.page.click('#log-download');
    const report = JSON.parse(readFileSync(await (await download).path(), 'utf8'));
    checks.check(report.entries.length === 3 && report.context.engine === 'worker' && Array.isArray(report.context.assets), 'report includes entries and environment');
    await editor.page.click('#log-close');

    await editor.page.reload();
    await editor.ready();
    const persisted = await editor.run(() => montage.diagnostics.entries().length);
    checks.check(persisted === 3, `log survives a reload (${persisted})`);
    await editor.page.click('#diagnostics');
    await editor.page.click('#log-clear');
    checks.check(await editor.page.isHidden('#diagnostics .count'), 'clearing resets the badge');
    await editor.close();
  },
};
