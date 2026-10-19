# Known limitations

Montage is built as a production-ready editor. This file lists only what cannot be fixed on our side (browser APIs, hardware, physics, standards), each with the reason; anything fixable is fixed instead of being listed. Features that are planned but not built yet are in `docs/ROADMAP.md`.

## Media and formats

- RAW formats (BRAW, R3D, ARRIRAW) cannot be decoded: their SDKs are closed, native-only and not licensed for the web. Convert to ProRes first.
- H.264 and HEVC decoding and encoding come from the browser's WebCodecs; Chromium builds without proprietary codecs (some Linux distributions) have neither, so export and proxies fall back to VP9 there.
- HDR in MP4 needs a 10-bit HEVC encoder in the browser, which most do not expose; HDR export is therefore ProRes (Rec.2020 HLG/PQ). The preview is SDR because browsers cannot present HDR from a WebGL canvas yet.

## Preview and export

- ProRes 422 stores color at half horizontal resolution (that is the format): on sharp edges between saturated colors the exported chroma bleeds by a pixel and clips (for example a blue/black edge reads 0.46 blue in the edge pixel). Flat colors round-trip within 0.1%, luma is exact per pixel. Near strong edges ProRes compression adds up to about 3% ringing to saturated colors.
- The native ProRes encoder needs WebAssembly SIMD (every current browser has it); without it export falls back to the JS encoder, about three times slower.

## Render cache

- Which frames are "heavy" is judged by CPU time and render passes, not GPU time: browsers expose GPU timer queries only behind flags (EXT_disjoint_timer_query is disabled in Chrome for security).

## GPU limits

- Polygon and Bezier masks take up to 1024 vertices: the shader tests every outline segment for every pixel, so each vertex costs GPU time on every frame (a 1024-vertex Bezier mask samples 4096 segments).
- While a text animates, each glyph is drawn from its own cell in a glyph atlas; the atlas is one GPU texture up to 8192 px tall (the size every WebGL2 GPU supports), so a very long text at a large size (thousands of glyphs) animates only the glyphs that fit, and the rest appear when the animation ends.

## Platform

- Browser tabs have a memory ceiling of roughly 2–4 GB (less on iOS); the memory governor lowers preview resolution under pressure.
- Worker threads need cross-origin isolation (COOP/COEP headers or the bundled service worker); on hosts that allow neither, the engine runs on the main thread and is slower.

## Audio

- Very strong noise reduction on broadband hiss leaves faint "musical noise" (isolated tones where the noise briefly exceeds its estimate). Every spectral noise reducer trades this against how much noise it removes; lower `reduction` or raise `sensitivity` if it is audible.
- True peak is measured with a 48-tap windowed-sinc 4× interpolator rather than the exact BS.1770-4 reference filter; readings agree with ffmpeg's `ebur128` true-peak meter to 0.1 dB in our tests. The standard allows implementation-defined interpolators.
- The live loudness readout measures audio when it is handed to the browser's audio output, a fraction of a second before it is heard (the Web Audio scheduling lookahead), and covers only 1× playback because shuttle audio is resampled by the browser.

## Timeline exchange (OTIO, FCPXML, EDL)

- Effects, grades, node graphs, masks and keyframes stay in Montage: none of the three formats has a shared description of them that DaVinci Resolve or Final Cut would read. Cuts, gaps, dissolves, speed, nested timelines, titles (as text), markers, clip position, scale, rotation, opacity and volume are exchanged.
- CMX3600 EDL describes one video track, up to four audio channels, no titles and no nesting (that is the standard); a nested timeline becomes a clip named after it. Choose the video track with `videoTrack`; use OTIO or FCPXML for full timelines.
- An EDL carries no frame rate, so it is read at the frame rate of the open project.
- Media are referenced by file name and path; browsers never reveal real file paths, so exported paths are `file:///name`, and on import media are matched by file name. Unmatched media become offline clips that connect when files with the same names are imported.
