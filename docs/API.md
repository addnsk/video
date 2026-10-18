# Scripting API

Everything the UI does is available from code:

- in the **Script** panel, where code runs as the body of an `async` function with `montage` and `log` in scope;
- in the browser console as the global `montage`.

Each call that changes the project is one undo step. A script run from the panel is a single undo step.

Clips are referenced by id (`'item_x1'`) or by index on the main track (`0`, `1`, `-1` for the last). Times are in seconds.

## State

| Call | Returns |
|---|---|
| `montage.clips()` | Clips on the main track: `id`, `index`, `name`, `start`, `duration`, `in`, `out`, `volume`, `effects`, `transition` |
| `montage.clip(ref)` | One clip |
| `montage.assets()` | Imported media: `id`, `name`, `codec`, `width`, `height`, `fps`, `start`, `end`, `hasAudio` |
| `montage.duration`, `montage.fps`, `montage.size`, `montage.time` | Timeline length, frame rate, frame size, playhead |
| `await montage.stats()` | Engine memory budget and live/peak resource counts |

## Media and timeline

```js
const a = await montage.import(file);          // File, Blob or URL; not placed on the timeline
montage.add(a.id, { in: 2, out: 6 });            // source range 2–6 s, appended
montage.add(a.id, { index: 0 });                 // whole file at the start
const right = montage.split(10);                 // returns the right half
montage.trim(0, { in: 1.5 });
montage.move('item_x4', 0);
montage.remove(-1);
montage.volume('all', 0.8);
montage.clear();
montage.proxy(a.id);                             // build a proxy now
montage.proxies();                               // { [assetId]: { state, fraction } }
```

## Color

```js
montage.grade(0, { exposure: 0.3, saturation: 1.1 });
montage.grade('all', { inputTransform: 'bmdFilmGen5' });
montage.grade(1, { lift: { master: -0.03 }, gain: { x: 0.05, y: 0 } });
montage.copyGrade(0, 'all');
montage.resetGrade('all');
await montage.lut('all', 'https://example.com/look.cube', 0.8);
```

| Field | Range | Neutral |
|---|---|---|
| `inputTransform` | `'none'`, `'bmdFilmGen5'` | `'none'` |
| `exposure` | stops, −3…3 | 0 |
| `temperature`, `tint` | −1…1 | 0 |
| `contrast` | 0.5…2 | 1 |
| `pivot` | 0…1 | 0.435 |
| `saturation` | 0…2 | 1 |
| `lift`, `gamma`, `gain` | `{ x, y, master }` or `[x, y, master]`; `x`/`y` hue offset −0.25…0.25, `master` −0.5…0.5 | 0 |

## Custom effects

A filter is GLSL with an entry point `vec4 effect(vec4 color, vec2 uv)`. Parameters are declared as specs and become uniforms of the same name. `sampleSource(uv)` reads the input frame at any position.

```js
montage.effects.register({
  id: 'vignette',
  name: 'Vignette',
  params: [{ name: 'amount', type: 'float', default: 0.5, min: 0, max: 1 }],
  glsl: `
vec4 effect(vec4 color, vec2 uv) {
  float d = distance(uv, vec2(0.5));
  return vec4(color.rgb * (1.0 - amount * smoothstep(0.3, 0.8, d)), color.a);
}`,
});
montage.effect('all', 'vignette', { amount: 0.6 });
montage.effect(0, 'vignette', null);
```

Parameter types: `float`, `int`, `bool`, `vec2`, `vec3`, `vec4`, `enum` (`options: [{ value, label }]`), `resource` (`resource: 'lut3d'`).

## Transitions

A transition belongs to a clip and means "transition into this clip from the previous one". Neighbouring clips overlap by its length.

```js
montage.transition(1, { type: 'dissolve', duration: 0.5 });
montage.transition(2, { type: 'wipe', duration: 1, params: { direction: [0, 1], smoothness: 0.2 } });
montage.transition(2, null);
montage.transitions.list();
```

Built in: `dissolve`, `fade-color`, `wipe`, `slide`, `circle-open`, `zoom`.

Custom transitions use the [gl-transitions](https://gl-transitions.com) format: `vec4 transition(vec2 uv)` mixing `getFromColor(uv)` and `getToColor(uv)` by `progress`; `ratio` is width / height. Parameters are uniforms with a default after `// =`. Any transition from the gl-transitions collection works unchanged.

```js
montage.transitions.register({
  id: 'soft-wipe',
  name: 'Soft wipe',
  glsl: `
uniform float smoothness; // = 0.05
vec4 transition(vec2 uv) {
  float m = smoothstep(progress - smoothness, progress + smoothness, uv.x);
  return mix(getToColor(uv), getFromColor(uv), m);
}`,
});
```

## Playback, history, export

```js
montage.seek(12.5);
await montage.play();
montage.pause();

montage.undo();
montage.redo();
await montage.batch(async () => { /* several edits, one undo step */ });

const { file, name } = await montage.render({ height: 1080, quality: 'high', onProgress: (f) => log(f) });
const off = montage.onChange(() => log('changed'));
```
