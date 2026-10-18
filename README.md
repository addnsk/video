# Montage

A video editor that runs entirely in the browser. Media never leaves the device.

- **ProRes**, including 10-bit footage from Blackmagic cameras, decoded with the `@mediabunny/prores` WASM decoder. H.264, HEVC, VP9 and AV1 use the browser's WebCodecs decoders.
- **GPU color**: Blackmagic Film Gen 5 → Rec.709 with the Wide Gamut matrix, exposure, white balance, lift/gamma/gain wheels, contrast, saturation and `.cube` 3D LUTs, processed in half-float.
- **Multitrack editing**: a magnetic main track, free video tracks for overlays and picture-in-picture, audio tracks for music, mute per track, snapping.
- **Titles** with bundled Latin and Cyrillic fonts, background boxes and alignment.
- **Keyframes** with easing for opacity, position, scale, rotation, volume and any effect parameter, plus live **animation presets** (rise, pop, slide, fade, sink, shrink, slow zoom, drift) that follow trims and speed changes.
- **Clip speed** from 0.1× to 16× with retimed audio, and **J/K/L shuttle** up to 8× forward and backward.
- **Curves** (master, RGB, hue vs saturation) and **scopes** (waveform, RGB parade, vectorscope, histogram).
- **Audio**: waveforms and frame thumbnails on the timeline, per-clip volume, crossfades on transitions, audio-only files, per-clip low cut, 3-band EQ and compressor, output level meters.
- **Export** to MP4 (H.264, HEVC, VP9 or AV1 via WebCodecs) or **Apple ProRes 422 HQ, 422, LT and Proxy** in `.mov` with PCM audio, encoded by a built-in multi-threaded ProRes encoder, in SDR Rec.709 or HDR Rec.2020 HLG/PQ from the half-float composite.
- **Projects** autosave in the browser, reconnect their media after a reload and save to or open from `.json` files.
- **Transitions** in the [gl-transitions](https://gl-transitions.com) format, and custom GLSL filters. Both register at runtime.
- **Scripting API** (`montage`) for everything the UI does. See [docs/API.md](docs/API.md).
- **Undo/redo** for every edit, including scripts.
- **Problem log**: errors from the UI, the engine worker, media, exports and scripts are kept across reloads and export as a JSON report with the environment.
- English and Russian interface.
- Blackmagic Film log footage is detected from its metadata and gets the Rec.709 transform on import.
- Works on phones: adaptive layout, touch gestures, automatic proxies.

## Deploying

`.github/workflows/deploy.yml` tests, builds and publishes to GitHub Pages on every push to `main`. Enable it once under **Settings → Pages → Source: GitHub Actions**. The page registers `coi-serviceworker` so it is cross-origin isolated, which lets the ProRes decoder use shared-memory threads.

## Running

```bash
npm install
npm run dev
```

## Tests

```bash
npm test
SOFTWARE_GL=1 CHROME_PATH=/path/to/chrome npm run test:e2e
npm run test:e2e -- color transitions
npm run bench                     # see docs/BENCHMARK.md
```

`npm test` runs unit and API integration tests in node; the API tests drive `EditorSession` and the `montage` scripting API against a fake engine.

`test:e2e` needs `ffmpeg` and builds fixtures on first run. It serves the production build and runs browser suites from `tests/e2e/suites` on a shared harness (`tests/e2e/harness.mjs`), checking rendered pixels and engine resource counters:

- `audio`: output levels, low cut, EQ gain at a known frequency, audio effect controls, export through the effect chain.
- `diagnostics`: logging of bad media, script errors and uncaught exceptions, the log dialog, report download, persistence.
- `media-drag`: dragging from the media panel to the main and overlay tracks, refusals, undo.
- `playback`: J/K/L shuttle rates, reverse, clip speed and retimed export.
- `prores-export`: ProRes HQ and Proxy exports checked with `ffprobe` and `ffmpeg`, and imported back.
- `color`: exposure, compare bypass, curves, LUTs, saturation, BMD Film Gen5 input transform, all four scopes.
- `transitions`: dissolve mix, every built-in transition, custom gl-transition shaders and their params.
- `multitrack`: placement by media type, overlay transform, opacity keyframes, muted tracks, titles, export, phone layout.
- `persistence`: reload restore, relinking, project file save, new and open.
- `proxies`: proxy build into OPFS and playback from it.
- `stress`: a 150-clip timeline, seek storm, playback and export in worker and inline modes, failing on leaked frames, samples or render targets, or a frame cache over budget.

## Keys

| Key | Action |
|---|---|
| Space | Play / pause |
| J / K / L | Shuttle backward / stop / forward; repeat J or L for 2×, 4×, 8× |
| S | Split at the playhead |
| Delete | Delete the selected clip |
| ← → | Previous / next frame |
| B | Before / after color |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |

## Architecture

```
ui ──► api ──► host ──rpc──► engine (worker)
 │              │               ├─ media: pool, readers, frame cache, proxies
 └──────────────┴─► core        ├─ gpu: context, targets, compositor
                    effects     ├─ audio: mixer
                                └─ export: streaming muxer, sinks
```

| Layer | Responsibility |
|---|---|
| `src/core` | Immutable project model, pure timeline layout, operations, history store, typed RPC. No DOM. |
| `src/effects` | Effect definitions as data: GLSL plus parameter specs. Built-in color, LUT and transitions. Color-space math. |
| `src/engine` | Runs in a Web Worker with an `OffscreenCanvas`, or in the main thread when the browser lacks worker WebGL2. Owns decoding, caching, compositing, mixing and export. |
| `src/host` | Main-thread side: engine connection, audio output and transport clock, session wiring. |
| `src/api` | The public `montage` scripting API. |
| `src/ui` | Components and panels. Effect parameters render from their specs. |
| `src/i18n` | UI strings. |

### Memory model

- A device profile sets the budget: preview resolution, frame cache size, open decoders, proxy policy.
- Seeking is coalesced: only the latest request decodes, stale ones are dropped.
- Preview frames are downscaled right after decoding and kept in a byte-bounded LRU cache.
- Playback keeps at most two decoded frames per visible clip and prefetches the next clip a second ahead.
- GPU textures and render targets are allocated once per size and reused. A lost WebGL context is rebuilt.
- Exports stream to disk (the chosen file, or origin-private storage), so length is not limited by memory.
- Large or heavy sources get proxies in origin-private storage; preview reads proxies, export reads originals.
- Every decoded frame, bitmap, texture and target is counted; `montage.stats()` reports live and peak usage.
