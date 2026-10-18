import { Editor, fixture } from '../harness.mjs';

const fmt = (c) => c.map((v) => v.toFixed(0)).join(',');

export default {
  name: 'stills',
  tags: ['color'],
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('gray.mov'), fixture('red.mov')]);
    await editor.run(() => montage.grade(0, { exposure: 1 }));
    await editor.seekAndSettle(0.5);
    const graded = await editor.previewColor({ x: 0.5, y: 0.5, size: 0.04 });
    const still = await editor.run(() => montage.stills.grab({ name: 'Bright', clip: 0 }));
    const listed = await editor.run(() => montage.stills.list());
    checks.check(listed.length === 1 && listed[0].image.startsWith('data:image/jpeg'), `a still stores a frame image (${listed[0]?.image.slice(0, 20)})`);

    await editor.run(() => montage.effect(0, 'grade', null));
    await editor.seekAndSettle(0.5);
    const plain = await editor.previewColor({ x: 0.5, y: 0.5, size: 0.04 });
    await editor.run((id) => montage.stills.compare(id, 0.5), still.id);
    await editor.frame();
    const left = await editor.previewColor({ x: 0.3, y: 0.5, size: 0.04 });
    const right = await editor.previewColor({ x: 0.7, y: 0.5, size: 0.04 });
    checks.check(Math.abs(left[0] - graded[0]) < 8 && Math.abs(right[0] - plain[0]) < 8, `wipe shows the still on the left and the live frame on the right (${fmt(left)} | ${fmt(right)})`);
    await editor.run(() => montage.stills.wipe(0));
    await editor.frame();
    const closed = await editor.previewColor({ x: 0.3, y: 0.5, size: 0.04 });
    checks.check(Math.abs(closed[0] - plain[0]) < 8, `moving the wipe to the edge shows the live frame (${fmt(closed)})`);
    await editor.run(() => montage.stills.compare(null));

    await editor.run((id) => montage.stills.apply(id, [0]), still.id);
    await editor.seekAndSettle(0.5);
    const applied = await editor.previewColor({ x: 0.5, y: 0.5, size: 0.04 });
    checks.check(Math.abs(applied[0] - graded[0]) < 6, `applying the still restores its grade (${fmt(applied)} vs ${fmt(graded)})`);

    const versions = await editor.run(async () => {
      montage.versions.save(0, 'Bright');
      montage.grade(0, { exposure: -1 });
      montage.versions.save(0, 'Dark');
      montage.versions.load(0, 'Bright');
      return montage.versions.list(0);
    });
    await editor.seekAndSettle(0.5);
    const bright = await editor.previewColor({ x: 0.5, y: 0.5, size: 0.04 });
    checks.check(versions.active === 'Bright' && versions.names.join() === 'Bright,Dark' && Math.abs(bright[0] - graded[0]) < 6, `grade versions switch the look (${JSON.stringify(versions)}, ${fmt(bright)})`);

    await editor.page.click('#still-grab');
    await editor.until(() => montage.stills.list().length === 2);
    const cards = await editor.page.locator('#stills-grid figure').count();
    checks.check(cards === 2, `the stills panel shows the gallery (${cards})`);
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
