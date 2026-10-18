import { Editor, fixture } from '../harness.mjs';

const CANONICAL = `const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v; const p = montage.project(); delete p.stills; return JSON.stringify(canon(p));`;

const STEPS = [
  ['enable graph', () => montage.graph.enable(0)],
  ['add node', () => { window.__n = montage.graph.add(0, 'blur', { radius: 4 }); }],
  ['connect', () => montage.batch(() => { montage.graph.connect(0, 'source', window.__n); montage.graph.connect(0, window.__n, 'output'); })],
  ['set params', () => montage.graph.set(0, window.__n, { radius: 9 })],
  ['node keyframe', () => montage.graph.keyframe(0, window.__n, 'radius', 0.5, 2)],
  ['move node', () => montage.graph.move(0, window.__n, [300, 200])],
  ['toggle node', () => montage.graph.toggle(0, window.__n, false)],
  ['insert template', () => { montage.graph.insert(0, montage.graph.template(0, [window.__n], 'T')); }],
  ['remove node', () => montage.graph.remove(0, window.__n)],
  ['color science', () => montage.colorScience('aces')],
  ['input color space', () => montage.colorSpace(0, 'vlog')],
  ['color filter', () => montage.effect(0, 'hdr-wheels', { global: [0, 0, 0.2] })],
  ['save version', () => montage.versions.save(0, 'A')],
  ['change and save another', () => montage.batch(() => { montage.grade(0, { exposure: 0.5 }); montage.versions.save(0, 'B'); })],
  ['load version', () => montage.versions.load(0, 'A')],
  ['remove version', () => montage.versions.remove(0, 'B')],
  ['bezier mask', () => { window.__m = montage.graph.add(0, 'bezier-mask'); }],
  ['mask point keyframe', () => montage.graph.keyframe(0, window.__m, 'points.6', 1, 0.4)],
  ['split with graph and versions', () => montage.split(1)],
];

export default {
  name: 'undo',
  async run({ browser, url, checks }) {
    const editor = await Editor.open(browser, url);
    await editor.import([fixture('gray.mov')]);
    const snapshot = () => editor.run(new Function(CANONICAL));
    const failures = [];
    for (const [name, step] of STEPS) {
      const before = await snapshot();
      await editor.run(step);
      await editor.settle(50);
      const after = await snapshot();
      if (after === before) {
        failures.push(`${name}: no change`);
        continue;
      }
      await editor.run(() => montage.undo());
      if ((await snapshot()) !== before) failures.push(`${name}: undo does not restore`);
      await editor.run(() => montage.redo());
      if ((await snapshot()) !== after) failures.push(`${name}: redo does not reapply`);
    }
    checks.check(!failures.length, `every new edit is one undo step that undoes and redoes exactly (${STEPS.length} edits${failures.length ? `; ${failures.join('; ')}` : ''})`);

    const start = await snapshot();
    const tracked = await editor.run(async () => {
      const id = montage.graph.add(0, 'ellipse-mask');
      return id;
    });
    const beforeTrack = await snapshot();
    await editor.run((id) => montage.track(0, { x: 0, y: 0, to: 0.4, apply: { node: id, param: 'center' } }), tracked);
    await editor.run(() => montage.undo());
    checks.check((await snapshot()) === beforeTrack, 'applying a track is a single undo step');
    await editor.run(() => montage.undo());
    checks.check((await snapshot()) === start, 'undo walks back past the tracked node');
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
