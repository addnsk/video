# Montage: working notes

## Owner's rules

- No comments in code. No Russian anywhere in the repository (code, UI strings, docs). Talk to the owner in Russian.
- Code must be abstract and layered; keep the layer boundaries below.
- Commit and push each finished step to `main` with the session attribution lines.
- The owner checks results only when a whole block is done; work autonomously, report at the end.

## Layers

`core` (pure model, operations, store, rpc) → `effects` (data-only GLSL defs) → `engine` (worker: media, gpu, audio, export) → `host` (engine client, transport, session, persistence) → `api` (`montage`) → `ui`. Strings live in `src/i18n/en.ts`.

## Environment

- npm registry is not resolvable directly; use `npm config set registry https://registry.npmmirror.com`, then rewrite `package-lock.json` URLs back to `https://registry.npmjs.org/`. Verify new packages against jsDelivr hashes.
- Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (no H.264 encoder/decoder; VP9 is used for export and proxies there).
- Preview server: `npx vite preview --port 4173` in background. Stop it with `fuser -k 4173/tcp`; never `pkill -f` (it kills the calling shell).
- Fixtures are generated with ffmpeg (ProRes 422 HQ 10-bit testsrc2, smptehdbars, wav).

## Commands

- `npm test` — vitest unit tests (`tests/unit`).
- `CHROME_PATH=... npm run test:e2e [-- suite ...]` — browser suites in `tests/e2e/suites` on `tests/e2e/harness.mjs` (color, transitions, multitrack, persistence, proxies, stress). New suites export `{ name, run({ browser, url, checks }) }`.
- `npm run build` — type-check and build.

## Status

Done: unit, API integration (fake engine) and e2e suites; worker engine with memory budget, proxies, streaming export, project persistence, Pages deploy workflow with coi-serviceworker, curves, scopes, BMD Gen5 gamut, multitrack, titles, keyframes, waveforms, scripting API (`docs/API.md`).

The owner must enable Settings → Pages → Source: GitHub Actions. Published preview: https://claude.ai/artifact/HGAVKmA9JAvLH71uheStDR (republish from a copy of `dist` with an `index.html` fragment that links the built css/js; drop the coi script there).

## Next (agreed with the owner)

1. The owner is uploading a real Blackmagic ProRes sample (about 100 MB) via a cloud link; download it, inspect with ffprobe, verify decode, BMD Film → Rec.709 look, proxy, playback and export, and add a short cut of it as a fixture if licensing allows (otherwise keep it out of git).
2. Russian locale `src/i18n/ru.ts` with a language switch (UI text only, keys mirrored from `en.ts`).
3. Then: J/K/L shuttle, clip thumbnails on the timeline, drag from media panel to timeline, speed change, audio meters and effects, title animation presets, ProRes/HDR export, error logging.
