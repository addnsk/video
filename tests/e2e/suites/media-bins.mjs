import { Editor, fixture } from '../harness.mjs';

export default {
  name: 'media-bins',
  tags: ['edit'],
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    const { page } = editor;
    const answers = [];
    page.on('dialog', (d) => d.accept(answers.shift() ?? ''));
    await editor.import([fixture('red.mov'), fixture('blue.mov'), fixture('music.wav')]);
    const ids = await editor.run(() => Object.fromEntries(montage.assets().map((a) => [a.name, a.id])));
    const shown = () => page.$$eval('#media .media-item[data-asset] b', (els) => els.map((e) => e.textContent));

    answers.push('Day 1');
    await page.click('#bin-new');
    checks.check((await page.inputValue('#media-bin')) !== '' && (await shown()).length === 0, 'a new bin opens empty');
    await page.selectOption('#media-bin', '');
    await page.click(`[data-info="${ids['red.mov']}"]`);
    const editor0 = `[data-meta="${ids['red.mov']}"]`;
    await page.fill(`${editor0} [data-field=scene]`, '12');
    await page.locator(`${editor0} [data-field=scene]`).dispatchEvent('change');
    await page.fill(`${editor0} [data-field=keywords]`, 'interview, wide');
    await page.locator(`${editor0} [data-field=keywords]`).dispatchEvent('change');
    await page.selectOption(`${editor0} [data-field=rating]`, '4');
    const day = await editor.run(() => montage.media.bins()[0].id);
    await page.selectOption(`${editor0} [data-field=bin]`, day);
    const red = await editor.run((id) => montage.media.get(id), ids['red.mov']);
    checks.check(red.metadata.scene === '12' && red.metadata.rating === 4 && red.metadata.keywords.join() === 'interview,wide' && red.bin === day, `the info editor stores metadata and the bin (${JSON.stringify(red.metadata)})`);

    await page.selectOption('#media-bin', day);
    checks.check(JSON.stringify(await shown()) === '["red.mov"]', 'the bin lists its media');
    await page.selectOption('#media-bin', '');
    await page.fill('#media-search', 'kind:audio');
    checks.check(JSON.stringify(await shown()) === '["music.wav"]', 'search by kind');
    await page.fill('#media-search', 'interview rating>=3');
    checks.check(JSON.stringify(await shown()) === '["red.mov"]', 'search by keyword and rating');
    await page.fill('#media-search', 'mood:sad');
    checks.check(await page.$eval('#media-search', (el) => !el.checkValidity()), 'an unknown field marks the search box invalid');
    await page.fill('#media-search', '');

    answers.push('Rated', 'rating>=1');
    await page.click('#bin-smart');
    checks.check(JSON.stringify(await shown()) === '["red.mov"]', 'a smart bin shows its search results');
    await editor.run((id) => montage.media.metadata(id, { rating: 2 }), ids['blue.mov']);
    checks.check(JSON.stringify((await shown()).sort()) === '["blue.mov","red.mov"]', 'a smart bin follows metadata changes');

    await editor.run(() => montage.clear());
    await editor.run(() => {
      for (const c of montage.clips('a1')) montage.remove(c.id);
    });
    await page.selectOption('#media-bin', '');
    await page.click(`[data-info="${ids['music.wav']}"]`);
    await page.click(`[data-remove-asset="${ids['music.wav']}"]`);
    checks.check(!(await editor.run((id) => montage.assets().some((a) => a.id === id), ids['music.wav'])), 'unused media can be removed from the project');
    await page.keyboard.press('Control+z');
    checks.check(await editor.run((id) => montage.assets().some((a) => a.id === id), ids['music.wav']), 'undo brings it back');
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
