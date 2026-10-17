import './style.css';
import { Project, type Asset } from './project';
import { Renderer } from './renderer';
import { Player } from './player';
import { Timeline, formatTime } from './timeline';
import { loadAsset } from './media';
import { exportProject } from './exporter';
import { type Grade, type Wheel, defaultGrade, cloneGrade, parseCube, wheelToRgb } from './grade';
import { createApi, runScript } from './api';
import { listTransitions, getTransition, onTransitionsChange } from './transitions';
import { EXAMPLES } from './examples';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

document.querySelector('#app')!.innerHTML = `
  <header class="bar">
    <div class="brand">Монтажка<small>ProRes · покраска · в браузере</small></div>
    <button class="btn" id="import">Импорт</button>
    <button class="btn primary" id="export" disabled>Экспорт</button>
    <input type="file" id="file" accept="video/*,.mov,.mp4,.mkv,.webm,.mxf" multiple hidden>
    <input type="file" id="lut-file" accept=".cube" hidden>
  </header>
  <section class="viewer">
    <div class="screen">
      <canvas id="preview"></canvas>
      <div class="info" id="info"></div>
      <div class="ab" id="ab" hidden>ДО</div>
      <div class="empty" id="empty">
        <strong>Перетащите сюда видео или нажмите «Импорт»</strong>
        <span>ProRes с Blackmagic, H.264, HEVC. Файлы не покидают устройство.</span>
      </div>
    </div>
    <div class="transport">
      <button class="btn icon" id="play" title="Пробел" aria-label="Воспроизвести">▶</button>
      <div class="tc" id="tc">00:00:00:00 <span>/ 00:00:00:00</span></div>
      <div class="spacer"></div>
      <button class="btn" id="split" title="S">Разрезать</button>
      <button class="btn" id="delete" title="Delete">Удалить</button>
      <button class="btn" id="bypass" aria-pressed="false" title="B — сравнить с исходником">До/после</button>
      <button class="btn icon" id="zoom-out" aria-label="Уменьшить масштаб">−</button>
      <button class="btn icon" id="zoom-fit" aria-label="Весь таймлайн">⤢</button>
      <button class="btn icon" id="zoom-in" aria-label="Увеличить масштаб">+</button>
    </div>
  </section>
  <section class="timeline"><canvas id="timeline"></canvas></section>
  <aside class="inspector">
    <div class="group" id="trans">
      <h2>Переход в клип</h2>
      <p class="hint" id="trans-hint">Выберите второй или следующий клип.</p>
      <select id="trans-type" aria-label="Тип перехода"></select>
      <div id="trans-params" class="group"></div>
    </div>
    <div class="group" id="color">
      <h2>Цвет клипа</h2>
      <p class="hint" id="color-hint">Выберите клип на таймлайне.</p>
      <label class="field">Входное преобразование
        <select id="input-transform">
          <option value="none">Нет (Rec.709 / Video)</option>
          <option value="bmdFilmGen5">Blackmagic Film Gen 5 → Rec.709</option>
        </select>
      </label>
      <div class="wheels" id="wheels"></div>
      <div id="sliders" class="group"></div>
      <h2>LUT</h2>
      <div class="lut-name" id="lut-name">Не загружен</div>
      <div class="row">
        <button class="btn" id="lut-load">Загрузить .cube</button>
        <button class="btn" id="lut-clear">Убрать</button>
      </div>
      <div id="lut-mix"></div>
      <div class="row">
        <button class="btn" id="grade-reset">Сбросить</button>
        <button class="btn" id="grade-all">На все клипы</button>
      </div>
    </div>
    <div class="group">
      <h2>Медиа</h2>
      <div class="media" id="media"><p class="hint">Пока пусто.</p></div>
    </div>
    <div class="group" id="script">
      <h2>Скрипт</h2>
      <select id="script-example" aria-label="Примеры скриптов"></select>
      <textarea id="script-code" spellcheck="false" rows="10" aria-label="Код скрипта"></textarea>
      <div class="row">
        <button class="btn primary" id="script-run">Выполнить</button>
      </div>
      <pre class="log" id="script-log" hidden></pre>
      <p class="hint">Тот же API доступен в консоли браузера как <code>montage</code>. Ctrl+Enter — выполнить.</p>
    </div>
  </aside>
`;

const project = new Project();
const previewCanvas = $<HTMLCanvasElement>('#preview');
const renderer = new Renderer(previewCanvas);
const player = new Player(project, renderer, onTime);
const timeline = new Timeline($<HTMLCanvasElement>('#timeline'), project, player);
const api = createApi(project, player);
(window as unknown as { montage: typeof api }).montage = api;
renderer.onError = (m) => toast(m, true);

function onTime(t: number) {
  const fps = project.fps;
  $('#tc').innerHTML = `${formatTime(t, fps)} <span>/ ${formatTime(project.duration, fps)}</span>`;
  if (player.playing) timeline.follow(t);
  timeline.draw();
  $('#play').textContent = player.playing ? '❚❚' : '▶';
  $('#play').setAttribute('aria-label', player.playing ? 'Пауза' : 'Воспроизвести');
}

new ResizeObserver(() => {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  previewCanvas.width = Math.max(2, Math.round(previewCanvas.clientWidth * dpr));
  previewCanvas.height = Math.max(2, Math.round(previewCanvas.clientHeight * dpr));
  player.redraw();
}).observe(previewCanvas);

// ---------- сообщения ----------
let toastTimer = 0;
function toast(text: string, error = false) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), error ? 7000 : 3000);
}

// ---------- импорт ----------
async function importFiles(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    toast(`Открываю «${file.name}»…`);
    try {
      const asset = await loadAsset(file);
      project.assets.set(asset.id, asset);
      const first = project.clips.length === 0;
      project.checkpoint();
      project.addClip(asset);
      if (first) {
        timeline.fit();
        player.seek(0);
      }
      toast(`Добавлено: ${asset.name}`);
    } catch (e) {
      console.error(e);
      toast(e instanceof Error ? e.message : `Не удалось открыть «${file.name}».`, true);
    }
  }
}

$('#import').onclick = () => $<HTMLInputElement>('#file').click();
$<HTMLInputElement>('#file').onchange = (e) => {
  const input = e.target as HTMLInputElement;
  if (input.files) void importFiles(input.files);
  input.value = '';
};
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files.length) void importFiles(e.dataTransfer.files);
});

// ---------- транспорт ----------
$('#play').onclick = () => player.toggle();
$('#split').onclick = () => api.split(player.time);
$('#delete').onclick = () => project.selected && api.remove(project.selected);
$('#zoom-in').onclick = () => timeline.zoom(1.5);
$('#zoom-out').onclick = () => timeline.zoom(1 / 1.5);
$('#zoom-fit').onclick = () => timeline.fit();
$('#bypass').onclick = toggleBypass;

function toggleBypass() {
  player.bypass = !player.bypass;
  $('#bypass').setAttribute('aria-pressed', String(player.bypass));
  $('#ab').hidden = !player.bypass;
  player.redraw();
}

document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, select, textarea')) return;
  const frame = 1 / project.fps;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === 'KeyZ') (e.shiftKey ? project.redo() : project.undo());
  else if (mod && e.code === 'KeyY') project.redo();
  else if (mod) return;
  else if (e.code === 'Space') player.toggle();
  else if (e.code === 'KeyS') api.split(player.time);
  else if (e.key === 'Delete' || e.key === 'Backspace') project.selected && api.remove(project.selected);
  else if (e.key === 'ArrowLeft') player.seek(player.time - frame);
  else if (e.key === 'ArrowRight') player.seek(player.time + frame);
  else if (e.code === 'KeyB') toggleBypass();
  else return;
  e.preventDefault();
});

// ---------- покраска ----------
// Каждое касание панели — отдельный шаг отмены.
for (const id of ['#color', '#trans']) {
  $(id).addEventListener('pointerdown', () => project.checkpoint(), true);
  $(id).addEventListener('keydown', (e) => !e.repeat && project.checkpoint(), true);
}
const selectedGrade = (): Grade | null => project.selectedClip?.grade ?? null;

function gradeChanged() {
  if (!player.playing) player.redraw();
  timeline.draw();
}

interface SliderDef {
  key: 'exposure' | 'temperature' | 'tint' | 'contrast' | 'saturation';
  label: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
}
const SLIDERS: SliderDef[] = [
  { key: 'exposure', label: 'Экспозиция', min: -3, max: 3, step: 0.01, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}` },
  { key: 'temperature', label: 'Температура', min: -1, max: 1, step: 0.01, fmt: (v) => (v * 100).toFixed(0) },
  { key: 'tint', label: 'Оттенок', min: -1, max: 1, step: 0.01, fmt: (v) => (v * 100).toFixed(0) },
  { key: 'contrast', label: 'Контраст', min: 0.5, max: 2, step: 0.01, fmt: (v) => v.toFixed(2) },
  { key: 'saturation', label: 'Насыщенн.', min: 0, max: 2, step: 0.01, fmt: (v) => v.toFixed(2) },
];
const neutral = defaultGrade();

const sliderEls = SLIDERS.map((def) => {
  const row = document.createElement('label');
  row.className = 'slider';
  row.innerHTML = `<span>${def.label}</span><input type="range" id="g-${def.key}" min="${def.min}" max="${def.max}" step="${def.step}"><output></output>`;
  const input = $<HTMLInputElement>('input', row);
  const out = $<HTMLOutputElement>('output', row);
  const set = (v: number) => {
    const g = selectedGrade();
    if (!g) return;
    g[def.key] = v;
    input.value = String(v);
    out.textContent = def.fmt(v);
    gradeChanged();
  };
  input.oninput = () => set(+input.value);
  input.ondblclick = () => set(neutral[def.key]);
  $('#sliders').append(row);
  return { def, input, out };
});

const lutMixRow = document.createElement('label');
lutMixRow.className = 'slider';
lutMixRow.innerHTML = `<span>Сила LUT</span><input type="range" id="g-lutmix" min="0" max="1" step="0.01"><output></output>`;
$('#lut-mix').append(lutMixRow);
$<HTMLInputElement>('input', lutMixRow).oninput = (e) => {
  const g = selectedGrade();
  if (!g) return;
  g.lutMix = +(e.target as HTMLInputElement).value;
  $('output', lutMixRow).textContent = `${Math.round(g.lutMix * 100)}%`;
  gradeChanged();
};

type WheelKey = 'lift' | 'gamma' | 'gain';
const WHEELS: { key: WheelKey; label: string }[] = [
  { key: 'lift', label: 'Тени' },
  { key: 'gamma', label: 'Средние' },
  { key: 'gain', label: 'Света' },
];

const wheelEls = WHEELS.map(({ key, label }) => {
  const box = document.createElement('div');
  box.className = 'wheel';
  box.innerHTML = `<canvas width="192" height="192" aria-label="${label}: цветовой круг"></canvas><label for="w-${key}">${label}</label><input type="range" id="w-${key}" min="-0.5" max="0.5" step="0.005" aria-label="${label}: яркость">`;
  const canvas = $<HTMLCanvasElement>('canvas', box);
  const master = $<HTMLInputElement>('input', box);
  const wheel = (): Wheel | null => selectedGrade()?.[key] ?? null;

  const setFromPointer = (e: PointerEvent) => {
    const w = wheel();
    if (!w) return;
    const r = canvas.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width) * 2 - 1;
    let y = ((e.clientY - r.top) / r.height) * 2 - 1;
    const len = Math.hypot(x, y);
    if (len > 1) [x, y] = [x / len, y / len];
    // Точная работа: смещение в 4 раза меньше движения пальца.
    w.x = x * 0.25;
    w.y = y * 0.25;
    paint();
    gradeChanged();
  };
  canvas.onpointerdown = (e) => {
    canvas.setPointerCapture(e.pointerId);
    setFromPointer(e);
  };
  canvas.onpointermove = (e) => canvas.hasPointerCapture(e.pointerId) && setFromPointer(e);
  canvas.ondblclick = () => {
    const w = wheel();
    if (!w) return;
    w.x = w.y = 0;
    paint();
    gradeChanged();
  };
  master.oninput = () => {
    const w = wheel();
    if (!w) return;
    w.master = +master.value;
    gradeChanged();
  };
  master.ondblclick = () => {
    const w = wheel();
    if (!w) return;
    w.master = 0;
    master.value = '0';
    gradeChanged();
  };

  const g = canvas.getContext('2d')!;
  function paint() {
    const s = canvas.width;
    const c = s / 2;
    g.clearRect(0, 0, s, s);
    for (let a = 0; a < 360; a += 2) {
      const [r, gg, b] = wheelToRgb({ x: Math.cos((a * Math.PI) / 180), y: -Math.sin((a * Math.PI) / 180), master: 0 });
      g.strokeStyle = `rgb(${120 + r * 90} ${120 + gg * 90} ${120 + b * 90})`;
      g.lineWidth = 8;
      g.beginPath();
      g.arc(c, c, c - 6, (-a * Math.PI) / 180 - 0.02, (-(a + 2) * Math.PI) / 180, true);
      g.stroke();
    }
    g.fillStyle = '#16191d';
    g.beginPath();
    g.arc(c, c, c - 11, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2f343c';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(c, 14);
    g.lineTo(c, s - 14);
    g.moveTo(14, c);
    g.lineTo(s - 14, c);
    g.stroke();
    const w = wheel() ?? { x: 0, y: 0 };
    g.fillStyle = '#e9a23b';
    g.beginPath();
    g.arc(c + (w.x / 0.25) * (c - 14), c + (w.y / 0.25) * (c - 14), 7, 0, Math.PI * 2);
    g.fill();
  }
  $('#wheels').append(box);
  return { key, master, paint };
});

$<HTMLSelectElement>('#input-transform').onchange = (e) => {
  const g = selectedGrade();
  if (!g) return;
  g.input = (e.target as HTMLSelectElement).value as Grade['input'];
  gradeChanged();
};

$('#lut-load').onclick = () => $<HTMLInputElement>('#lut-file').click();
$<HTMLInputElement>('#lut-file').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  const g = selectedGrade();
  if (!file || !g) return;
  try {
    g.lut = parseCube(await file.text(), file.name);
    syncInspector();
    gradeChanged();
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Не удалось прочитать LUT.', true);
  }
};
$('#lut-clear').onclick = () => {
  const g = selectedGrade();
  if (!g) return;
  g.lut = null;
  syncInspector();
  gradeChanged();
};
$('#grade-reset').onclick = () => {
  const clip = project.selectedClip;
  if (!clip) return;
  clip.grade = defaultGrade();
  syncInspector();
  gradeChanged();
};
$('#grade-all').onclick = () => {
  const clip = project.selectedClip;
  if (!clip) return;
  for (const c of project.clips) if (c !== clip) c.grade = cloneGrade(clip.grade);
  toast(`Покраска применена к ${project.clips.length} клипам`);
  gradeChanged();
};

function syncInspector() {
  const g = selectedGrade();
  $('#color').setAttribute('aria-disabled', 'false');
  $('#color-hint').hidden = !!g;
  for (const el of document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('#color input, #color select, #color button')) {
    el.disabled = !g;
  }
  const v = g ?? neutral;
  $<HTMLSelectElement>('#input-transform').value = v.input;
  for (const { def, input, out } of sliderEls) {
    input.value = String(v[def.key]);
    out.textContent = def.fmt(v[def.key]);
  }
  for (const w of wheelEls) {
    w.master.value = String(v[w.key].master);
    w.paint();
  }
  $('#lut-name').textContent = v.lut ? `${v.lut.name} · ${v.lut.size}³` : 'Не загружен';
  $<HTMLInputElement>('input', lutMixRow).value = String(v.lutMix);
  $('output', lutMixRow).textContent = `${Math.round(v.lutMix * 100)}%`;
}

// ---------- переходы ----------
function fillTransitionTypes() {
  const sel = $<HTMLSelectElement>('#trans-type');
  sel.replaceChildren(new Option('Нет, склейка', ''), ...listTransitions().map((d) => new Option(d.name, d.id)));
}
fillTransitionTypes();
onTransitionsChange(fillTransitionTypes);

$<HTMLSelectElement>('#trans-type').onchange = (e) => {
  const clip = project.selectedClip;
  if (!clip) return;
  const type = (e.target as HTMLSelectElement).value;
  clip.transition = type ? { type, duration: clip.transition?.duration ?? 1, params: {} } : null;
  project.changed();
  const start = project.startOf(clip);
  player.seek(start + project.transitionLength(project.clips.indexOf(clip)) / 2);
};

function syncTransition() {
  const clip = project.selectedClip;
  const index = clip ? project.clips.indexOf(clip) : -1;
  const enabled = index > 0;
  $('#trans-hint').hidden = enabled;
  const sel = $<HTMLSelectElement>('#trans-type');
  sel.disabled = !enabled;
  sel.value = enabled ? (clip!.transition?.type ?? '') : '';
  const box = $('#trans-params');
  box.replaceChildren();
  if (!enabled || !clip!.transition) return;
  const tr = clip!.transition;
  const def = getTransition(tr.type);
  const rows: { label: string; min: number; max: number; step: number; get: () => number; set: (v: number) => void; fmt: (v: number) => string }[] = [
    {
      label: 'Длина', min: 0.1, max: 3, step: 0.05,
      get: () => tr.duration,
      set: (v) => (tr.duration = v),
      fmt: (v) => `${v.toFixed(2)} с`,
    },
  ];
  for (const p of def?.params ?? []) {
    if (p.type !== 'float') continue;
    const d = p.default as number;
    const max = d > 1 ? d * 2 : 1;
    rows.push({
      label: p.name, min: Math.min(0, d), max, step: max / 100,
      get: () => (tr.params[p.name] as number | undefined) ?? d,
      set: (v) => (tr.params[p.name] = v),
      fmt: (v) => v.toFixed(2),
    });
  }
  for (const r of rows) {
    const row = document.createElement('label');
    row.className = 'slider';
    row.innerHTML = `<span></span><input type="range" min="${r.min}" max="${r.max}" step="${r.step}"><output></output>`;
    $('span', row).textContent = r.label;
    const input = $<HTMLInputElement>('input', row);
    input.value = String(r.get());
    $('output', row).textContent = r.fmt(r.get());
    input.oninput = () => {
      r.set(+input.value);
      $('output', row).textContent = r.fmt(+input.value);
      timeline.draw();
      onTime(player.time);
      void player.showFrame(player.time);
    };
    box.append(row);
  }
}

// ---------- скрипты ----------
const exampleSel = $<HTMLSelectElement>('#script-example');
exampleSel.replaceChildren(new Option('Примеры…', ''), ...EXAMPLES.map((ex, i) => new Option(ex.name, String(i))));
exampleSel.onchange = () => {
  const ex = EXAMPLES[+exampleSel.value];
  if (ex) $<HTMLTextAreaElement>('#script-code').value = ex.code;
  exampleSel.value = '';
};
$<HTMLTextAreaElement>('#script-code').value = EXAMPLES[0].code;

async function runUserScript() {
  const out = $('#script-log');
  out.hidden = false;
  out.textContent = '';
  const log = (...args: unknown[]) => {
    out.textContent += args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 1))).join(' ') + '\n';
  };
  const btn = $<HTMLButtonElement>('#script-run');
  btn.disabled = true;
  try {
    const result = await runScript($<HTMLTextAreaElement>('#script-code').value, api, log);
    if (result !== undefined) log('→', result);
    if (!out.textContent) log('Готово.');
  } catch (e) {
    log(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    console.error(e);
  } finally {
    btn.disabled = false;
  }
}
$('#script-run').onclick = runUserScript;
$('#script-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    void runUserScript();
  }
});

// ---------- медиа ----------
function renderMedia() {
  const list = $('#media');
  if (!project.assets.size) return;
  list.replaceChildren(
    ...[...project.assets.values()].map((a: Asset) => {
      const item = document.createElement('div');
      item.className = 'media-item';
      item.innerHTML = `<b></b><small>${a.codec} · ${a.width}×${a.height} · ${+a.fps.toFixed(3)} к/с · ${formatTime(a.end - a.start)}</small><button class="btn">На таймлайн</button>`;
      $('b', item).textContent = a.name;
      $('b', item).title = a.name;
      $('button', item).onclick = () => api.add(a.id);
      return item;
    }),
  );
}

// ---------- экспорт ----------
$('#export').onclick = () => {
  if (!project.clips.length) return;
  player.pause();
  const { width, height } = project.size;
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="ex-title">
      <h3 id="ex-title">Экспорт в MP4</h3>
      <label class="field">Разрешение
        <select id="ex-res">
          <option value="0">Как в исходнике (${width}×${height})</option>
          ${height > 2160 ? '<option value="2160">2160p</option>' : ''}
          ${height > 1080 ? '<option value="1080" selected>1080p</option>' : ''}
          ${height > 720 ? '<option value="720">720p</option>' : ''}
        </select>
      </label>
      <label class="field">Качество
        <select id="ex-q"><option value="high">Высокое</option><option value="medium">Среднее, файл меньше</option></select>
      </label>
      <progress id="ex-progress" max="1" value="0" hidden></progress>
      <p class="hint" id="ex-status">Длительность ${formatTime(project.duration, project.fps)}. Не закрывайте вкладку, пока идёт экспорт.</p>
      <div class="row" id="ex-actions">
        <button class="btn" id="ex-cancel">Отмена</button>
        <button class="btn primary" id="ex-go">Экспортировать</button>
      </div>
    </div>`;
  document.body.append(modal);
  const signal = { canceled: false };
  let busy = false;
  $('#ex-cancel', modal).onclick = () => {
    if (busy) signal.canceled = true;
    else modal.remove();
  };
  $('#ex-go', modal).onclick = async () => {
    busy = true;
    const go = $<HTMLButtonElement>('#ex-go', modal);
    go.disabled = true;
    const progress = $<HTMLProgressElement>('#ex-progress', modal);
    progress.hidden = false;
    const status = $('#ex-status', modal);
    const started = performance.now();
    try {
      const blob = await exportProject(project, {
        height: +$<HTMLSelectElement>('#ex-res', modal).value || null,
        quality: $<HTMLSelectElement>('#ex-q', modal).value as 'high' | 'medium',
        signal,
        onProgress: (f) => {
          progress.value = f;
          const elapsed = (performance.now() - started) / 1000;
          const left = f > 0.02 ? elapsed / f - elapsed : 0;
          status.textContent = `${Math.round(f * 100)}%${left ? ` · осталось ≈ ${formatTime(left)}` : ''}`;
        },
      });
      showResult(modal, blob, performance.now() - started);
    } catch (e) {
      busy = false;
      if (signal.canceled) {
        modal.remove();
        toast('Экспорт отменён');
        return;
      }
      console.error(e);
      status.textContent = e instanceof Error ? e.message : 'Экспорт не удался.';
      go.disabled = false;
    }
  };
};

function showResult(modal: HTMLElement, blob: Blob, ms: number) {
  const url = URL.createObjectURL(blob);
  const name = `montage-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.mp4`;
  const card = $('.modal-card', modal);
  card.innerHTML = `
    <h3>Готово</h3>
    <video controls playsinline src="${url}"></video>
    <p class="hint">${(blob.size / 1048576).toFixed(1)} МБ · ${(ms / 1000).toFixed(1)} с</p>
    <div class="row">
      <button class="btn" id="ex-close">Закрыть</button>
      <a class="btn primary" id="ex-save" href="${url}" download="${name}">Сохранить файл</a>
    </div>`;
  $('#ex-close', card).onclick = () => {
    URL.revokeObjectURL(url);
    modal.remove();
  };
}

// ---------- связка ----------
project.onChange(() => {
  const has = project.clips.length > 0;
  $('#empty').hidden = has;
  $<HTMLButtonElement>('#export').disabled = !has;
  for (const id of ['#split', '#delete', '#bypass']) $<HTMLButtonElement>(id).disabled = !has;
  const clip = project.selectedClip;
  const asset = clip && project.assets.get(clip.assetId);
  $('#info').textContent = asset ? `${asset.codec} · ${asset.width}×${asset.height} · ${+asset.fps.toFixed(3)} к/с` : '';
  syncInspector();
  syncTransition();
  renderMedia();
  if (player.time > project.duration) player.time = project.duration;
  onTime(player.time);
  if (!player.playing) void player.showFrame(player.time);
});
project.changed();
