import { Editor, fixture } from '../harness.mjs';

const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const INVERT_CUBE = ['LUT_3D_SIZE 2', ...Array.from({ length: 8 }, (_, i) => `${1 - (i & 1)} ${1 - ((i >> 1) & 1)} ${1 - ((i >> 2) & 1)}`)].join('\n');

export default {
  name: 'color',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('gray.mov'), fixture('red.mov')]);
    const base = luma(await editor.previewColorAt(0.5));
    checks.near(base, 128, 12, 'gray clip renders mid gray');

    await editor.run(() => montage.grade(0, { exposure: 1 }));
    const brighter = luma(await editor.previewColorAt(0.5));
    checks.check(brighter > base + 30, `exposure +1 brightens (${brighter.toFixed(0)})`);

    await editor.page.click('#bypass');
    const bypassed = luma(await editor.previewColorAt(0.5));
    checks.near(bypassed, base, 6, 'compare bypasses grading');
    await editor.page.click('#bypass');

    await editor.run(() => {
      montage.resetGrade(0);
      montage.effect(0, 'curves', { master: [0, 0, 0.5, 0.2, 1, 1] });
    });
    const curved = luma(await editor.previewColorAt(0.5));
    checks.check(curved < base - 30, `master curve darkens midtones (${curved.toFixed(0)})`);

    await editor.run(() => montage.effect(0, 'curves', null));
    const redTime = await editor.run(() => montage.clip(1).start + 0.5);
    await editor.run(() => montage.grade(1, { saturation: 0 }));
    const [r, g, b] = await editor.previewColorAt(redTime);
    checks.check(Math.abs(r - g) < 20 && Math.abs(g - b) < 20, `saturation 0 desaturates red (${[r, g, b].map((v) => v.toFixed(0))})`);

    await editor.run(() => montage.grade(1, { saturation: 1, inputTransform: 'bmdFilmGen5' }));
    await editor.run(() => montage.grade(1, { inputTransform: 'none' }));
    await editor.run((cube) => montage.lut(1, cube, 1), INVERT_CUBE);
    const [ir, ig, ib] = await editor.previewColorAt(redTime);
    checks.check(ir < 40 && ig > 200 && ib > 200, `inverting LUT turns red into cyan (${[ir, ig, ib].map((v) => v.toFixed(0))})`);
    await editor.run((cube) => montage.lut(1, cube, 0), INVERT_CUBE);
    const [zr] = await editor.previewColorAt(redTime);
    checks.check(zr > 200, 'LUT strength 0 is a no-op');

    await editor.run(() => montage.grade(0, { inputTransform: 'bmdFilmGen5' }));
    const film = luma(await editor.previewColorAt(0.5));
    checks.check(Math.abs(film - base) > 10, `BMD Film Gen5 input transform remaps log gray (${film.toFixed(0)} vs ${base.toFixed(0)})`);

    await editor.page.click('#scopes summary');
    for (const mode of ['waveform', 'parade', 'vector', 'histogram']) {
      await editor.page.selectOption('#scope-mode', mode);
      await editor.seekAndSettle(0.4 + Math.random() * 0.2);
      const lit = await editor.run(() => {
        const canvas = document.querySelector('#scopes canvas');
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 60) count++;
        return count;
      });
      checks.check(lit > 20, `${mode} scope draws (${lit} lit pixels)`);
    }
    await editor.import([fixture('bmdlog.mov')], 3);
    await editor.until(() => montage.clips().length === 3);
    const auto = await editor.run(() => montage.colorSpace(2));
    checks.check(auto === 'bmdFilmGen5', `Blackmagic Film log footage is tagged with its input color space on import (${auto})`);
    const logAt = await editor.run(() => montage.clip(2).start + 0.5);
    const managed = await editor.previewColorAt(logAt, { x: 0.5, y: 0.5, size: 0.04 });
    await editor.run(() => montage.colorSpace(2, 'rec709'));
    const raw = await editor.previewColorAt(logAt, { x: 0.5, y: 0.5, size: 0.04 });
    checks.check(Math.abs(managed[0] - raw[0]) > 10, `the input transform changes the log picture (${managed[0]} vs ${raw[0]})`);

    await editor.run(() => montage.effect(0, 'grade', null));
    const gray = await editor.previewColorAt(0.5, { x: 0.5, y: 0.5, size: 0.04 });
    await editor.run(() => montage.colorScience('aces'));
    const acesGray = await editor.previewColorAt(0.5, { x: 0.5, y: 0.5, size: 0.04 });
    checks.check(gray.every((v, i) => Math.abs(v - acesGray[i]) <= 4), `Rec.709 media round-trips through ACES unchanged (${gray} vs ${acesGray})`);
    await editor.run(() => montage.grade(0, { exposure: 1 }));
    const acesBrighter = await editor.previewColorAt(0.5, { x: 0.5, y: 0.5, size: 0.04 });
    checks.check(acesBrighter[0] > acesGray[0] + 20 && acesBrighter[0] < 250, `exposure works in ACEScct (${acesGray[0]} → ${acesBrighter[0]})`);
    await editor.run(() => montage.colorSpace(2, 'bmdFilmGen5'));
    const acesLog = await editor.previewColorAt(logAt, { x: 0.5, y: 0.5, size: 0.04 });
    checks.check(acesLog[0] > 20 && acesLog[0] < 235, `log media through ACES lands in the display range (${acesLog})`);
    await editor.run(() => montage.colorScience('display'));
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
