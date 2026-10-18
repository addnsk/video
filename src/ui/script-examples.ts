export interface ScriptExample {
  readonly name: string;
  readonly code: string;
}

export const EXAMPLES: readonly ScriptExample[] = [
  {
    name: 'List clips',
    code: `for (const c of montage.clips()) {
  log(\`\${c.index}. \${c.name}  start \${c.start.toFixed(2)}s  length \${c.duration.toFixed(2)}s\`,
      c.transition ? \`← \${c.transition.type}\` : '');
}
log('Total:', montage.duration.toFixed(2), 's');`,
  },
  {
    name: 'Split every 2 seconds',
    code: `const step = 2;
for (let t = step; t < montage.duration; t += step) montage.split(t);
log('Clips now:', montage.clips().length);`,
  },
  {
    name: 'Jump cut: drop every second clip',
    code: `montage.clips()
  .filter((c) => c.index % 2 === 1)
  .forEach((c) => montage.remove(c.id));
log('Clips left:', montage.clips().length);`,
  },
  {
    name: 'Dissolve on every cut',
    code: `for (const c of montage.clips().slice(1)) montage.transition(c.id, { type: 'dissolve', duration: 0.5 });
log('Transitions:', montage.transitions.list().map((t) => t.id).join(', '));`,
  },
  {
    name: 'Blackmagic Film → Rec.709 on everything',
    code: `montage.grade('all', {
  inputTransform: 'bmdFilmGen5',
  contrast: 1.1,
  saturation: 1.05,
  temperature: 0.08,
  lift: { master: -0.02 },
  gain: { x: 0.03, y: -0.02 },
});
log('Graded clips:', montage.clips().length);`,
  },
  {
    name: 'Custom transition (GLSL)',
    code: `montage.transitions.register({
  id: 'pixelize',
  name: 'Pixelize',
  glsl: \`
uniform float steps; // = 30.0
vec4 transition(vec2 uv) {
  float d = min(progress, 1.0 - progress);
  float size = max(1.0, ceil(d * steps)) / 400.0;
  vec2 p = d > 0.0 ? (floor(uv / size) + 0.5) * size : uv;
  return mix(getFromColor(p), getToColor(p), progress);
}\`,
});
for (const c of montage.clips().slice(1)) montage.transition(c.id, { type: 'pixelize', duration: 1 });
log('Pixelize on', montage.clips().length - 1, 'cuts');`,
  },
  {
    name: 'Custom effect (GLSL)',
    code: `montage.effects.register({
  id: 'vignette',
  name: 'Vignette',
  params: [{ name: 'amount', label: 'Amount', type: 'float', default: 0.5, min: 0, max: 1 }],
  glsl: \`
vec4 effect(vec4 color, vec2 uv) {
  float d = distance(uv, vec2(0.5));
  return vec4(color.rgb * (1.0 - amount * smoothstep(0.3, 0.8, d)), color.a);
}\`,
});
montage.effect('all', 'vignette', { amount: 0.6 });
log('Vignette applied');`,
  },
  {
    name: 'Render 720p',
    code: `const result = await montage.render({
  height: 720,
  quality: 'medium',
  onProgress: (f) => { if (Math.round(f * 100) % 25 === 0) log(Math.round(f * 100) + '%'); },
});
log('Saved:', result.name, result.file ? (result.file.size / 1048576).toFixed(1) + ' MB' : 'to disk');`,
  },
  {
    name: 'Engine memory stats',
    code: `const stats = await montage.stats();
log(stats.budget.deviceClass, 'cache', (stats.frameCacheBytes / 1048576).toFixed(1), 'MB');
for (const [kind, s] of Object.entries(stats.resources)) log(kind, 'live', s.live, 'peak', s.peak, (s.bytes / 1048576).toFixed(1), 'MB');`,
  },
  {
    name: 'Animated lower third',
    code: `const title = montage.title('Name Surname', { start: montage.time, duration: 4, size: 0.06, background: '#000000b3' });
montage.set(title.id, { transform: { y: 0.32 } });
montage.animate(title.id, 'in', 'rise');
montage.animate(title.id, 'out', 'fade-out');
log('Title at', title.start.toFixed(2), 's');`,
  },
  {
    name: 'Voice cleanup on every clip',
    code: `montage.audioEffect('all', 'highpass', { cutoff: 90 });
montage.audioEffect('all', 'eq', { low: -2, mid: 1.5, high: 3 });
montage.audioEffect('all', 'compressor', { threshold: -22, ratio: 3, makeup: 4 });
log('Audio chain applied to', montage.clips().length, 'clips');`,
  },
];
