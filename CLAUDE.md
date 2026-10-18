# Montage: working notes

## Owner's rules

- No comments in code. No Russian anywhere in the repository (code, docs, tests) except the UI translation `src/i18n/ru.ts`, which the owner approved. Talk to the owner in Russian.
- Code must be abstract and layered; keep the layer boundaries below.
- Commit and push each finished step to `main` with the session attribution lines.
- Every scripting API addition or change is documented in `docs/API.md` (the source for the future user documentation) in the same commit. Every known limitation of a feature goes into `docs/LIMITATIONS.md` in the same commit.
- The owner checks results only when a whole block is done; work autonomously, report at the end.

## Layers

`core` (pure model, operations, store, rpc) → `effects` (data-only GLSL defs) → `engine` (worker: media, gpu, audio, export) → `host` (engine client, transport, session, persistence) → `api` (`montage`) → `ui`. Strings live in `src/i18n/en.ts` and are mirrored in `src/i18n/ru.ts` (parity is unit-tested); the locale is chosen in `host/locale-preference.ts`. Effect, preset and example names are still English data labels.

## Environment

- npm registry is not resolvable directly; use `npm config set registry https://registry.npmmirror.com`, then rewrite `package-lock.json` URLs back to `https://registry.npmjs.org/`. Verify new packages against jsDelivr hashes.
- Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (no H.264 encoder/decoder; VP9 is used for export and proxies there).
- Preview server: `npx vite preview --port 4173` in background. Stop it with `fuser -k 4173/tcp`; never `pkill -f` (it kills the calling shell).
- Fixtures are generated with ffmpeg (ProRes 422 HQ 10-bit testsrc2, smptehdbars, wav).

## Commands

- `npm test` — vitest unit tests (`tests/unit`).
- `SOFTWARE_GL=1 CHROME_PATH=... npm run test:e2e [-- suite ...]` — browser suites in `tests/e2e/suites` on `tests/e2e/harness.mjs` (audio, color, diagnostics, prores-export, media-drag, multitrack, persistence, playback, proxies, stress, transitions). New suites export `{ name, run({ browser, url, checks }) }`.
- `npm run build` — type-check and build.
- `npm run bench [-- profile|source|--quick]` — benchmarks (`tests/bench/run.mjs`, `docs/BENCHMARK.md`). In this cloud use `CHROME_PATH=... SOFTWARE_GL=1`.

## Status

Done: HDR ProRes export (Rec.2020 HLG/PQ via `ENCODINGS` in `export/prores/color.ts`), Russian UI with a language switch, ProRes encoder worker pool (`encoderThreads` in the budget), automatic BMD Film transform from the `com.apple.proapps.customgamma` tag (`AssetMeta.defaultEffects`), problem log (`core/log`, `host/log-store`, `host/error-capture`, worker error forwarding, `ui/diagnostics-dialog`), ProRes 422 export (`engine/export/prores` encoder fed by a float readback of the composite through `export/video-writers.ts`, `export/formats.ts` plans), live animation presets (`core/presets`, `core/resolve`, keyframe easing), audio effects (`effects/audio`: low cut, EQ, compressor in the mixer) and level meters, clip speed (`setSpeed`, mixer resamples by speed), synchronous store transactions, media panel drag to timeline (`DropTarget`, `dragSource`), timeline thumbnails (engine `thumbnails`, host `AssetDataCache`), J/K/L shuttle (transport rate), unit, API integration (fake engine) and e2e suites; worker engine with memory budget, proxies, streaming export, project persistence, Pages deploy workflow with coi-serviceworker, curves, scopes, BMD Gen5 gamut, multitrack, titles, keyframes, waveforms, scripting API (`docs/API.md`).

The owner must enable Settings → Pages → Source: GitHub Actions. Published preview: https://claude.ai/artifact/HGAVKmA9JAvLH71uheStDR (republish from a copy of `dist` with an `index.html` fragment that links the built css/js; drop the coi script there).

## Current work (handoff)

- Phase 2/3 (Fusion) in progress. Done: node graph core (`core/graph.ts`, `core/graph-operations.ts`; graph lives in `item.graph` as links + positions, node params stay in `item.effects`), GPU evaluation (`engine/gpu/graph-renderer.ts` with refcounted targets and a static-branch node cache), built-in nodes (`effects/builtin/nodes.ts`: merge, transform, blur, glow, crop, invert, background, gradient, ellipse/rectangle/polygon masks, keyer), `color` and `points` param types, per-node keyframes (`node.<id>.<param>`, array components as `param.<index>`), node editor tab (`ui/node-editor.ts`, `ui/node-layout.ts`), node view in viewer, polygon point editing on the viewer (`ui/mask-overlay.ts`), API `montage.graph.*` and `montage.nodes.register`.
- Compositing now runs in project frame space (`Compositor.setFrame`, `px()` helper in node GLSL scales project pixels to preview).
- Point tracker done: `engine/tracking/{tracker,track-media}.ts` (engine `track`), `core/tracking.ts` (frame/source mapping, follow and stabilize keyframes), `host/point-tracking.ts`, API `montage.track`, viewer pick (`ui/point-picker.ts`, `ui/track-action.ts`), e2e `tracking`.
- Text node done: `effects/builtin/text-node.ts` (`raster: 'text'` nodes get `raster(uv)`, `glyph(i)`), `engine/text-raster.ts`, `engine/gpu/raster.ts` (rasterizers registered on the compositor), `text` param type, e2e `text-node`.
- Stylize/transform nodes in `effects/builtin/stylize-nodes.ts`; `time()` in node GLSL with `temporal` defs excluded from the node cache; e2e `fusion-nodes` compiles every built-in node.
- Node templates: `core/graph-templates.ts` (capture/place), `host/template-library.ts` (localStorage), API `graph.template`/`graph.insert`/`templates.*`, node editor Save template.
- Next: render cache spill to OPFS (phase 1), color page (phase 4).
- GLSL gotchas: `half`, `smooth`, `input`, `output`, `sample` are reserved; unbound sampler inputs must get the empty texture (feedback loop otherwise).

## Known issues

- Rare page error "memory access out of bounds" (seen once in the `fusion` suite, not reproducible in reruns); suspected in the ProRes WASM decoder under concurrent decoding (stills, thumbnails, playback readers on one file). Investigate with a concurrency stress test.

## Next (agreed with the owner)

The full plan is `docs/ROADMAP.md`; work through its phases in order.


1. The owner's real sample (BMD Film log, ProRes 422 1080p25, Google Drive id 12nX-cC_qCGPIiGldbwZQjF-DztMCiKO8) passed decode, look, proxy, playback and export; it stays out of git (a person in frame, no license).
2. Later: HDR in MP4 needs a 10-bit HEVC encoder (not in this Chromium, untestable here); HDR preview on HDR displays; translating effect/preset labels.
