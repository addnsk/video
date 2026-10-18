# Montage: working notes

## Owner's rules

- No comments in code. No Russian anywhere in the repository (code, docs, tests) except the UI translation `src/i18n/ru.ts`, which the owner approved. Talk to the owner in Russian.
- Code must be abstract and layered; keep the layer boundaries below.
- Commit and push each finished step to `main` with the session attribution lines.
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
- `CHROME_PATH=... npm run test:e2e [-- suite ...]` — browser suites in `tests/e2e/suites` on `tests/e2e/harness.mjs` (audio, color, diagnostics, prores-export, media-drag, multitrack, persistence, playback, proxies, stress, transitions). New suites export `{ name, run({ browser, url, checks }) }`.
- `npm run build` — type-check and build.

## Status

Done: Russian UI with a language switch, ProRes encoder worker pool (`encoderThreads` in the budget), automatic BMD Film transform from the `com.apple.proapps.customgamma` tag (`AssetMeta.defaultEffects`), problem log (`core/log`, `host/log-store`, `host/error-capture`, worker error forwarding, `ui/diagnostics-dialog`), ProRes 422 export (`engine/export/prores` encoder fed by a float readback of the composite through `export/video-writers.ts`, `export/formats.ts` plans), live animation presets (`core/presets`, `core/resolve`, keyframe easing), audio effects (`effects/audio`: low cut, EQ, compressor in the mixer) and level meters, clip speed (`setSpeed`, mixer resamples by speed), synchronous store transactions, media panel drag to timeline (`DropTarget`, `dragSource`), timeline thumbnails (engine `thumbnails`, host `AssetDataCache`), J/K/L shuttle (transport rate), unit, API integration (fake engine) and e2e suites; worker engine with memory budget, proxies, streaming export, project persistence, Pages deploy workflow with coi-serviceworker, curves, scopes, BMD Gen5 gamut, multitrack, titles, keyframes, waveforms, scripting API (`docs/API.md`).

The owner must enable Settings → Pages → Source: GitHub Actions. Published preview: https://claude.ai/artifact/HGAVKmA9JAvLH71uheStDR (republish from a copy of `dist` with an `index.html` fragment that links the built css/js; drop the coi script there).

## Next (agreed with the owner)

1. The owner's real sample (BMD Film log, ProRes 422 1080p25, Google Drive id 12nX-cC_qCGPIiGldbwZQjF-DztMCiKO8) passed decode, look, proxy, playback and export; it stays out of git (a person in frame, no license).
3. Then: HDR (PQ/HLG tagging and a 10-bit HEVC path; the float readback `RenderOptions.readback` already exists).
