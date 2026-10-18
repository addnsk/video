# Montage

A video editor that runs entirely in the browser. Media never leaves the device.

- **ProRes**, including 10-bit footage from Blackmagic cameras, decoded with the `@mediabunny/prores` WASM decoder. H.264, HEVC, VP9 and AV1 use the browser's WebCodecs decoders.
- **GPU color**: Blackmagic Film Gen 5 → Rec.709 with the Wide Gamut matrix, exposure, white balance, lift/gamma/gain wheels, contrast, saturation and `.cube` 3D LUTs, processed in half-float.
- **Transitions** in the [gl-transitions](https://gl-transitions.com) format, and custom GLSL filters. Both register at runtime.
- **Scripting API** (`montage`) for everything the UI does. See [docs/API.md](docs/API.md).
- **Undo/redo** for every edit, including scripts.
- Works on phones: adaptive layout, touch gestures, automatic proxies.

## Running

```bash
npm install
npm run dev
```

## Tests

```bash
npm test
CHROME_PATH=/path/to/chrome npm run test:stress
```

`test:stress` needs `ffmpeg`. It builds a 150-clip timeline, runs a seek storm, playback and an export in both engine modes, and fails if decoded frames, audio samples or render targets leak, or if the frame cache exceeds its budget.

## Keys

| Key | Action |
|---|---|
| Space | Play / pause |
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
