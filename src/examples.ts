// Примеры для панели «Скрипт». Тело async-функции: доступны montage и log.

export const EXAMPLES: { name: string; code: string }[] = [
  {
    name: 'Что на таймлайне',
    code: `// Список клипов: где стоят, сколько длятся, какой переход
for (const c of montage.clips()) {
  log(\`\${c.index}. \${c.name}  старт \${c.start.toFixed(2)} с, длина \${c.duration.toFixed(2)} с\`,
      c.transition ? \`← \${c.transition.type}\` : '');
}
log('Всего:', montage.duration.toFixed(2), 'с');`,
  },
  {
    name: 'Нарезать каждые 2 секунды',
    code: `// Режет таймлайн на куски по 2 секунды (один шаг отмены)
const step = 2;
for (let t = step; t < montage.duration; t += step) montage.split(t);
log('Клипов теперь:', montage.clips().length);`,
  },
  {
    name: 'Удалить каждый второй кусок',
    code: `// Оставляет 1-й, 3-й, 5-й... клипы — быстрый «джамп-кат»
const ids = montage.clips().map((c) => c.id);
ids.forEach((id, i) => { if (i % 2 === 1) montage.remove(id); });
log('Осталось клипов:', montage.clips().length);`,
  },
  {
    name: 'Переходы между всеми клипами',
    code: `// Растворение по 0.5 с на каждом стыке
const clips = montage.clips();
for (const c of clips.slice(1)) montage.transition(c.id, { type: 'dissolve', duration: 0.5 });
log('Доступные переходы:', montage.transitions.list().map((t) => t.id).join(', '));`,
  },
  {
    name: 'Blackmagic Film → Rec.709 на всё',
    code: `// Снимает лог со всех клипов и добавляет лёгкий тёплый образ
montage.grade('all', {
  input: 'bmdFilmGen5',
  contrast: 1.1,
  saturation: 1.05,
  temperature: 0.08,
  lift: { master: -0.02 },
  gain: { x: 0.03, y: -0.02 },
});
log('Покрашено клипов:', montage.clips().length);`,
  },
  {
    name: 'Свой переход (GLSL)',
    code: `// Регистрируем переход в формате gl-transitions и ставим на все стыки.
// Сюда можно вставить любой переход с gl-transitions.com как есть.
montage.transitions.register({
  id: 'pixelize',
  name: 'Пикселизация',
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
log('Готово: переход «Пикселизация» на', montage.clips().length - 1, 'стыках');`,
  },
  {
    name: 'Экспорт 720p',
    code: `// Рендер прямо из скрипта. render() возвращает Blob с MP4.
const blob = await montage.render({
  height: 720,
  quality: 'medium',
  onProgress: (f) => { if (Math.round(f * 100) % 25 === 0) log(Math.round(f * 100) + '%'); },
});
log('MP4:', (blob.size / 1048576).toFixed(1), 'МБ');`,
  },
];
