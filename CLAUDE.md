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

- Property tests: `tests/unit/fuzz` (fast-check): `world.ts` turns random action lists into real operations on a `Store`, `invariants.ts` checks the project after every step. `FUZZ_RUNS=5000 npm test -- fuzz` for a deep run; a failure prints the seed and a shrunk action list — add it to `fuzz/regressions.test.ts`.

- `npm test` — vitest unit tests (`tests/unit`).
- `SOFTWARE_GL=1 CHROME_PATH=... npm run test:e2e [-- suite ...]` — browser suites in `tests/e2e/suites` on `tests/e2e/harness.mjs` (audio, color, diagnostics, prores-export, media-drag, multitrack, persistence, playback, proxies, stress, transitions). New suites export `{ name, run({ browser, url, checks }) }`.
- `npm run build` — type-check and build.
- `npm run bench [-- profile|source|--quick]` — benchmarks (`tests/bench/run.mjs`, `docs/BENCHMARK.md`). In this cloud use `CHROME_PATH=... SOFTWARE_GL=1`.

## Status

Done: HDR ProRes export (Rec.2020 HLG/PQ via `ENCODINGS` in `export/prores/color.ts`), Russian UI with a language switch, ProRes encoder worker pool (`encoderThreads` in the budget), automatic BMD Film transform from the `com.apple.proapps.customgamma` tag (`AssetMeta.defaultEffects`), problem log (`core/log`, `host/log-store`, `host/error-capture`, worker error forwarding, `ui/diagnostics-dialog`), ProRes 422 export (`engine/export/prores` encoder fed by a float readback of the composite through `export/video-writers.ts`, `export/formats.ts` plans), live animation presets (`core/presets`, `core/resolve`, keyframe easing), audio effects (`effects/audio`: low cut, EQ, compressor in the mixer) and level meters, clip speed (`setSpeed`, mixer resamples by speed), synchronous store transactions, media panel drag to timeline (`DropTarget`, `dragSource`), timeline thumbnails (engine `thumbnails`, host `AssetDataCache`), J/K/L shuttle (transport rate), unit, API integration (fake engine) and e2e suites; worker engine with memory budget, proxies, streaming export, project persistence, Pages deploy workflow with coi-serviceworker, curves, scopes, BMD Gen5 gamut, multitrack, titles, keyframes, waveforms, scripting API (`docs/API.md`).

The owner must enable Settings → Pages → Source: GitHub Actions. Published preview: https://claude.ai/artifact/HGAVKmA9JAvLH71uheStDR (republish from a copy of `dist` with an `index.html` fragment that links the built css/js; drop the coi script there).

## Current work (handoff)

- Phases 1–4 of `docs/ROADMAP.md` are done (Fusion-like nodes, tracking, text node, templates, render cache, color nodes, ACES color management, noise reduction, stills/versions). Details of each area are in `docs/API.md` and `docs/LIMITATIONS.md`.
- Phase 4.5 (native hot paths): ProRes encoder is done (`native/prores/encoder.c` → `src/engine/export/prores/prores.wasm` via `scripts/build-wasm.sh`; rebuild and commit the .wasm after editing the C; `tests/unit/prores-native.test.ts` checks byte parity with the JS coder, so change both together). The tracker scorer is native too (`native/tracking/matcher.c` → `src/engine/tracking/matcher.wasm`, parity in `tests/unit/tracking-native.test.ts`). Scopes read back asynchronously (pixel buffer + fence in `gpu/compositor.ts` `readCapture`). Phase 4.5 is done; next is phase 5 (audio). The `playback` e2e check "L plays at normal speed" fails under software GL with or without these changes (timing).
- The owner said to stop spending time on tests for now. Open test items, only if asked: the last `pairwise` run (two combinations failed before the flatness ring was widened to ±5 px; not re-run), and mutation testing (`npm run test:mutation`, Stryker configured, never run).
- Test infrastructure: property tests in `tests/unit/fuzz` (see Commands), browser suites `random-projects` and `pairwise` compare preview with exported ProRes via `tests/e2e/lib/parity.mjs` (block luma everywhere, RGB only in chroma-flat areas; ProRes 4:2:2 and compression limits are expected and documented).
- `montage.sample` returns displayed values (composited over black); frames render at n / fps.
- Node GLSL `time()` is the source media time; temporal-denoise history uses clip-local time.
- GPU gotcha: any lazily created texture must be created with the right `activeTexture` unit, otherwise it clobbers the sampler bound just before.
- GLSL gotchas: reserved names are refused by `effects/glsl-names.ts`; unbound sampler inputs must get the empty texture.

## Known issues

- "memory access out of bounds" in the ProRes WASM decoder: the old guard patched a separate copy of turbores (`@mediabunny/prores` bundles its own), so it never worked. Replaced by `engine/media/prores-decoder.ts`, our own mediabunny `CustomVideoDecoder` over `turbores` that serializes all decodes and closes on the shared runtime. The error reproduced on random project seed 100 before and is gone in repeated runs since.

## Next (agreed with the owner)

The full plan is `docs/ROADMAP.md`; work through its phases in order.


1. The owner's real sample (BMD Film log, ProRes 422 1080p25, Google Drive id 12nX-cC_qCGPIiGldbwZQjF-DztMCiKO8) passed decode, look, proxy, playback and export; it stays out of git (a person in frame, no license).
2. Later: HDR in MP4 needs a 10-bit HEVC encoder (not in this Chromium, untestable here); HDR preview on HDR displays; translating effect/preset labels.
