import { Editor, fixture } from '../harness.mjs';

const snapshot = () => JSON.stringify(montage.tracks().flatMap((t) => montage.clips(t.id).map((c) => [t.id, c.name, c.start.toFixed(2), c.duration.toFixed(2), c.transition?.type ?? '-', c.effects.map((e) => e.type).join('+')])));

export default {
  name: 'persistence',
  tags: ['edit', 'media'],
  async run({ browser, url, checks }) {
    const files = [fixture('red.mov'), fixture('blue.mov')];
    const editor = await Editor.open(browser, url);
    await editor.import(files);
    await editor.run(() => {
      montage.grade(0, { exposure: 0.7 });
      montage.transition(1, { type: 'wipe', duration: 0.8 });
      montage.split(1);
      montage.title('Saved', { start: 0.5, duration: 1 });
    });
    await editor.until(() => /saved/i.test(document.querySelector('.save-status')?.textContent ?? ''), null, 10000).catch(() => undefined);
    await editor.settle(1500);
    const before = await editor.run(snapshot);

    await editor.page.reload();
    await editor.ready();
    await editor.until(() => montage.clips().length > 0);
    const restored = await editor.run(snapshot);
    checks.check(restored === before, 'project restores after reload');

    const offline = await editor.page.isVisible('.offline');
    if (offline) {
      await editor.pick('#media-locate', files);
      await editor.until(() => !document.querySelector('.offline') || document.querySelector('.offline').hidden);
    }
    checks.check(!(await editor.page.isVisible('.offline')), `media is linked after reload${offline ? ' via locate' : ''}`);
    const [r] = await editor.previewColorAt(0.5);
    checks.check(r > 150, 'relinked media renders');

    const download = editor.page.waitForEvent('download');
    await editor.page.click('#project-save');
    const projectFile = await (await download).path();
    checks.check(!!projectFile, 'project file downloads');

    await editor.page.click('#project-new');
    await editor.page.click('.modal .btn.primary');
    await editor.until(() => montage.clips().length === 0);
    checks.check(true, 'new project clears the timeline');

    await editor.pick('#project-open', [projectFile]);
    await editor.until((n) => montage.clips().length === n, JSON.parse(before).filter((c) => c[0] === 'v1').length);
    checks.check((await editor.run(snapshot)) === before, 'project file reopens identically');
    checks.check(!(await editor.page.isVisible('.offline')), 'loaded media relinks automatically on open');

    await editor.run(() => montage.undo());
    checks.check((await editor.run(snapshot)) === before, 'opening a project starts a fresh history');
    await editor.page.selectOption('#language', 'ru');
    await editor.page.waitForLoadState('load');
    await editor.ready();
    checks.check((await editor.page.textContent('#import')) !== 'Import' && (await editor.page.getAttribute('html', 'lang')) === 'ru', 'switching the language relabels the UI after reload');
    await editor.page.selectOption('#language', 'en');
    await editor.page.waitForLoadState('load');
    await editor.ready();
    checks.check((await editor.page.textContent('#import')) === 'Import', 'switching back restores English');
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
