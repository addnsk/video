import { Editor, fixture } from '../harness.mjs';
import { allPairs } from '../lib/pairwise.mjs';
import { compareWithExport, exportProres, maxDifference, sampleProbes } from '../lib/parity.mjs';
import { rng } from '../lib/random-project.mjs';

const FACTORS = {
  space: ['rec709', 'slog3', 'bmdFilmGen5', 'rec2020Pq'],
  science: ['display', 'aces'],
  node: ['none', 'blur', 'text', 'mask', 'temporal-denoise', 'film-grain', 'lens'],
  speed: [0.5, 1, 2],
  transition: ['none', 'dissolve'],
  cache: ['on', 'off'],
  track: ['main', 'overlay'],
};

const NODE_CODE = {
  none: '',
  blur: `const n = montage.graph.add(ref, 'blur', { radius: 7 }); montage.graph.connect(ref, 'source', n); montage.graph.connect(ref, n, 'output');`,
  text: `const t = montage.graph.add(ref, 'text', { text: 'PAIR', size: 0.2, outlineWidth: 0.06, progress: 0.7 }); const m = montage.graph.add(ref, 'merge'); montage.graph.connect(ref, 'source', m, 'background'); montage.graph.connect(ref, t, m, 'foreground'); montage.graph.connect(ref, m, 'output');`,
  mask: `const k = montage.graph.add(ref, 'bezier-mask', { feather: 0.03 }); const b = montage.graph.add(ref, 'background', { color: [0.2, 0.4, 0.9, 1] }); const m = montage.graph.add(ref, 'merge'); montage.graph.connect(ref, b, m, 'background'); montage.graph.connect(ref, 'source', m, 'foreground'); montage.graph.connect(ref, k, m, 'mask'); montage.graph.connect(ref, m, 'output');`,
  'temporal-denoise': `const n = montage.graph.add(ref, 'temporal-denoise', { strength: 0.6 }); montage.graph.connect(ref, 'source', n); montage.graph.connect(ref, n, 'output');`,
  'film-grain': `const n = montage.graph.add(ref, 'film-grain', { amount: 0.06 }); montage.graph.connect(ref, 'source', n); montage.graph.connect(ref, n, 'output');`,
  lens: `const n = montage.graph.add(ref, 'lens-distortion', { k1: 0.15, dispersion: 0.01 }); montage.graph.connect(ref, 'source', n); montage.graph.connect(ref, n, 'output');`,
};

export default {
  name: 'pairwise',
  tags: ['export'],
  async run({ browser, url, checks }) {
    const rows = allPairs(FACTORS);
    const editor = await Editor.open(browser, url, { viewport: { width: 1000, height: 700 } });
    await editor.import([fixture('prores-1080-10s.mov'), fixture('moving.mov'), fixture('red.mov')]);
    const failures = [];
    let worstExport = 0;
    for (const [index, row] of rows.entries()) {
      const tag = `row ${index} ${JSON.stringify(row)}`;
      try {
        await editor.run(new Function('row', `return (async () => {
          const [hd, moving, red] = montage.assets();
          montage.colorScience('display');
          montage.clear();
          for (const t of montage.tracks()) if (t.kind === 'video' && !t.magnetic) for (const c of montage.clips(t.id)) montage.remove(c.id);
          montage.add(red.id, { in: 0, out: 1.2 });
          montage.add(moving.id, { in: 0, out: 1 });
          montage.colorSpace({ asset: moving.id }, row.space);
          let ref = 1;
          if (row.track === 'overlay') {
            const v2 = montage.tracks().find((t) => t.kind === 'video' && !t.magnetic).id;
            const c = montage.add(hd.id, { track: v2, start: 0.3, in: 0, out: 1.5 });
            montage.set(c.id, { transform: { scale: 0.5, x: 0.2 } });
            ref = c.id;
          }
          montage.speed(ref, row.speed);
          if (row.transition === 'dissolve') montage.transition(1, { type: 'dissolve', duration: 0.3 });
          ${'${NODE}'}
          montage.colorScience(row.science);
          montage.renderCache(row.cache === 'on');
        })()`.replace('${NODE}', NODE_CODE[row.node])), row);
        const { duration, fps, size } = await editor.run(async () => ({ duration: montage.duration, fps: montage.project().settings.fps, size: (await montage.stats()).previewSize }));
        const r = rng(index + 11);
        const probes = Array.from({ length: 3 }, () => ({
          time: Math.floor(r() * (duration - 0.1) * fps) / fps,
          points: Array.from({ length: 5 }, () => ({ x: +(r() * 0.8 - 0.4).toFixed(3), y: +(r() * 0.8 - 0.4).toFixed(3) })),
        }));
        const a = await sampleProbes(editor, probes);
        const b = await sampleProbes(editor, probes);
        if (maxDifference(a, b) > 0 && row.node !== 'temporal-denoise') failures.push(`${tag}: not deterministic`);
        if (row.node !== 'temporal-denoise') {
          const path = await exportProres(editor, size.height);
          const { worst, notes } = await compareWithExport(editor, path, size, fps, probes);
          worstExport = Math.max(worstExport, worst);
          if (worst > (row.node === 'film-grain' ? 0.035 : 0.02)) failures.push(`${tag}: export differs ${notes.slice(0, 2).join('; ')}`);
        }
        if (row.cache === 'on') {
          await editor.seekAndSettle(probes[0].time, 500);
          const first = await editor.previewColor({ x: 0.5, y: 0.5, size: 0.3 });
          await editor.seekAndSettle(0.02, 200);
          await editor.seekAndSettle(probes[0].time, 500);
          const second = await editor.previewColor({ x: 0.5, y: 0.5, size: 0.3 });
          if (Math.max(...first.map((v, i) => Math.abs(v - second[i]))) > 2) failures.push(`${tag}: cached frame differs`);
        }
      } catch (error) {
        failures.push(`${tag}: ${error.message.split('\n')[0]}`);
      }
    }
    checks.check(!failures.length, `all ${rows.length} pairwise combinations render deterministically, match the export (worst ${worstExport.toFixed(4)}) and the cache${failures.length ? `; ${failures.slice(0, 4).join(' || ')}` : ''}`);
    checks.check(editor.errors.length === 0, `no page errors ${editor.errors.join('; ')}`);
    await editor.close();
  },
};
