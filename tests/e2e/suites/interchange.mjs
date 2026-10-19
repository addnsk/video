import { Editor, fixture } from '../harness.mjs';

const isRed = ([r, , b]) => r > 180 && b < 80;
const isBlue = ([r, , b]) => b > 180 && r < 80;

export default {
  name: 'interchange',
  tags: ['edit'],
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    const { page } = editor;
    await editor.import([fixture('red.mov'), fixture('blue.mov')]);
    const files = await editor.run(() => {
      const [red, blue] = montage.assets();
      for (const c of montage.clips()) montage.remove(c.id);
      montage.edit.append({ asset: red.id, in: 0, out: 1.2 });
      const second = montage.edit.append({ asset: blue.id, in: 0, out: 1.2 });
      montage.transition(second.video, { type: 'dissolve', duration: 0.4 });
      montage.markers.add({ time: 0.5, name: 'Check' });
      return { otio: montage.interchange.export('otio'), fcpxml: montage.interchange.export('fcpxml'), edl: montage.interchange.export('edl') };
    });
    checks.check(files.otio.includes('"OTIO_SCHEMA": "Timeline.1"') && files.fcpxml.includes('<fcpxml version="1.10">') && files.edl.startsWith('TITLE:'), 'the timeline exports as OTIO, FCPXML and EDL');
    const shape = () => editor.run(() => montage.clips().map((c) => [c.name, +c.start.toFixed(2), +c.duration.toFixed(2)]));
    const original = await shape();

    await page.click('#project-new');
    await page.click('.modal .btn.primary');
    await editor.until(() => montage.assets().length === 0);
    for (const format of ['fcpxml', 'otio', 'edl']) {
      const result = await editor.run(({ text, format }) => montage.interchange.import(text, { format }), { text: files[format], format });
      checks.check(JSON.stringify(await shape()) === JSON.stringify(original), `${format}: the imported timeline matches the original (${JSON.stringify(await shape())})`);
      if (format === 'fcpxml') {
        checks.check(result.placeholders.length === 2, `fcpxml: missing media are kept as offline clips (${result.placeholders.length})`);
        checks.check((await page.locator('.offline:not([hidden])').count()) > 0 && (await editor.run(() => montage.interchange.offline().length)) === 2, 'the offline media are reported in the viewer');
        await editor.pick('#import', [fixture('red.mov'), fixture('blue.mov')]);
        await editor.until(() => montage.interchange.offline().length === 0, undefined, 60000);
        checks.check(JSON.stringify(await shape()) === JSON.stringify(original) && (await editor.run(() => montage.assets().length)) === 2, 'importing the files by name connects the offline clips without adding new ones');
        await editor.run(() => montage.seek(0.3));
        await editor.frame();
        const red = await editor.previewColor();
        await editor.run(() => montage.seek(1.5));
        await editor.frame();
        const blue = await editor.previewColor();
        checks.check(isRed(red) && isBlue(blue), `the connected media play in the imported timeline (${red.map(Math.round)} → ${blue.map(Math.round)})`);
        checks.check((await editor.run(() => montage.markers.list().map((m) => m.name))).join() === 'Check', 'markers come through FCPXML');
      } else checks.check(result.placeholders.length === 0 && result.matched.length === 2, `${format}: media already in the project are matched by name`);
    }
    checks.check((await editor.run(() => montage.timelines.list().length)) === 4, 'each import opens as a new timeline');
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
