import { Editor, fixture } from '../harness.mjs';

const close = (a, b, tolerance) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
const fmt = (v) => v.map((x) => x.toFixed(3)).join(',');
const BG = [0.6, 0.4, 0.2];
const FG = [0.3, 0.5, 0.9];
const blend = {
  normal: (b, f) => f,
  add: (b, f) => b + f,
  screen: (b, f) => 1 - (1 - b) * (1 - f),
  multiply: (b, f) => b * f,
  overlay: (b, f) => (b < 0.5 ? 2 * b * f : 1 - 2 * (1 - b) * (1 - f)),
  difference: (b, f) => Math.abs(b - f),
  lighten: Math.max,
  darken: Math.min,
};

export default {
  name: 'node-math',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('gray.mov')]);
    const float = await editor.run(async () => (await montage.stats()).floatTargets);
    const tol = float ? 2e-3 : 3 / 255;
    await editor.run(() => montage.renderCache(false));

    const graph = (nodes, links, points) =>
      editor.run(async ({ nodes, links, points }) => {
        montage.graph.enable(0);
        for (const n of montage.graph.get(0).nodes) if (n.id !== 'source' && n.id !== 'output') montage.graph.remove(0, n.id);
        const ids = { source: 'source', output: 'output' };
        for (const [key, type, params] of nodes) ids[key] = montage.graph.add(0, type, params ?? {});
        for (const [from, to, input] of links) montage.graph.connect(0, ids[from], ids[to], input);
        return (await montage.sample(points, 0.5)).map((v) => v.slice(0, 4));
      }, { nodes, links, points });
    const at = (x, y = 0) => ({ x, y });
    const failures = [];
    const expect = (name, actual, expected, t = tol) => {
      if (!close(actual, expected, t)) failures.push(`${name}: got ${fmt(actual)} expected ${fmt(expected)}`);
    };
    const report = (label) => {
      checks.check(!failures.length, `${label}${failures.length ? `: ${failures.slice(0, 5).join('; ')}` : ''}`);
      failures.length = 0;
    };

    for (const [mode, fn] of Object.entries(blend)) {
      const [c] = await graph(
        [['b', 'background', { color: [...BG, 1] }], ['f', 'background', { color: [...FG, 1] }], ['m', 'merge', { mode }]],
        [['b', 'm', 'background'], ['f', 'm', 'foreground'], ['m', 'output']],
        [at(0)],
      );
      expect(`merge ${mode}`, c.slice(0, 3), BG.map((b, i) => fn(b, FG[i])));
    }
    const [half] = await graph(
      [['b', 'background', { color: [...BG, 1] }], ['f', 'background', { color: [...FG, 1] }], ['m', 'merge', { opacity: 0.25 }]],
      [['b', 'm', 'background'], ['f', 'm', 'foreground'], ['m', 'output']],
      [at(0)],
    );
    expect('merge opacity 0.25', half.slice(0, 3), BG.map((b, i) => b * 0.75 + FG[i] * 0.25));
    const [inMask, outMask] = await graph(
      [['b', 'background', { color: [...BG, 1] }], ['f', 'background', { color: [...FG, 1] }], ['k', 'rectangle-mask', { size: [0.5, 0.5], softness: 0 }], ['m', 'merge']],
      [['b', 'm', 'background'], ['f', 'm', 'foreground'], ['k', 'm', 'mask'], ['m', 'output']],
      [at(0), at(0.4)],
    );
    expect('merge mask inside', inMask.slice(0, 3), FG);
    expect('merge mask outside', outMask.slice(0, 3), BG);
    report('merge modes, opacity and mask match the blend formulas');

    const rect = await graph([['r', 'rectangle-mask', { size: [0.5, 0.4], softness: 0 }]], [['r', 'output']], [at(0.24, 0), at(0.26, 0), at(0, 0.19), at(0, 0.21)]);
    expect('rectangle edges', rect.map((v) => v[3]), [1, 0, 1, 0]);
    const ellipse = await graph([['e', 'ellipse-mask', { size: [0.5, 0.5], softness: 0, center: [0.1, 0.1] }]], [['e', 'output']], [at(0.1, 0.1), at(0.33, 0.1), at(0.37, 0.1), at(0.1, 0.33), at(0.1, 0.37)]);
    expect('ellipse center and radius', ellipse.map((v) => v[3]), [1, 1, 0, 1, 0]);
    const inverted = await graph([['e', 'ellipse-mask', { size: [0.5, 0.5], softness: 0, invert: true }]], [['e', 'output']], [at(0), at(0.45)]);
    expect('ellipse invert', inverted.map((v) => v[3]), [0, 1]);
    const polygon = await graph(
      [['p', 'polygon-mask', { points: [-0.3, -0.3, 0.3, -0.3, 0, 0.3], spline: false, feather: 0 }]],
      [['p', 'output']],
      [at(0, 0), at(0, -0.25), at(0.25, 0.2), at(-0.25, 0.2), at(0, 0.35)],
    );
    expect('triangle polygon', polygon.map((v) => v[3]), [1, 1, 0, 0, 0]);
    const combine = async (mode) =>
      (await graph(
        [['a', 'rectangle-mask', { size: [0.4, 0.4], center: [-0.1, 0], softness: 0 }], ['b', 'rectangle-mask', { size: [0.4, 0.4], center: [0.1, 0], softness: 0 }], ['c', 'mask-combine', { mode }]],
        [['a', 'c', 'a'], ['b', 'c', 'b'], ['c', 'output']],
        [at(-0.25), at(0), at(0.25), at(0.45)],
      )).map((v) => v[3]);
    expect('mask union', await combine('union'), [1, 1, 1, 0]);
    expect('mask intersect', await combine('intersect'), [0, 1, 0, 0]);
    expect('mask subtract', await combine('subtract'), [1, 0, 0, 0]);
    expect('mask difference', await combine('difference'), [1, 0, 1, 0]);
    report('mask shapes and mask operations cover the right areas');

    const moved = await graph(
      [['r', 'rectangle-mask', { size: [0.1, 0.1], softness: 0 }], ['t', 'transform', { offset: [0.25, 0.2] }]],
      [['r', 't'], ['t', 'output']],
      [at(0.25, 0.2), at(0, 0)],
    );
    expect('transform offset', moved.map((v) => v[3]), [1, 0]);
    const scaled = await graph(
      [['r', 'rectangle-mask', { size: [0.2, 0.2], softness: 0 }], ['t', 'transform', { scale: 2 }]],
      [['r', 't'], ['t', 'output']],
      [at(0.18, 0), at(0.22, 0)],
    );
    expect('transform scale', scaled.map((v) => v[3]), [1, 0]);
    const cropped = await graph([['b', 'background', { color: [1, 1, 1, 1] }], ['c', 'crop', { left: 0.25, top: 0.1 }]], [['b', 'c'], ['c', 'output']], [at(-0.27, 0), at(-0.23, 0), at(0, -0.42), at(0, -0.38)]);
    expect('crop left and top', cropped.map((v) => v[3]), [0, 1, 0, 1]);
    const bars = await graph([['b', 'background', { color: [1, 1, 1, 1] }], ['l', 'letterbox', { ratio: 2.39 }]], [['b', 'l'], ['l', 'output']], [at(0, -0.5 + 0.12), at(0, -0.5 + 0.13)]);
    const bar = (1 - 16 / 9 / 2.39) / 2;
    expect('letterbox bar height', bars.map((v) => v[0]), [0.12 < bar ? 0 : 1, 0.13 < bar ? 0 : 1]);
    const pinned = await graph(
      [['r', 'rectangle-mask', { size: [1, 1], softness: 0 }], ['p', 'corner-pin', { topLeft: [0, 0], topRight: [0.5, 0], bottomRight: [0.5, 0.5], bottomLeft: [0, 0.5] }]],
      [['r', 'p'], ['p', 'output']],
      [at(0.25, 0.25), at(-0.1, 0.25), at(0.25, -0.1)],
    );
    expect('corner pin quad', pinned.map((v) => v[3]), [1, 0, 0]);
    const grad = await graph([['g', 'gradient', { from: [0, 0, 0, 1], to: [1, 1, 1, 1] }]], [['g', 'output']], [at(-0.25), at(0), at(0.25)]);
    expect('linear gradient spans the frame width', grad.map((v) => v[0]), [0.25, 0.5, 0.75], 0.01);
    report('transform, crop, letterbox, corner pin and gradient place pixels where expected');

    const flat = async (type, params = {}) => (await graph([['b', 'background', { color: [...BG, 1] }], ['n', type, params]], [['b', 'n'], ['n', 'output']], [at(0.1, 0.1)]))[0].slice(0, 3);
    for (const [type, params] of [['blur', { radius: 10 }], ['glow', {}], ['sharpen', { amount: 2 }], ['denoise', {}], ['directional-blur', { blurLength: 30 }], ['radial-blur', { amount: 0.3 }], ['lens-distortion', { k1: 0, k2: 0 }], ['vignette', { amount: 0 }], ['matte', { choke: 4, feather: 4 }], ['film-grain', { amount: 0 }], ['color-warper', {}], ['displace', {}]]) {
      expect(`${type} keeps a flat color`, await flat(type, params), BG, type === 'glow' ? 1 : tol);
    }
    expect('invert', await flat('invert'), BG.map((v) => 1 - v));
    report('filters keep a flat field flat (blur, sharpen, denoise, distortions at rest)');

    const keyed = async (rgb) => (await graph([['b', 'background', { color: [...rgb, 1] }], ['k', 'keyer', {}]], [['b', 'k'], ['k', 'output']], [at(0)]))[0][3];
    expect('keyer removes the key color', [await keyed([0, 1, 0])], [0]);
    expect('keyer keeps other colors', [await keyed([0.8, 0.2, 0.2])], [1]);
    const luma = async (v) => (await graph([['b', 'background', { color: [v, v, v, 1] }], ['k', 'luma-key', { low: 0, high: 0.3, softness: 0.001 }]], [['b', 'k'], ['k', 'output']], [at(0)]))[0][3];
    expect('luma key', [await luma(0.1), await luma(0.6)], [0, 1]);
    const mix = await graph(
      [['a', 'background', { color: [1, 0, 0, 1] }], ['b', 'background', { color: [0, 0, 1, 1] }], ['m', 'parallel-mixer', { weightA: 3, weightB: 1 }]],
      [['a', 'm', 'a'], ['b', 'm', 'b'], ['m', 'output']],
      [at(0)],
    );
    expect('parallel mixer weights', mix[0].slice(0, 3), [0.75, 0, 0.25]);
    const noise = await graph([['n', 'noise', { low: [0.2, 0.2, 0.2, 1], high: [0.4, 0.4, 0.4, 1] }]], [['n', 'output']], [at(-0.3, -0.3), at(0, 0), at(0.3, 0.2)]);
    if (!noise.every((v) => v[0] >= 0.2 - tol && v[0] <= 0.4 + tol)) failures.push(`noise outside its range: ${noise.map((v) => v[0].toFixed(3))}`);
    report('keyers, mixer and noise produce the expected values');
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
