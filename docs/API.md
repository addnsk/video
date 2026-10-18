# Scripting API

Everything the UI does is available from code:

- in the **Script** panel, where code runs as the body of an `async` function with `montage` and `log` in scope;
- in the browser console as the global `montage`.

Each call that changes the project is one undo step. A script run from the panel is a single undo step.

Clips are referenced by id (`'item_x1'`) or by index on the main track (`0`, `1`, `-1` for the last). Times are in seconds.

## State

| Call | Returns |
|---|---|
| `montage.clips(trackId?)` | Items on the main track or the given track: `id`, `kind`, `track`, `index`, `name`, `start`, `duration`, `in`, `out`, `volume`, `opacity`, `transform`, `text`, `animations`, `effects`, `transition` |
| `montage.clip(ref)` | One clip |
| `montage.assets()` | Imported media: `id`, `name`, `codec`, `width`, `height`, `fps`, `start`, `end`, `hasVideo`, `hasAudio` |
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
montage.speed(0, 2);                             // 0.1–16; audio follows with pitch, keyframes keep their place
montage.clear();
montage.proxy(a.id);                             // build a proxy now
montage.proxies();                               // { [assetId]: { state, fraction } }
```

## Tracks, overlays and titles

The main track `v1` is magnetic: clips sit back to back and can have transitions. Other tracks are free: items keep their own start time and may overlap. Video tracks stack bottom to top; audio tracks only carry sound.

```js
montage.tracks();                                          // [{ id, kind, magnetic, muted, items }]
const v3 = montage.addTrack('video');
montage.muteTrack('a1', true);
montage.removeTrack(v3);

const pip = montage.add(asset.id, { track: 'v2', start: 4, in: 0, out: 3 });
montage.set(pip.id, { opacity: 0.9, transform: { x: 0.3, y: 0.25, scale: 0.35, rotation: 0 } });
montage.place(pip.id, 'v3', 6);                            // move to another track and time

const song = montage.add(music.id, { track: 'a1', start: 0 });
montage.volume(song.id, 0.4);

const title = montage.title('Hello', { start: 1, duration: 3, size: 0.08, color: '#ffffff', background: '#000000b3' });
montage.setText(title.id, { content: 'Hello\nworld', align: 'left', font: 'IBM Plex Mono' });
montage.clips('v2');                                       // items of any track
montage.select(title.id);
```

`transform.x` and `transform.y` move by a fraction of the frame (−1…1), `scale` is relative to fitting the frame, `rotation` is in degrees.

Title fonts: `IBM Plex Sans`, `IBM Plex Mono`, `serif`, `sans-serif`. `size` is a fraction of the frame height.

## Keyframes

Any numeric property can be animated. Times are relative to the start of the item.

```js
montage.keyframe(title.id, 'opacity', 0, 0);
montage.keyframe(title.id, 'opacity', 0.5, 1);
montage.keyframe(pip.id, 'scale', 0, 0.3);
montage.keyframe(pip.id, 'scale', 2, 0.5);
montage.keyframe(song.id, 'volume', 0, 0);
montage.keyframe(0, montage.effectProperty('grade', 'exposure'), 0, -1);
montage.removeKeyframe(pip.id, 'scale', 2);
montage.clearKeyframes(pip.id, 'scale');
```

Properties: `opacity`, `volume`, `x`, `y`, `scale`, `rotation`, and `montage.effectProperty(effectType, param)` for any float parameter of an effect on the item.

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

## Animation presets

Presets animate opacity, position and scale relative to the clip's own values. They are stored on the clip and computed while rendering, so they follow trims, speed changes and splits (the left part keeps the in animation, the right part the out animation). Keyframes set by hand stay outside the preset windows.

```js
montage.animationPresets();                 // [{ id, name, phase: 'in' | 'out' | 'whole', duration }]
const t = montage.title('Hello', { duration: 4 });
montage.animate(t.id, 'in', 'rise');        // fade-in, rise, pop, slide-left
montage.animate(t.id, 'out', 'fade-out');   // fade-out, sink, shrink
montage.animate(0, 'whole', 'ken-burns');   // ken-burns, drift
montage.animate(t.id, 'in', null);
```

## Node graph (compositing)

Every clip renders through a node graph. Without an explicit graph it is the effect chain (source → color → curves → LUT → custom → output). `graph.enable` turns that chain into an editable graph; effect edits from the color panel keep working on it. Node parameters animate with `graph.keyframe`.

```js
montage.graph.types();                                   // built-in and registered nodes with inputs and params
const bg = montage.graph.add(0, 'background', { color: [0, 0.2, 0.4, 1] });
const mask = montage.graph.add(0, 'ellipse-mask', { size: [0.4, 0.4], softness: 0.05 });
const merge = montage.graph.add(0, 'merge', { mode: 'screen' });
montage.graph.connect(0, bg, merge, 'background');
montage.graph.connect(0, 'source', merge, 'foreground');
montage.graph.connect(0, mask, merge, 'mask');
montage.graph.connect(0, merge, 'output');
montage.graph.set(0, merge, { opacity: 0.8 });
montage.graph.keyframe(0, merge, 'opacity', 0, 0);
montage.graph.toggle(0, merge, false);
montage.graph.get(0);                                    // { editable, nodes, links }
montage.graph.view(0, merge);                            // show one node's result in the viewer; view(null) returns to the output
montage.graph.disable(0);                                // back to the plain effect chain
```

Built-in nodes:

- Generators: `text` (see below), `background`, `gradient`, `noise` (animated fractal noise: `scale`, `detail`, `speed`, `seed`, `low` and `high` colors).
- Compositing and transforms: `merge` (normal, add, screen, multiply, overlay, difference, lighten, darken, with mask and offset), `transform`, `crop`, `letterbox` (`ratio`, `offset`, bar color), `corner-pin` (`topLeft`, `topRight`, `bottomRight`, `bottomLeft` in frame units), `lens-distortion` (`k1`, `k2`, `zoom`, `dispersion` for chromatic fringing), `displace` (second input `map`; `strength`, `channel` `red-green` or `luma`).
- Blur and detail: `blur`, `glow`, `directional-blur` (`blurLength` in project pixels, `angle`, `centered`), `radial-blur` (`center`, `amount`, `mode` `zoom` or `spin`), `sharpen` (`amount`, `radius`, `threshold`).
- Stylize: `vignette` (`amount`, `radius`, `softness`, `roundness`, `tint`), `film-grain` (`amount`, `grainSize`, `shadows`, `mono`; changes every frame), `invert`.
- Masks and keys: `polygon-mask` (animatable `points` as x, y pairs in frame units from -0.5 to 0.5 with y down, Catmull-Rom `spline`, `feather`, editable on the viewer), `ellipse-mask`, `rectangle-mask`, `mask-combine` (inputs `a` and `b`; `mode` `union`, `intersect`, `subtract`, `difference`; `invert`), `keyer` (chroma key with spill removal, choke, garbage mask and matte view), `luma-key` (`low`, `high`, `softness`, `invert`, `matte`), `matte` (matte control for any alpha: `choke` in project pixels, negative grows, `feather`, `gamma`, `clipLow`, `clipHigh`, `invert`, `matte` view).
- Every color filter is also a node.

### Text node

`text` is a generator node in the spirit of Text+: it lays out text on the GPU with per-character animation, an outline and a soft shadow, and outputs it with alpha for a `merge`. Parameters:

- Layout: `text` (multi-line string), `font` (`IBM Plex Sans`, `IBM Plex Mono`, `serif`, `sans-serif`), `weight` (`'400'`, `'600'`, `'700'`), `size` (fraction of frame height), `tracking` (extra spacing in em), `lineSpacing`, `align` (`left`, `center`, `right`), `center` (frame units, y down), `rotation` (degrees).
- Look: `fill`, `outline` and `shadow` colors as `[r, g, b, a]`, `outlineWidth` (em), `shadowOffset` (frame units), `shadowSoftness`.
- Per-character animation: every glyph moves from a start state to its resting place as `progress` goes from 0 to 1. The start state is `fromOffset` (frame units), `fromScale`, `fromRotation` and `fromOpacity`. `stagger` (0 to 0.99) spreads the glyphs in time, `order` is `forward`, `backward` or `center`, `ease` is `linear`, `out`, `inOut` or `back`. Keyframe `progress` to animate.

Up to 128 glyphs animate individually; longer text still renders but the extra glyphs stay hidden.

```js
const title = montage.graph.add(0, 'text', {
  text: 'Opening night',
  size: 0.12,
  outline: [0, 0, 0, 1],
  outlineWidth: 0.04,
  shadow: [0, 0, 0, 0.6],
  fromOffset: [0, 0.08],
  fromOpacity: 0,
  stagger: 0.6,
  ease: 'back',
});
const merge = montage.graph.add(0, 'merge');
montage.graph.connect(0, 'source', merge, 'background');
montage.graph.connect(0, title, merge, 'foreground');
montage.graph.connect(0, merge, 'output');
montage.graph.keyframe(0, title, 'progress', 0, 0);
montage.graph.keyframe(0, title, 'progress', 1.5, 1);
```

Useful start states: typewriter (`fromOpacity: 0, stagger: 0.95, ease: 'linear'`), drop in (`fromOffset: [0, -0.1], ease: 'back'`), zoom (`fromScale: 3, fromOpacity: 0`), spin (`fromRotation: 180, fromScale: 0`).

Custom nodes can rasterize text too: a node definition with `raster: 'text'` receives `raster(uv)` (fill coverage in red, outline coverage in green), `glyph_count()` and `glyph(i)` (each glyph's box in uv, y up).

### Node templates

A template is a group of nodes saved as plain JSON: their types, params, relative positions, internal links, keyframes, the inputs that came from outside the group and the node that fed the rest of the graph. Templates live in the browser (`montage.templates`) or anywhere you store the JSON.

```js
const tpl = montage.graph.template(0, [title, merge], 'Lower third');  // capture nodes of clip 0
montage.templates.save(tpl);                                            // keep it in this browser
montage.templates.list();                                               // [{ name, nodes }]
const ids = montage.graph.insert(3, 'Lower third', { source: 'source' }); // or pass the template object
montage.graph.connect(3, ids.output, 'output');
montage.templates.remove('Lower third');
```

`insert` returns the new node ids keyed by template keys (`n0`, `n1`, ...) plus `output`. With `source`, the group's outside inputs are connected to that node. In the node editor, Save template stores the selected node with everything that feeds it, and saved templates appear at the end of the add-node list.

### Tracking

`track` follows a point through a media clip with normalized cross-correlation on a reduced-size luma copy of each frame. The point is in frame units centered on the frame from -0.5 to 0.5 with y down (the convention of clip positions and of `center` and `offset` node params). It returns `[{ t, x, y }]` in clip time; frames with a weak match are dropped. `apply` writes keyframes: `{ node, param }` drives a vec2 node param (a mask, text or transform follows the point), `'stabilize'` animates the clip position against the motion. Clip rotation is not taken into account.

```js
await montage.track(0, { x: -0.27, y: 0, from: 0, to: 2 });
const mask = montage.graph.add(0, 'ellipse-mask');
await montage.track(0, { x: -0.27, y: 0, apply: { node: mask, param: 'center' } });
await montage.track(0, { x: -0.27, y: 0, apply: 'stabilize', patch: 31, search: 24, height: 480 });
```

In the UI, the Stabilize button in the clip panel and the Track buttons of vec2 node params ask for a click on the viewer and track from the playhead to the clip end.

Custom nodes are GLSL with any number of inputs and passes. Each pass defines `vec4 process(vec2 uv)` and can call `input_<name>(uv)`, `has_<name>()`, `previous(uv)` (the previous pass), `texel()`, `aspect()`, `px(projectPixels)` and `time()` (seconds from the clip start). Nodes that read `time()` must be registered with `temporal: true` so their output is not cached between frames. Values are not clamped, so highlights above 1.0 survive to HDR export.

```js
montage.nodes.register({
  id: 'chromatic',
  name: 'Chromatic aberration',
  inputs: ['source'],
  params: [{ name: 'amount', type: 'float', default: 2, min: 0, max: 20 }],
  passes: `vec4 process(vec2 uv) {
    vec2 d = (uv - 0.5) * amount * texel();
    return vec4(input_source(uv + d).r, input_source(uv).g, input_source(uv - d).b, input_source(uv).a);
  }`,
});
```

## Audio effects

Audio effects run in the engine's mixer per clip, in order: low cut, equalizer, compressor. Parameters are in hertz and decibels.

```js
montage.audioEffects();                                   // [{ id, name, params }]
montage.audioEffect('all', 'highpass', { cutoff: 90 });
montage.audioEffect(0, 'eq', { low: -3, mid: 2, high: 4 });
montage.audioEffect(0, 'compressor', { threshold: -20, ratio: 4, makeup: 6 });
montage.audioEffect(0, 'eq', null);                       // remove
```

## Playback, history, export

`play(rate)` shuttles: rates above 1 play faster with pitched audio, negative rates scrub backward without audio. `rate` is 0 while paused.

```js
montage.seek(12.5);
await montage.play();
await montage.play(4);
await montage.play(-2);
montage.pause();
montage.rate;
montage.levels();                                // output peak per channel while playing, 0–1

montage.undo();
montage.redo();
await montage.batch(async () => { /* several edits, one undo step */ });

const { file, name } = await montage.render({ height: 1080, quality: 'high', onProgress: (f) => log(f) });
await montage.render({ prores: 'hq', dynamicRange: 'hlg' }); // dynamicRange: 'sdr' | 'hlg' | 'pq', Rec.2020 for HDR
await montage.render({ prores: 'hq' });           // 'hq' | 'standard' | 'lt' | 'proxy': ProRes 422 in .mov with PCM audio
const off = montage.onChange(() => log('changed'));

montage.diagnostics.entries();   // [{ time, level, source, message, stack?, count }]
montage.diagnostics.warn('note from a script');
montage.diagnostics.clear();
```
