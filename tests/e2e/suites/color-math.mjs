import { Editor, fixture } from '../harness.mjs';
import { MIDDLE_GRAY_CODES, SPACES, acesOdt, acescctEncode, displayFromScene, rec709Decode, rec709Encode } from '../lib/color-reference.mjs';

const CENTER = { x: 0, y: 0 };
const close = (a, b, tolerance) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
const fmt = (v) => v.map((x) => x.toFixed(4)).join(',');

export default {
  name: 'color-math',
  tags: ['color'],
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('gray.mov')]);
    const float = await editor.run(async () => (await montage.stats()).floatTargets);
    const tolerance = float ? 2e-3 : 3 / 255;
    await editor.run(() => {
      montage.renderCache(false);
      montage.nodes.register({ id: 'raw-color', name: 'Raw color', category: 'stylize', params: [{ name: 'value', type: 'color', default: [0, 0, 0, 1] }], passes: 'vec4 process(vec2 uv) { return value; }' });
    });

    const chain = async (rgb, filters) =>
      editor.run(async ({ rgb, filters }) => {
        montage.graph.enable(0);
        for (const n of montage.graph.get(0).nodes) if (n.id !== 'source' && n.id !== 'output') montage.graph.remove(0, n.id);
        let last = montage.graph.add(0, 'raw-color', { value: [...rgb, 1] });
        for (const [type, params] of filters) {
          const id = montage.graph.add(0, type, params);
          montage.graph.connect(0, last, id);
          last = id;
        }
        montage.graph.connect(0, last, 'output');
        return (await montage.sample({ x: 0, y: 0 }, 0.5)).slice(0, 3);
      }, { rgb, filters });

    const failures = [];
    const expect = (name, actual, expected, tol = tolerance) => {
      if (!close(actual, expected, tol)) failures.push(`${name}: got ${fmt(actual)} expected ${fmt(expected)}`);
    };

    for (const [space, decode] of Object.entries(SPACES)) {
      for (const code of [0.1, 0.25, MIDDLE_GRAY_CODES[space] ?? 0.4, 0.6, 0.8]) {
        const display = await chain([code, code, code], [['input-transform', { space, science: 'display' }]]);
        expect(`${space} ${code.toFixed(3)} → display`, display, [0, 1, 2].map(() => Math.max(0, displayFromScene(decode(code)))));
        const aces = await chain([code, code, code], [['input-transform', { space, science: 'aces' }]]);
        const lin = decode(code);
        expect(`${space} ${code.toFixed(3)} → ACEScct`, aces, [0, 1, 2].map(() => acescctEncode(lin)), lin > 50 ? 5e-3 : tolerance);
      }
    }
    for (const [space, gray] of Object.entries(MIDDLE_GRAY_CODES)) {
      const lin = SPACES[space](gray);
      if (Math.abs(lin - 0.18) > 0.01) failures.push(`${space} middle gray code ${gray} decodes to ${lin.toFixed(4)}, not 0.18`);
    }
    checks.check(!failures.length, `camera input transforms match the published curves (${failures.length} mismatches${failures.length ? `: ${failures.slice(0, 4).join('; ')}` : ''})`);

    failures.length = 0;
    await editor.run(() => montage.colorScience('aces'));
    for (const cct of [[0.2, 0.2, 0.2], [0.4135, 0.4135, 0.4135], [0.55, 0.45, 0.35], [0.3, 0.5, 0.6], [0.7, 0.7, 0.7]]) {
      expect(`ODT ${fmt(cct)}`, await chain(cct, []), acesOdt(cct), 3e-3);
    }
    checks.check(!failures.length, `ACES output transform matches the fitted RRT/ODT (${failures.join('; ')})`);

    failures.length = 0;
    for (const v of [0.05, 0.18, 0.5, 0.8, 0.95]) {
      const roundTrip = await chain([v, v * 0.8, v * 0.6], [['input-transform', { space: 'rec709', science: 'aces' }]]);
      expect(`Rec.709 ${v} through ACES`, roundTrip, [v, v * 0.8, v * 0.6], 4e-3);
    }
    checks.check(!failures.length, `Rec.709 values survive the inverse and forward output transform (${failures.join('; ')})`);

    const generated = await editor.run(async () => {
      const read = async () => {
        montage.graph.enable(0);
        for (const n of montage.graph.get(0).nodes) if (n.id !== 'source' && n.id !== 'output') montage.graph.remove(0, n.id);
        const bg = montage.graph.add(0, 'background', { color: [0.6, 0.35, 0.2, 1] });
        const gradient = montage.graph.add(0, 'gradient', { from: [0.1, 0.5, 0.9, 1], to: [0.1, 0.5, 0.9, 1] });
        const merge = montage.graph.add(0, 'merge', { opacity: 0 });
        montage.graph.connect(0, bg, merge, 'background');
        montage.graph.connect(0, gradient, merge, 'foreground');
        montage.graph.connect(0, merge, 'output');
        const background = (await montage.sample({ x: 0, y: 0 }, 0.5)).slice(0, 3);
        montage.graph.set(0, merge, { opacity: 1 });
        const ramp = (await montage.sample({ x: 0, y: 0 }, 0.5)).slice(0, 3);
        return [background, ramp];
      };
      const display = await read();
      montage.colorScience('aces');
      const aces = await read();
      return { display, aces };
    });
    const genDiff = Math.max(...generated.display.flat().map((v, i) => Math.abs(v - generated.aces.flat()[i])));
    checks.check(genDiff < 4e-3, `generator colors look the same in ACES as in display (${JSON.stringify(generated)})`);
    await editor.run(() => montage.colorScience('display'));

    failures.length = 0;
    expect('exposure +1', await chain([0.25, 0.2, 0.1], [['grade', { exposure: 1 }]]), [0.5, 0.4, 0.2]);
    expect('contrast 1.5 around pivot 0.5', await chain([0.6, 0.5, 0.3], [['grade', { contrast: 1.5, pivot: 0.5 }]]), [0.65, 0.5, 0.2]);
    const luma = 0.2126 * 0.6 + 0.7152 * 0.4 + 0.0722 * 0.2;
    expect('saturation 0', await chain([0.6, 0.4, 0.2], [['grade', { saturation: 0 }]]), [luma, luma, luma]);
    expect('gain master 0.5', await chain([0.4, 0.4, 0.4], [['grade', { gain: [0, 0, 0.5] }]]), [0.6, 0.6, 0.6]);
    expect('lift master 0.2', await chain([0.5, 0.5, 0.5], [['grade', { lift: [0, 0, 0.2] }]]), [0.55, 0.55, 0.55]);
    const gamma = 0.5 ** (1 / 1.5);
    expect('gamma master 0.5', await chain([0.5, 0.5, 0.5], [['grade', { gamma: [0, 0, 0.5] }]]), [gamma, gamma, gamma]);
    expect('curve master halves', await chain([0.6, 0.4, 0.2], [['curves', { master: [0, 0, 1, 0.5] }]]), [0.3, 0.2, 0.1], 4e-3);
    expect('red curve only', await chain([0.6, 0.4, 0.2], [['curves', { red: [0, 0, 1, 0.5] }]]), [0.3, 0.4, 0.2], 4e-3);
    expect('hdr global +1 stop', await chain([0.2, 0.2, 0.2], [['hdr-wheels', { global: [0, 0, 0.5] }]]), [0.4, 0.4, 0.4]);
    expect('neutral color warper is identity', await chain([0.3, 0.6, 0.9], [['color-warper', {}]]), [0.3, 0.6, 0.9]);
    checks.check(!failures.length, `grade, curves and wheels match their formulas (${failures.join('; ')})`);

    failures.length = 0;
    const down = ['grade', { exposure: -1 }];
    expect('identity curves keep values above 1', await chain([1.6, 1.2, 0.8], [['curves', {}], down]), [0.8, 0.6, 0.4], 4e-3);
    expect('a curve continues its end slope above 1', await chain([1.6, 1.6, 1.6], [['curves', { master: [0, 0, 1, 0.5] }], down]), [0.4, 0.4, 0.4], 6e-3);
    expect('neutral color warper keeps values above 1', await chain([1.6, 1.2, 0.8], [['color-warper', {}], down]), [0.8, 0.6, 0.4]);
    checks.check(!failures.length, `curves and the color warper keep HDR values (${failures.join('; ')})`);

    const perClip = await editor.run(async () => {
      const assetId = montage.clip(0).assetId;
      montage.colorSpace({ asset: assetId }, 'rec709');
      const first = montage.add(assetId, { index: 0 });
      const second = montage.add(assetId, { index: 1 });
      const at = (id) => montage.clips().find((c) => c.id === id).start + 0.2;
      montage.colorSpace(second.id, 'slog3', { clip: true });
      const [a] = await montage.sample([{ x: 0, y: 0 }], at(first.id));
      const [b] = await montage.sample([{ x: 0, y: 0 }], at(second.id));
      montage.colorSpace(second.id, null, { clip: true });
      const [c] = await montage.sample([{ x: 0, y: 0 }], at(second.id));
      montage.remove(first.id);
      montage.remove(second.id);
      return { a, b, c };
    });
    const differs = Math.abs(perClip.a[0] - perClip.b[0]) > 0.05;
    const restored = Math.abs(perClip.a[0] - perClip.c[0]) < 2e-3;
    checks.check(differs && restored, `an input color space set on one clip changes only that clip (${JSON.stringify(perClip)})`);

    checks.check(Math.abs(rec709Decode(rec709Encode(0.3)) - 0.3) < 1e-9, 'reference curves are self-consistent');
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
