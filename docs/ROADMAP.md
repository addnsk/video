# Roadmap

Goal: a production-ready editor. A phase is done only when its features have no known fixable defects; open items are finished before the next phase starts.

What Montage still needs, in the order we plan to build it. Each phase ends with unit and e2e coverage and an update of this file.

## Principles

- Memory first: every new feature declares its memory cost and lives inside the device budget (`engine/device.ts`). Browser tabs have a hard ceiling of roughly 2–4 GB (less on iOS); we never rely on the garbage collector for frames, textures or buffers.
- One graph for everything visual: compositing (Fusion-like), color nodes and clip effects share a single node graph and renderer.
- The engine stays UI-agnostic: everything the UI does goes through `core` operations and the `montage` API, so the UI can be replaced.

## Out of scope

- RAW formats (BRAW and others): closed SDKs, native only.
- DeckLink or other external video output, reference HDR monitoring.
- 3D scenes in compositing.
- AI features (masks, voice isolation, reframing, optical-flow retiming): a separate track after this roadmap.

## Phase 1. Limits, memory and performance

Status: engine metrics, benchmark runner (`docs/BENCHMARK.md`), memory governor and platform capability detection the render cache (memory with OPFS spill), per-device proxy policy (budget classes) and the long 4K timeline stress suite are done. Phase 1 is complete.


- Benchmark suite first: find where we hit limits (decode throughput per codec and resolution, upload and render cost per effect, memory per open source, cache hit rates, playback frame drops, export speed) on desktop and phone profiles, recorded per run so regressions show up.
- Global memory governor: one budget across frame cache, textures, render targets, audio buffers, thumbnails and graph intermediates; pressure levels that shrink caches and lower preview resolution.
- Render cache: cached composited frames for heavy ranges (in memory within budget, spilled to OPFS), invalidated by graph and project hashes.
- Long 4K projects: streaming everything, bounded decoders, proxy policy per device class, measured in a long-timeline stress suite.
- Telemetry in `montage.stats()` and the problem log for memory pressure events.

## Phase 2. Node graph core (Fusion foundation)

Status: model, operations, evaluation with pooled targets, built-in nodes, API and per-node keyframes are done; the node editor UI and per-node caching are next.


- Graph model in `core`: nodes, typed ports (image, mask, number), links, parameters with keyframes, groups/macros; operations and undo like the rest of the model.
- Graph evaluation in the engine: topological scheduling, pooled render targets, region of interest and domain of definition, per-node caching.
- Each clip owns a graph; the default graph reproduces today's effect chain so existing projects migrate unchanged.
- Node editor UI (pan, zoom, connect, view any node in the viewer), a simplified list view on phones.
- Custom nodes from the scripting API: GLSL with multiple inputs and typed parameters.

## Phase 3. Compositing nodes

Status: merge, transform, crop, background, gradient, blur, glow, polygon and shape masks, keyer, the point tracker (follow and stabilize) the Text+ style text node (per-character animation, outline, shadow), noise, film grain, vignette, sharpen, directional and radial blur, displace, corner pin, lens distortion, letterbox, luma key, mask operations, matte control and node templates are done. Phase 3 is complete.

- Merge with blend modes, Transform, Crop, Resize, Letterbox, Background, Gradient, Noise.
- Blur, Glow, Sharpen, Directional and Radial blur, Displace, Corner pin, Lens distortion, Vignette, Film grain.
- Text+ style text node: per-character animation, outlines, shadows, follow-on presets.
- Shapes and paint: rectangle, ellipse, polygon and Bezier masks with feather, animated by keyframes (rotoscoping), mask operations.
- Keyers: chroma key with spill suppression, edge cleanup, luma key, matte controls.
- Tracking: point tracker driving masks, text and transforms; stabilization.
- Templates: saving node groups as reusable titles and effects.

## Phase 4. Color page

Status: qualifiers (HSL, 3D), parallel mixer, hue/lum/sat curves, HDR wheels, color warper and color management (input spaces, ACEScct working space, ACES output transform) noise reduction (spatial and recursive temporal), stills with wipe comparison, grade versions and grade copying are done. Phase 4 is complete.

- Color nodes in the shared graph: serial, parallel and layer mixers.
- Windows (circle, linear, polygon, curve) with tracking; HSL and 3D qualifiers.
- Curves: hue vs hue, hue vs lum, lum vs sat, sat vs sat; HDR wheels; color warper.
- Color management: project working space, input and output transforms per camera, ACES.
- Noise reduction (spatial, then temporal within the memory budget), sharpen.
- Stills gallery, split-screen and wipe comparison, grade versions, copy and apply grades.

## Phase 4.5. Native hot paths

Heavy CPU work moves out of plain JavaScript; everything else stays as is (decoding and encoding through WebCodecs, rendering on the GPU).

- Done: ProRes encoder slice coding in WebAssembly SIMD (`native/prores/encoder.c`, built by `scripts/build-wasm.sh` with clang). Output is byte-identical to the JS encoder, which stays as the fallback; threads are the existing worker pool. Together with a quantizer search that starts from the previous slice, a 1080p HQ frame went from 2434 ms to 190 ms per worker (Node, one core).
- Done: point tracker correlation in WebAssembly SIMD (`native/tracking/matcher.c`), JS scorer kept as the fallback. A 21 px patch over a ±48 px search on a 1080p frame takes 4.3 ms instead of 14 ms; at the default ±16 px, 0.8 ms instead of 2.7 ms. The rest of a tracking step (decoding and reading the frame back) now dominates, so a GPU matcher is not worth it yet.
- Done differently: scopes analyse a 320 px wide copy of the frame, which takes about 1 ms on the CPU, so a GPU histogram would gain nothing. The real cost was the synchronous `readPixels` stalling the GPU every 120 ms; the copy is now read back asynchronously (pixel buffer and fence), and scopes trail the picture by a frame or two.

## Phase 5. Audio (Fairlight-like)

- Done: mixer with track strips (volume in dB, balance pan, mute, effects, volume and pan automation), buses and a master strip (`core/mix.ts`, `engine/audio/strips.ts`, `ui/panels/mixer-panel.ts`, `montage.mixer`).
- Done: loudness per BS.1770 / EBU R128 (integrated, short-term, momentary, range, sample peak; matches ffmpeg's `ebur128` within 0.15 LU), platform targets and `normalize`, which adds a master limiter when needed.
- Done: voice cleanup effects for clips and strips: spectral noise reduction, gate, de-esser, limiter.
- Done: live momentary and short-term loudness in the transport, true-peak measurement.
- Done: sends (pre/post fader), bus-to-bus routing with loop checks, reverb and delay, latency compensation across clips, tracks and buses, effect tails after the last clip, warm-up after seeks, a true-peak look-ahead limiter and a trim stage that `normalize` uses.

## Next (color and compositing)

These are planned features, not defects of what exists:

- ACES HDR output transforms (Rec.2100 PQ/HLG at 1000 nits); today an ACES project goes through the Rec.709 RRT/ODT fit, so HDR export from ACES carries SDR-mapped highlights. Use the `display` working space for HDR deliveries until then.
- Exposure-index-aware ARRI LogC3 (today EI 800) and camera-specific IDT matrices; detection of more camera log tags on import.
- Motion-compensated temporal noise reduction and non-local-means spatial noise reduction.
- Wipe layouts (split screen, angle, ungraded comparison) and full-resolution stills stored next to the project.
- Per-node resolution and region of interest; 3D scenes, cameras and lights; open strokes and paint.
- Faster first playback of 4K ProRes right after import (decoders, thumbnails and proxies start together today).

## Later (text)

- Loading user fonts (font files and Google Fonts); today the text node offers IBM Plex Sans, IBM Plex Mono and the system serif and sans-serif.

## Later (tracking)

- Planar tracking (rotation, scale and perspective) and multi-point trackers; today a tracker follows one point in translation.

## Later (audio)

- Surround (5.1) buses and export; today the mix is stereo.

## Phase 6. Edit page

- Source viewer with In and Out, three-point editing, insert and overwrite.
- Ripple, roll, slip and slide trims; trim mode.
- Markers, linked audio and video, nested timelines, several timelines per project.
- Bins, search, clip metadata.
- Multicam.

## Phase 7. Deliver and interchange

- Render queue with several outputs.
- OTIO, FCPXML and EDL export and import to move projects to and from DaVinci Resolve.
- Subtitles: SRT import and export, burn-in, styling.
- Remote storage: S3-compatible buckets for media and projects.

## Phase 8. AI track

Separate planning later: masks, voice isolation, transcription for subtitles, reframing, speed warp.

## Phase 9. Interface redesign

The current UI is hand-written DOM. After the AI track we move it to React; until then new features get functional UI in the current DOM layer.

- React 18 with `useSyncExternalStore` bindings over `Store`, `Transport`, `EditorSession` and `EventLog`; no second state store.
- Canvas-heavy views (viewer, timeline, scopes, curves, wheels) stay imperative components wrapped in React.
- A design system: tokens (color, spacing, type), light and dark themes, components (buttons, sliders, numeric drag fields, menus, popovers, dialogs, tabs, panels) built on accessible headless primitives.
- Workspace layout: resizable, dockable panels; pages like Resolve (Edit, Fusion, Color, Fairlight, Deliver) sharing one project; a dedicated phone layout.
- Keyboard map and command palette.
- Migration panel by panel, with e2e suites kept green; the old DOM UI is removed at the end.
