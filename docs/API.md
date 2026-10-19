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

## Editing

### Source viewer and marks

```js
montage.source.open(asset.id);               // on desktops the source viewer opens next to the timeline viewer, on phones it replaces it
montage.source.seek(3); montage.source.play(); montage.source.pause();
montage.source.mark({ in: 1, out: 4 });      // seconds from the start of the clip; null clears a mark
montage.source.state();                      // { assetId, viewer: 'source' | 'timeline', marks, time }
montage.source.show('timeline');             // make the timeline viewer active (keys and transport follow it); marks are kept per clip
montage.source.close();
montage.marks({ in: 10, out: 12 });          // timeline In and Out; montage.marks() reads them
```

### Insert, overwrite, append

Edits follow three-point rules. Source In and Out come from the source viewer marks (or `in`/`out` in media time); without a source In the source playhead is used, without an Out the end of the clip. Timeline In comes from `at`, the timeline In mark or the playhead; with a timeline Out (`until` or the Out mark) the edit is backtimed or its length set by the timeline range. With all four points the clip is retimed to fit (fit to fill, speed 0.1–16).

```js
const r = montage.edit.insert();                        // { video, audio, start, duration }: item ids
montage.edit.overwrite({ asset: id, in: 0, out: 2, at: 5 });
montage.edit.insert({ asset: id, at: 3, ripple: 'track' });   // ripple 'all' (default), 'track' or a list of track ids
montage.edit.append({ asset: id });                     // after the last clip of the target tracks
montage.edit.insert({ asset: id, video: 'v2', audio: null }); // target tracks; null leaves that part out
```

A file with picture and sound goes in as a video clip (`audio: false` in `montage.clip`) and a linked clip on the audio track (by default the first audio track, created if missing). Insert opens a gap on every rippled track and splits clips under the edit point; overwrite replaces the range on the target tracks only. An edit point inside a transition on `v1` cuts the transition.

### Lift, extract, delete

```js
montage.edit.lift();                          // remove the marked range, leave a gap (every track; pass from, to, tracks)
montage.edit.extract(2, 5, ['v1', 'a1']);     // remove and close the gap; markers after it move too
montage.edit.delete([clipA, clipB]);          // linked clips go too; leaves a gap
montage.edit.delete(clip, { ripple: true, tracks: 'all' });   // close the gap on the linked tracks ('linked'), all tracks or a list
```

`v1` can hold gaps: a lift or an overwrite past the end leaves empty time before the next clip (`gap` on the item). A clip after a gap has no transition.

### Trim modes

Every trim moves linked clips the same way and stops where the source media ends (text has no limit).

```js
montage.edit.ripple(clip, 'out', -0.5);       // shorten the tail; everything after moves (linked tracks, or 'all' / a list)
montage.edit.ripple(clip, 'in', 1);           // the clip stays in place, its head is trimmed, later clips move
montage.edit.roll(clip, 'out', 0.4);          // move the cut between this clip and the next; total length stays
montage.edit.slip(clip, 1);                   // same place and length, different part of the source
montage.edit.slide(clip, -0.5);               // move the clip; the neighbours give and take the time
```

### Linking

```js
montage.edit.link([video, audio]);
montage.edit.unlink(video);                   // unlinks the whole group
montage.edit.linked(video);                   // [video, audio]
```

### Timelines and compound clips

A project holds several timelines; one is open at a time and the rest of the API (clips, edits, markers, mixer, export) works on it. Each timeline has its own frame size and frame rate; the color science is shared by the project.

```js
montage.timelines.list();                     // [{ id, name, active }]
const b = montage.timelines.create('Alt cut');          // opens it; { open: false } keeps the current one
montage.timelines.create('Vertical', { width: 1080, height: 1920, fps: 30 });   // defaults to the current format
montage.timelines.format({ fps: 24 });        // change the open timeline; montage.timelines.format() reads it
montage.timelines.open(b);
montage.timelines.rename(b, 'Alt cut v2');
const copy = montage.timelines.duplicate(b);  // new ids for clips, links and markers
montage.timelines.remove(copy);               // not the open one; clips that nest it are removed too

const asset = montage.timelines.asset(b);     // the timeline as a media asset
montage.edit.insert({ asset, in: 0, at: 4 }); // nest it like any clip: trims, slips, speed and effects apply to its whole picture and sound
const { timeline, clip } = montage.timelines.compound([clipA, clipB], 'Scene 1');   // replace clips (and their linked clips) with one nested timeline
```

A nested clip renders its timeline at the source time and in its own frame shape (fitted like any clip), including its own tracks, transitions, nodes and mixer. When the nested timeline becomes shorter, clips that use it are trimmed to fit. A timeline cannot be nested inside itself, directly or through other timelines.

### Markers

```js
const m = montage.markers.add({ time: 4, name: 'Cue', color: 'red', note: '', duration: 0 });   // time defaults to the playhead
montage.markers.update(m, { time: 5 });
montage.markers.list(); montage.markers.next(); montage.markers.previous();
montage.markers.remove(m);
montage.markers.colors();                     // blue, cyan, green, yellow, red, pink, purple, fuchsia, rose, lavender, sky, mint, lemon, sand, cocoa, cream
```

Markers ride with ripple edits: insert moves markers after the edit point, extract moves later ones back and drops those inside the range.

## Media pool: bins, search, metadata

```js
const day1 = montage.media.addBin('Day 1');                 // { parent } nests it
const best = montage.media.addBin('Best', { query: 'rating>=4 -kind:audio' });   // smart bin: filled by its search
montage.media.move([a.id, b.id], day1);                     // null moves back to the top level
montage.media.list(day1);                                   // [{ ...asset, kind, bin, metadata }]; no argument lists everything
montage.media.bins();                                       // [{ id, name, parent, query, count }]
montage.media.updateBin(day1, { name: 'Day one', parent: null });
montage.media.removeBin(day1);                              // its media and sub-bins move up one level

montage.media.metadata(a.id, { scene: '12', shot: 'B', take: '3', angle: 'wide', camera: 'A', reel: 'A001',
  description: '', comments: '', keywords: ['interview'], rating: 4, flagged: true });   // null or '' clears a field
montage.media.metadata(a.id);                               // read
montage.media.fields();
montage.media.rename(a.id, 'Interview wide');
montage.media.remove(a.id);                                 // only media no timeline uses

montage.media.search('interview scene:12 rating>=3 -flagged:yes');
```

Search terms: plain words match the name, codec, kind and text metadata; `field:value` matches part of a field, `field=value` the whole field, `rating>=3` (also `>`, `<`, `<=`) compares numbers, a leading `-` negates. Fields: `name`, `codec`, `kind` (`video`, `audio`, `timeline`), `bin`, and the metadata fields. Quote values with spaces: `bin:"Day 1"`.

## Multicam

```js
const offsets = await montage.multicam.sync([camA, camB, camC]);      // [{ assetId, offset, confidence }] from the sound
const mc = await montage.multicam.create('Interview', [camA, camB, { assetId: camC, offset: 2.5, name: 'Wide' }], { sync: 'audio' });
montage.multicam.view(mc.asset);              // all angles side by side in the viewer
montage.edit.insert({ asset: mc.asset });     // a multicam clip edits like any clip
montage.multicam.cut(1);                      // cut to angle 2 at the playhead (picture and sound)
montage.multicam.cut(2, { only: 'video', time: 12 });
montage.multicam.angle(clip, { video: 0, audio: 1 });   // audio: null follows the picture
montage.multicam.angles(clip);                // { names, video, audio }
```

A multicam clip is a timeline with one picture track and one sound track per angle, lined up by the offsets (seconds on the shared clock, so a later camera has a larger offset). Sync compares the onsets of each angle's sound against the first angle with sound; angles without sound keep their given offset. In the timeline viewer the keys 1–9 cut to that angle at the playhead, Alt+1–9 cuts the picture only.

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

Splitting or trimming a clip keeps every animation exactly as it played: a cut inside an eased segment leaves keys with a `span` (`[from, to]`, the part of the easing curve the segment covers), so both halves follow the original curve. Changing a key's value keeps its easing and span.

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
montage.graph.disable(0);                                // back to the plain effect chain; enable() brings the wiring back
await montage.graph.pick(0, qualifierId, { x: 0.1, y: -0.2 });             // set a qualifier from the color at that point (the node's input, working space)
await montage.graph.pick(0, qualifier3d, { x: 0.3, y: 0 }, { add: true }); // 3D qualifier: add a key color instead of replacing
```

Built-in nodes:

- Generators: `text` (see below), `background`, `gradient`, `noise` (animated fractal noise: `scale`, `detail`, `speed`, `seed`, `low` and `high` colors).
- Compositing and transforms: `merge` (normal, add, screen, multiply, overlay, difference, lighten, darken, with mask and offset), `transform`, `crop`, `letterbox` (`ratio`, `offset`, bar color), `corner-pin` (`topLeft`, `topRight`, `bottomRight`, `bottomLeft` in frame units), `lens-distortion` (`k1`, `k2`, `zoom`, `dispersion` for chromatic fringing), `displace` (second input `map`; `strength`, `channel` `red-green` or `luma`).
- Blur and detail: `blur`, `glow`, `directional-blur` (`blurLength` in project pixels, `angle`, `centered`), `radial-blur` (`center`, `amount`, `mode` `zoom` or `spin`), `sharpen` (`amount`, `radius`, `threshold`).
- Stylize: `vignette` (`amount`, `radius`, `softness`, `roundness`, `tint`), `film-grain` (`amount`, `grainSize`, `shadows`, `mono`; changes every frame), `invert`.
- Masks and keys: `polygon-mask` (animatable `points` as x, y pairs in frame units from -0.5 to 0.5 with y down, Catmull-Rom `spline`, `feather`, editable on the viewer), `bezier-mask` (`points` as six numbers per vertex: x, y, then the in and out handle offsets from the vertex; editable on the viewer, Alt breaks the handle symmetry, double-click removes a vertex), `ellipse-mask`, `rectangle-mask`, `mask-combine` (inputs `a` and `b`; `mode` `union`, `intersect`, `subtract`, `difference`; `invert`), `keyer` (chroma key with spill removal, choke, garbage mask and matte view), `luma-key` (`low`, `high`, `softness`, `invert`, `matte`), `matte` (matte control for any alpha: `choke` in project pixels, negative grows, `feather`, `gamma`, `clipLow`, `clipHigh`, `invert`, `matte` view).
- Color: `qualifier` (HSL qualifier mask: `useHue`, `hueCenter` 0 to 1, `hueWidth`, `hueSoft`, `useSat`, `satLow`, `satHigh`, `satSoft`, `useLum`, `lumLow`, `lumHigh`, `lumSoft`, `invert`), `qualifier-3d` (mask around up to three picked colors `key1` to `key3` in Oklab space; a color with alpha 0 is unused; `tolerance`, `softness`, `ignoreLuma`, `invert`), `parallel-mixer` (weighted average of up to four inputs `a` to `d`, like Resolve's parallel node; `merge` is the layer mixer), `denoise` (spatial noise reduction: edge-preserving bilateral filter on luma and chroma separately; `luma` and `chroma` thresholds, `radius` in project pixels, `blend`), `temporal-denoise` (recursive temporal noise reduction: blends with its own previous output where the picture did not move; `strength`, `motion` threshold).
- Every color filter is also a node. A secondary correction is a `merge` with the original as `background`, the corrected branch as `foreground` and a qualifier or window as `mask`.

### Color management

Every media file has an input color space; the project has a working space (color science).

- `display` (default): the timeline works in Rec.709 display values. Log and HDR media are converted to Rec.709 on the way in (scene-linear, camera gamut to Rec.709, soft highlight roll-off).
- `aces`: the timeline works in ACEScct (AP1 primaries). Every clip is converted to ACEScct on the way in (Rec.709 and sRGB media through the inverse output transform, so they look the same as in `display`), grading happens in ACEScct, and the composite goes through an ACES output transform (fitted RRT and Rec.709 ODT) to the screen and to export. Exposure, temperature, tint and HDR wheels work on linear light in this mode.

Input spaces (`montage.colorSpaces()`): `rec709`, `srgb`, `linear`, `bmdFilmGen5`, `slog3`, `logc3`, `vlog`, `clog3`, `rec2020Hlg`, `rec2020Pq`. Blackmagic Film (from the `com.apple.proapps.customgamma` tag) and HLG/PQ transfer tags are detected on import.

```js
montage.colorScience();                       // 'display'
await montage.sample({ x: 0, y: 0 });         // [r, g, b, a] as displayed (composited over black) at the playhead, frame units
await montage.sample([{ x: -0.25, y: 0 }, { x: 0.25, y: 0 }], 2.5);
montage.colorScience('aces');
montage.colorSpace(0);                        // input space of clip 0's media
montage.colorSpace(0, 'slog3');               // set it for that media (all its clips)
montage.colorSpace({ asset: id }, 'logc3');   // by asset id
montage.colorSpace(2, 'vlog', { clip: true }); // only this clip; it overrides the media setting
montage.colorSpace(2, null, { clip: true });   // back to the media setting
```

Curves and the color warper keep values above 1 and below 0 (curves continue the slope of their ends). Mask vertices can be added and removed on animated masks: a new vertex gets keys at every existing key time, placed halfway along its edge, and a removed vertex takes its keys with it.

Grade versions and stills hold the color work of a clip (its effects, node graph and node keyframes), not its position, scale or opacity. Node templates are a personal library kept in the browser, shared across projects; move them with `montage.templates.get` and `montage.templates.save`. Scopes are computed from a 320 px wide copy of the viewer frame after the output transform and arrive a frame or two after the picture.

Generator nodes (background, gradient, noise, text) take their colors as display values: in `aces` they are converted into ACEScct, so they look the same in both working spaces. Values below black (negative light from log footage under the noise floor) are kept through the whole chain instead of being clipped.

In the color panel the same choices are the Working space and Input color space selects. The `grade` filter keeps its legacy `inputTransform` parameter for old projects; new imports use the input color space instead.

### Stills, wipe and grade versions

A still is the rendered frame at the playhead (a 270-line JPEG kept in the project) together with the grade of a clip. Stills compare against the live picture with a wipe and pass their grade to other clips.

```js
const still = await montage.stills.grab({ name: 'Hero', clip: 0 }); // clip defaults to the top clip at the playhead
montage.stills.list();                     // [{ id, name, time, image }]
await montage.stills.compare(still.id);    // wipe: the still on the left, the live frame on the right
await montage.stills.wipe(0.3);            // wipe position, 0 to 1
await montage.stills.compare(null);        // end the comparison
montage.stills.apply(still.id, 'all');     // copy its grade to clips (ref, list of refs or 'all')
montage.stills.remove(still.id);
```

Grade versions keep several grades per clip (effects, node graph and their keyframes). Loading a version stores the current grade under the active version name first.

```js
montage.versions.save(0, 'Warm');
montage.grade(0, { temperature: -0.3 });
montage.versions.save(0, 'Cool');
montage.versions.load(0, 'Warm');
montage.versions.list(0);                  // { active: 'Warm', names: ['Warm', 'Cool'] }
montage.versions.remove(0, 'Cool');
```

In the UI the Stills panel grabs, compares (click a still), applies and deletes stills; the color panel has the Grade version select and Save version.

### Color filters

Filters run on any clip with `montage.effect(ref, type, params)` (or `null` to remove) and in the node graph:

- `grade`: input transform, exposure, temperature, tint, contrast, pivot, saturation and the lift, gamma and gain wheels (`[x, y, master]`).
- `curves`: `master`, `red`, `green`, `blue` (x, y pairs), `hueSat`, `hueHue`, `hueLum` (periodic, 0.5 is neutral), `lumSat` (0.5 is neutral) and `satSat` (identity is neutral).
- `hdr-wheels`: zone wheels `dark`, `shadow`, `light`, `highlight` and `global` as `[x, y, exposure]` in stops, zones set by `darkPoint` and `highlightPoint` (stops around 18% gray) and `falloff`, plus `saturation`.
- `color-warper`: per hue range (`red`, `yellow`, `green`, `cyan`, `blue`, `magenta`) a `[hue shift, saturation, luminance]` vector, range `width`.
- `lut`: a loaded .cube with `strength`.

```js
montage.effect(0, 'hdr-wheels', { highlight: [0, 0.1, -0.5], dark: [0.05, 0, 0] });
montage.effect(0, 'color-warper', { green: [-0.3, -0.4, 0] });
montage.effect(0, 'curves', { hueHue: [0, 0.5, 0.33, 0.45, 1, 0.5] });
```

### Text node

`text` is a generator node in the spirit of Text+: it lays out text on the GPU with per-character animation, an outline and a soft shadow, and outputs it with alpha for a `merge`. Parameters:

- Layout: `text` (multi-line string), `font` (`IBM Plex Sans`, `IBM Plex Mono`, `serif`, `sans-serif`), `weight` (`'400'`, `'600'`, `'700'`), `size` (fraction of frame height), `tracking` (extra spacing in em), `lineSpacing`, `align` (`left`, `center`, `right`), `center` (frame units, y down), `rotation` (degrees).
- Look: `fill`, `outline` and `shadow` colors as `[r, g, b, a]`, `outlineWidth` (em), `shadowOffset` (frame units), `shadowSoftness`.
- Per-character animation (any number of glyphs; each glyph is drawn on its own, so tight kerning never drags a neighbour along; animating `size` or `outlineWidth` re-rasterizes the text every frame): every glyph moves from a start state to its resting place as `progress` goes from 0 to 1. The start state is `fromOffset` (frame units), `fromScale`, `fromRotation` and `fromOpacity`. `stagger` (0 to 0.99) spreads the glyphs in time, `order` is `forward`, `backward` or `center`, `ease` is `linear`, `out`, `inOut` or `back`. Keyframe `progress` to animate.

Every glyph animates individually, whatever the length of the text.

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

Custom node params of type `points` reach GLSL as `<name>_count` and `<name>_at(i)` (a vec2 per point, frame units, y down); masks use up to 1024 vertices, and smooth or Bezier outlines are sampled into up to 4096 points.

Custom nodes can rasterize text too: a node definition with `raster: 'text'` receives `raster(uv)` (fill coverage in red, outline coverage in green), `glyph_count()`, `glyph(i)` (each glyph's box in uv, y up) and `glyphRaster(i, uv)` (that glyph alone, sampled at a uv inside its box, so neighbours never leak in). There is no glyph limit; loop with `for (int i = 0; i < glyph_count(); i++)`.

### Render cache

Heavy frames (rendering took more than half a frame interval, or eight or more GPU passes) are kept as images in memory and, when memory is full, compressed to WebP in the browser's private file system (OPFS). Returning to such a frame in playback or while scrubbing shows the cached image instead of decoding and rendering again. Keys cover everything that changes the picture (clip time, resolved params and keyframes, graph, transitions, preview size, bypass and node view), so edits never show stale frames. The cache is emptied when effects, LUTs or fonts change and at every page load.

```js
(await montage.stats()).renderCache;               // { bytes, diskBytes, memory, disk } entry counts and sizes
montage.renderCache(false);                       // disable and empty
montage.renderCache({ enabled: true, memoryBytes: 256e6, diskBytes: 2e9 });
```

Default limits depend on the device class: 384 MB in memory and 4 GB on disk on desktops, 96 MB / 1 GB on phones and tablets, 32 MB / 256 MB on constrained devices. Under memory pressure the governor trims the in-memory part first.

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

`track` follows a point through a media clip with normalized cross-correlation on a reduced-size luma copy of each frame. The point is in frame units centered on the frame from -0.5 to 0.5 with y down (the convention of clip positions and of `center` and `offset` node params). It returns `[{ t, x, y }]` in clip time; frames with a weak match are dropped. `apply` writes keyframes: `{ node, param }` drives a vec2 node param (a mask, text or transform follows the point), `'stabilize'` animates the clip position against the motion. Points are mapped through the clip's position, scale and rotation at each frame, including keyframed transforms.

```js
await montage.track(0, { x: -0.27, y: 0, from: 0, to: 2 });
const mask = montage.graph.add(0, 'ellipse-mask');
await montage.track(0, { x: -0.27, y: 0, apply: { node: mask, param: 'center' } });
await montage.track(0, { x: -0.27, y: 0, apply: 'stabilize', patch: 31, search: 24, height: 480 });
```

In the UI, the Stabilize button in the clip panel and the Track buttons of vec2 node params ask for a click on the viewer and track from the playhead to the clip end.

Custom nodes are GLSL with any number of inputs and passes. Each pass defines `vec4 process(vec2 uv)` and can call `input_<name>(uv)`, `has_<name>()`, `previous(uv)` (the previous pass), `texel()`, `aspect()`, `px(projectPixels)` and `time()` (the source media time in seconds, so it follows speed changes and stays the same across splits; clip time for titles). Nodes that read `time()` must be registered with `temporal: true` so their output is not cached between frames. Nodes registered with `history: true` also get `history(uv)` and `has_history()`: their own output from the previous frame, available when the previous render was exactly one frame earlier on the same clip. Values are not clamped, so highlights above 1.0 survive to HDR export. Param and input names must not be GLSL keywords or built-in function names (`length`, `mix`, `input`, `sample`, `half`, ...) or start with `gl_` or `u_`; `register` throws with the offending names.

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

Audio effects run in the engine's mixer per clip, in the order they were added. Parameters are in hertz, decibels and milliseconds.

| id | name | params |
| --- | --- | --- |
| `highpass` | Low cut | `cutoff` (Hz) |
| `denoise` | Noise reduction | `reduction` (dB, 0–40), `sensitivity` (0.5–6). Learns the noise floor from the quietest parts as it plays; delays the sound by 1024 samples |
| `gate` | Gate | `threshold`, `range` (dB), `attack`, `hold`, `release` (ms) |
| `eq` | Equalizer | `low`, `mid`, `high` (dB) |
| `deesser` | De-esser | `frequency` (Hz), `threshold`, `reduction` (dB) |
| `compressor` | Compressor | `threshold` (dB), `ratio`, `makeup` (dB) |
| `delay` | Delay | `time` (ms, up to 2000), `feedback` (%), `pingpong` (0 or 1), `mix` (% wet) |
| `reverb` | Reverb | `size`, `damping`, `width` (0–1), `predelay` (ms), `mix` (% wet) |
| `limiter` | Limiter | `ceiling` (dBTP), `release` (ms). Looks 1.5 ms ahead and limits the true (inter-sample) peak |

Clip volume and fades are applied before the clip's effects. Effects that ring (reverb, delay) keep sounding after their clip ends, and an export carries that tail past the last video frame until it falls below −90 dBFS. After a seek the mixer replays as much audio before the new position as the effects remember (up to 12 s), so playback sounds the same as if it had run from the start; adding or removing an effect that delays the sound while playing crossfades over 30 ms.

Effects that delay the sound (noise reduction, limiter) are compensated: the mixer shifts everything else so clips, tracks and buses stay in sync with each other and with the picture.

```js
montage.audioEffects();                                   // [{ id, name, params }]
montage.audioEffect('all', 'highpass', { cutoff: 90 });
montage.audioEffect(0, 'eq', { low: -3, mid: 2, high: 4 });
montage.audioEffect(0, 'compressor', { threshold: -20, ratio: 4, makeup: 6 });
montage.audioEffect(0, 'denoise', { reduction: 15 });
montage.audioEffect(0, 'eq', null);                       // remove
```

## Mixer

Every track has a channel strip: trim (input gain before the effects, ±36 dB), audio effects, volume in dB (the fader after the effects, −60 to +12, −60 is silence), pan (−1 left to 1 right, a balance control), mute and automation. Tracks go to the master or to a bus and can also send to any number of buses, before or after their fader. Buses have their own strips and go to the master or to another bus (loops are refused). Clip effects and clip volume run first, then the track strip, then the buses, then the master.

```js
montage.mixer.state();                         // { tracks: [{ id, kind, output, sends, trim, volume, pan, mute, effects, automation }], buses: [{ id, name, output, ... }], master: {...} }
montage.mixer.set('a1', { volume: -6, pan: -0.3 });
montage.mixer.set('a1', { mute: true });       // same as montage.muteTrack('a1', true)
const music = montage.mixer.addBus('Music');   // returns the bus id
montage.mixer.route('a1', music);              // or 'master'; a bus id as the source routes that bus
const verb = montage.mixer.addBus('Reverb');
montage.mixer.effect(verb, 'reverb', { size: 0.7, mix: 100 });
montage.mixer.send('a1', verb, -10);           // post-fader send at -10 dB
montage.mixer.send('a2', verb, -6, { pre: true });
montage.mixer.send('a1', verb, null);          // remove the send
montage.mixer.route(verb, music);              // bus into bus
montage.mixer.set('master', { trim: -3 });
montage.mixer.renameBus(music, 'Score');
montage.mixer.removeBus(music);                // its tracks go back to the master
montage.mixer.effect('a2', 'denoise', { reduction: 12 });
montage.mixer.effect('master', 'limiter', { ceiling: -1 });
montage.mixer.enableEffect('master', 'limiter', false);
montage.mixer.effect('a2', 'denoise', null);   // remove
montage.mixer.keyframe(music, 'volume', 10, 0);  // automation in timeline seconds
montage.mixer.keyframe(music, 'volume', 12, -18);
montage.mixer.clearKeyframe(music, 'volume', 12); // one key; omit the time to clear all
```

Targets are track ids, bus ids or `'master'` (`montage.mixer.master`). Strip effects take the same types and parameters as clip audio effects.

## Loudness

`montage.loudness()` mixes the whole project offline and measures it per ITU-R BS.1770 / EBU R128: `integrated`, `shortTerm` and `momentary` (the last 3 s and 400 ms), `range` (LRA) in LUFS/LU, `peak` (sample peak) and `truePeak` (4× oversampled) in dBFS. `montage.normalize(target)` measures, moves the master trim (so the gain goes into the master effects, not after them) until the integrated loudness meets the target, and puts a limiter on the master when the true peak would go over the target's ceiling. `montage.liveLoudness()` returns the same reading for what has played since playback started (`null` while paused); the transport shows its momentary and short-term values.

```js
await montage.loudness();             // { integrated: -19.2, shortTerm: -18.7, momentary: -20.1, range: 6.3, peak: -2.4, truePeak: -2.1 }
await montage.normalize('youtube');   // { before, gain, limiter }
await montage.normalize(-23);         // integrated LUFS with a -1 dBFS ceiling
await montage.normalize({ integrated: -16, peak: -1.5 });
montage.loudnessTargets();            // youtube, spotify -14; apple, podcast -16; ebu -23; atsc -24
```

## Playback, history, export

Frame n of a project renders at the time n / fps (the start of the frame), in preview and in export alike, so transitions and animations land on the same values in both.

`play(rate)` shuttles: rates above 1 play faster with pitched audio, negative rates scrub backward without audio. `rate` is 0 while paused.

```js
montage.seek(12.5);
await montage.play();
await montage.play(4);
await montage.play(-2);
montage.pause();
montage.rate;
montage.levels();                                // output peak per channel while playing, 0–1

montage.project();                           // a deep copy of the whole project model (JSON)
montage.undo();
montage.redo();
await montage.batch(async () => { /* several edits, one undo step */ });

const { file, name } = await montage.render({ height: 1080, quality: 'high', onProgress: (f) => log(f) });
await montage.render({ prores: 'hq', dynamicRange: 'hlg' }); // dynamicRange: 'sdr' | 'hlg' | 'pq', Rec.2020 for HDR
await montage.render({ prores: 'hq' });           // 'hq' | 'standard' | 'lt' | 'proxy': ProRes 422 in .mov with PCM audio
await montage.render({ range: { in: 10, out: 12.5 } });    // only this part of the timeline, snapped to frames; effect tails are cut at the Out
await montage.render({ timeline: id });          // any timeline, in its own frame size, without opening it
const off = montage.onChange(() => log('changed'));

```

### Render queue

Jobs render one after another, each with its own timeline and settings. Files stay in the browser's private storage until the next queue run that starts with no finished jobs; a single `render()` call never removes them. Export never scales above the timeline's frame size.

```js
montage.queue.presets();   // [{ id: 'master' | 'mezzanine' | 'web1080' | 'web720' | 'review', label, settings }]
montage.queue.add({ timeline: id, preset: 'web720', name: 'Client cut' });  // all fields optional; settings override the preset
montage.queue.add({ settings: { prores: 'lt', height: 720, range: { in: 0, out: 30 } } });
montage.queue.outputs([main, teaser], ['master', 'web1080']);  // every timeline × every output
const jobs = await montage.queue.start();  // [{ id, name, timeline, settings, status, progress, error, size }]
montage.queue.list();
montage.queue.file(jobs[0].id);   // File | null
montage.queue.stop();             // cancels the running job, leaves the rest queued
montage.queue.retry(id);          // a failed or canceled job
montage.queue.remove(id);
montage.queue.clearFinished();
```

```js
montage.diagnostics.entries();   // [{ time, level, source, message, stack?, count }]
montage.diagnostics.warn('note from a script');
montage.diagnostics.clear();
```
