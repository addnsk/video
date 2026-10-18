export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NODES = [
  ['blur', (r) => ({ radius: 1 + r() * 12 })],
  ['invert', () => ({})],
  ['grade', (r) => ({ exposure: r() * 2 - 1, saturation: r() * 2 })],
  ['transform', (r) => ({ offset: [r() * 0.4 - 0.2, r() * 0.4 - 0.2], scale: 0.5 + r(), rotation: r() * 90 - 45 })],
  ['vignette', (r) => ({ amount: r() })],
  ['sharpen', (r) => ({ amount: r() * 2 })],
  ['lens-distortion', (r) => ({ k1: r() * 0.4 - 0.2 })],
  ['letterbox', () => ({ ratio: 2.39 })],
  ['denoise', () => ({})],
  ['film-grain', (r) => ({ amount: r() * 0.1 })],
  ['color-warper', (r) => ({ red: [r() - 0.5, r() - 0.5, 0] })],
  ['curves', (r) => ({ master: [0, 0, 0.5, 0.3 + r() * 0.4, 1, 1] })],
  ['hdr-wheels', (r) => ({ global: [r() * 0.2 - 0.1, r() * 0.2 - 0.1, r() * 0.4 - 0.2] })],
];

export function randomPlan(seed, assetCount) {
  const r = rng(seed);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const steps = [];
  const clips = 3 + Math.floor(r() * 4);
  steps.push(`montage.clear();`);
  for (let i = 0; i < clips; i++) {
    const a = Math.floor(r() * assetCount);
    steps.push(`{ const a = montage.assets().filter((x) => x.hasVideo)[${a}]; const span = Math.min(a.end, 0.6 + ${r().toFixed(3)} * 2); montage.add(a.id, { in: 0, out: span }); }`);
  }
  for (let i = 0; i < clips; i++) {
    if (r() < 0.4) steps.push(`montage.speed(${i}, ${pick([0.5, 1.5, 2])});`);
    if (r() < 0.5) steps.push(`montage.grade(${i}, { exposure: ${(r() - 0.5).toFixed(3)}, contrast: ${(0.8 + r() * 0.5).toFixed(3)}, lift: [${(r() * 0.1 - 0.05).toFixed(3)}, 0, 0] });`);
    if (i > 0 && r() < 0.4) steps.push(`montage.transition(${i}, { type: 'dissolve', duration: ${(0.1 + r() * 0.3).toFixed(3)} });`);
    if (r() < 0.4) steps.push(`montage.keyframe(${i}, 'scale', 0, ${(0.6 + r()).toFixed(3)}); montage.keyframe(${i}, 'scale', 0.5, ${(0.6 + r()).toFixed(3)});`);
    if (r() < 0.6) {
      const count = 1 + Math.floor(r() * 3);
      let code = `{ montage.graph.enable(${i}); let last = 'source'; montage.graph.disconnect(${i}, 'output');`;
      for (let k = 0; k < count; k++) {
        const [type, params] = pick(NODES);
        code += ` { const id = montage.graph.add(${i}, '${type}', ${JSON.stringify(params(r))}); montage.graph.connect(${i}, last, id); last = id; }`;
      }
      if (r() < 0.4) code += ` { const m = montage.graph.add(${i}, 'ellipse-mask', { size: [${(0.3 + r() * 0.5).toFixed(3)}, 0.6], softness: 0.05 }); const bg = montage.graph.add(${i}, 'background', { color: [${r().toFixed(2)}, ${r().toFixed(2)}, ${r().toFixed(2)}, 1] }); const merge = montage.graph.add(${i}, 'merge'); montage.graph.connect(${i}, bg, merge, 'background'); montage.graph.connect(${i}, last, merge, 'foreground'); montage.graph.connect(${i}, m, merge, 'mask'); last = merge; }`;
      if (r() < 0.3) code += ` { const t = montage.graph.add(${i}, 'text', { text: 'R${seed}', size: 0.12, outlineWidth: 0.05 }); const merge = montage.graph.add(${i}, 'merge'); montage.graph.connect(${i}, last, merge, 'background'); montage.graph.connect(${i}, t, merge, 'foreground'); last = merge; }`;
      code += ` montage.graph.connect(${i}, last, 'output'); }`;
      steps.push(code);
    }
  }
  if (r() < 0.5) steps.push(`{ const a = montage.assets().find((x) => x.hasVideo); const t = montage.addTrack('video'); montage.add(a.id, { track: t, start: ${(r() * 2).toFixed(3)}, in: 0, out: 1 }); }`);
  if (r() < 0.4) steps.push(`montage.colorScience('aces');`);
  return steps;
}
