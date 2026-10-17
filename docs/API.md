# API редактора

Всё, что делается мышью, можно сделать из кода. API доступен:

- в панели **Скрипт** справа: код выполняется как тело `async`-функции, в области видимости есть `montage` и `log`;
- в консоли браузера как глобальный объект `montage`.

Каждый вызов, который меняет проект, — отдельный шаг отмены (Ctrl+Z). Скрипт из панели целиком — один шаг: его можно отменить одним нажатием.

Клип можно указать по `id` (`'c3'`) или по индексу на таймлайне (`0`, `1`, `-1` — последний). Время везде в секундах.

## Состояние

| Вызов | Что возвращает |
|---|---|
| `montage.clips()` | Массив клипов: `id`, `name`, `index`, `start` (на таймлайне), `duration`, `in`/`out` (в исходнике), `grade`, `transition` |
| `montage.clip(ref)` | Один клип |
| `montage.assets()` | Импортированные файлы: `id`, `name`, `codec`, `width`, `height`, `fps`, `start`, `end`, `hasAudio` |
| `montage.duration`, `montage.fps`, `montage.size`, `montage.time`, `montage.selected` | Длина таймлайна, частота кадров, размер кадра, позиция плейхеда, выбранный клип |

## Медиа и таймлайн

```js
const a = await montage.import(file);          // File, Blob или URL; на таймлайн не ставит
montage.add(a.id, { in: 2, out: 6 });            // кусок исходника с 2 по 6 с в конец таймлайна
montage.add(a.id, { index: 0 });                 // весь файл в начало
const right = montage.split(10);                 // разрез в 10 с, возвращает правую часть
montage.trim(0, { in: 1.5 });                    // новая точка входа первого клипа
montage.move('c4', 0);                           // переставить клип
montage.remove(-1);                              // удалить последний
montage.select(0);
montage.clear();
```

## Цвет

```js
montage.grade(0, { exposure: 0.3, saturation: 1.1 });     // меняет только указанные поля
montage.grade('all', { input: 'bmdFilmGen5' });            // Blackmagic Film Gen 5 → Rec.709
montage.grade(1, { lift: { master: -0.03 }, gain: { x: 0.05, y: 0 } });
montage.copyGrade(0, 'all');
montage.resetGrade('all');
await montage.lut('all', 'https://example.com/look.cube', 0.8);  // URL, File или текст .cube
```

Поля покраски:

| Поле | Диапазон | Нейтрально |
|---|---|---|
| `input` | `'none'`, `'bmdFilmGen5'` | `'none'` |
| `exposure` | стопы, −3…3 | 0 |
| `temperature`, `tint` | −1…1 | 0 |
| `contrast` | 0.5…2 | 1 |
| `pivot` | 0…1 | 0.435 |
| `saturation` | 0…2 | 1 |
| `lift`, `gamma`, `gain` | `{ x, y, master }`: `x`/`y` — смещение оттенка (−0.25…0.25), `master` — яркость (−0.5…0.5) | 0 |
| `lutMix` | 0…1 | 1 |

## Переходы

Переход ставится на клип и означает «переход в этот клип из предыдущего». Клипы при этом наезжают друг на друга на длину перехода, таймлайн становится короче.

```js
montage.transition(1, { type: 'dissolve', duration: 0.5 });
montage.transition(2, { type: 'wipe', duration: 1, params: { direction: [0, 1], smoothness: 0.2 } });
montage.transition(2, null);                    // убрать
montage.transitions.list();                     // [{ id, name, params }]
```

Встроенные: `dissolve`, `fade-color`, `wipe`, `slide`, `circle-open`, `zoom`.

### Свой переход

Формат — [gl-transitions](https://gl-transitions.com): GLSL-функция `vec4 transition(vec2 uv)`, которая читает кадры через `getFromColor(uv)` и `getToColor(uv)` и смешивает их по `progress` (0…1). Также доступна `ratio` (ширина / высота). Параметры объявляются как uniform, значение по умолчанию — в комментарии:

```js
montage.transitions.register({
  id: 'my-wipe',
  name: 'Моя шторка',
  glsl: `
uniform float smoothness; // = 0.05
vec4 transition(vec2 uv) {
  float m = smoothstep(progress - smoothness, progress + smoothness, uv.x);
  return mix(getToColor(uv), getFromColor(uv), m);
}`,
});
```

Любой переход из коллекции gl-transitions можно вставить без изменений. Параметры типа `float` появляются ползунками в панели «Переход в клип».

## Воспроизведение, история, экспорт

```js
montage.seek(12.5);
await montage.play();
montage.pause();

montage.undo();
montage.redo();
await montage.batch(async () => { /* несколько изменений = один шаг отмены */ });

const blob = await montage.render({ height: 1080, quality: 'high', onProgress: (f) => log(f) });
const off = montage.onChange(() => log('проект изменился'));
```
