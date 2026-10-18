# Known limitations

Montage is built as a production-ready editor. This file lists only what cannot be fixed on our side (browser APIs, hardware, physics, standards), each with the reason; anything fixable is fixed instead of being listed.


## Media and formats

- RAW formats (BRAW, R3D, ARRIRAW) are not supported; convert to ProRes first.
- H.264/HEVC decoding and encoding depend on the browser; Chromium builds without proprietary codecs fall back to VP9 for export and proxies.
- HDR export is ProRes only (Rec.2020 HLG/PQ); HDR in MP4 needs a 10-bit HEVC encoder the browser may not have. The preview is SDR.
- Camera log is detected from the `com.apple.proapps.customgamma` tag (Blackmagic Film and name matches for S-Log3, LogC, V-Log, Canon Log 3) and from HLG/PQ transfer tags; other files need the input color space set by hand.
- ProRes decodes from different files run one at a time on the shared WASM runtime (each frame still uses all decoder threads); this works around a rare out-of-bounds crash that was suspected in concurrent decoding.

## Preview and export

- The native ProRes encoder needs WebAssembly SIMD; without it export falls back to the JS encoder, about three times slower. Slices are coded at roughly 5 fps per worker for 1080p HQ, so export speed scales with `encoderThreads`.
- ProRes 422 stores color at half horizontal resolution: on sharp edges between saturated colors the exported chroma bleeds by a pixel and clips (for example a blue/black edge reads 0.46 blue in the edge pixel). Flat colors round-trip within 0.1%, luma is exact per pixel. Near strong edges ProRes compression adds up to about 3% ringing to saturated colors.
- A frame n is rendered at the time n / fps (its start). Transitions and animations are sampled there in preview and export alike.

## Render cache

- Export never reuses cached preview frames: the cache holds 8-bit frames at preview resolution, while export renders full resolution in float.
- Which frames are "heavy" is judged by CPU time and render passes, not GPU time: browsers expose GPU timer queries only behind flags (EXT_disjoint_timer_query is disabled in Chrome for security).

## Compositing (node graph)

- Nodes render in project frame space at preview resolution; there is no per-node resolution or region of interest yet.
- No 3D scenes, cameras or lights.
- Masks are closed shapes; open strokes and paint are not supported. Bezier and polygon masks are flattened to at most 128 points.
- Rotoscoping keyframes are per coordinate; adding or removing vertices on an animated mask is blocked.
- A graph with nothing connected to the output renders transparent black.
- With the node graph disabled, nodes without a `source` input (generators, merges, mixers, masks) stay in the clip but are not rendered; enabling the graph again shows them unconnected.
- Node templates are stored in the browser (localStorage), not in the project file; export them as JSON with `montage.templates.get` to move them.

## Color

- ACES uses a fitted RRT/ODT (Rec.709 output only); there is no ACES HDR output transform, so HDR export from an ACES project carries tone-mapped SDR highlights.
- Values below black (negative scene light from log codes under the noise floor) are clipped to 0 by every filter.
- Input transforms are math approximations of the vendor curves (ARRI LogC3 at EI 800 only); no camera-specific IDT matrices beyond the gamut primaries.
- Generator nodes (background, text node, gradient) are not color managed: in ACES their colors pass through the output transform and look slightly different from `display`.
- The input color space is per media file, not per clip.
- Temporal noise reduction is recursive (it reuses its previous output, no motion estimation); it needs frames rendered in order, so a still after a jump and the first frame of playback get spatial-only quality, and moving areas get no temporal cleanup.
- Wipe comparison is a vertical wipe against a still (no split-screen layouts, no angle, no comparison with the ungraded frame other than the Compare button).
- Stills are low resolution (270 lines, JPEG) and live inside the project file, which grows by roughly 20–40 KB per still.
- Grade versions and stills copy node keyframes but not keyframed clip transforms or opacity.
- Spatial noise reduction is a bilateral filter, not non-local means; strong settings soften fine texture.

- Curves, qualifiers and the color warper work on display-referred values clipped to 0..1; HDR wheels and grade keep values above 1.
- Qualifiers have no blur or clean-up of their own; follow them with a `matte` node.
- There is no color-picker on the viewer for qualifiers yet; colors are set as parameters.

## Text node

- Up to 128 glyphs animate individually; extra glyphs are hidden.
- Fonts: IBM Plex Sans, IBM Plex Mono and the system serif and sans-serif.
- Size or outline width animation re-rasterizes the text every frame (slower).
- Glyph boxes may overlap with tight kerning; during strong per-glyph animation a neighbour's edge can show.

## Scopes

- Scopes are computed from a 320 px wide copy of the viewer frame (8-bit, after the output transform) and arrive a frame or two after the picture.

## Audio

- No buses, automation, LUFS metering or noise reduction yet (phase 5).

## Editing and interchange


- No source viewer, trim modes, nested timelines, multicam, OTIO/FCPXML/EDL or subtitles yet (phases 6 and 7).
- No remote storage (S3).

## Platform

- Right after importing, the first playback of 4K ProRes can wait about two seconds while decoders, thumbnails and proxies start (measured with software rendering in CI).

- Browser tabs have a memory ceiling of roughly 2–4 GB (less on iOS); the memory governor lowers preview resolution under pressure.
- Needs cross-origin isolation for worker threads; on hosts without it the engine runs slower on the main thread.

## Audio processing

- Very strong noise reduction on broadband hiss leaves faint "musical noise" (isolated tones where the noise briefly exceeds its estimate). Every spectral noise reducer trades this against how much noise it removes; lower `reduction` or raise `sensitivity` if it is audible.

## Mixer and loudness

- True peak is measured with a 48-tap windowed-sinc 4× interpolator rather than the exact BS.1770-4 reference filter; readings agree with ffmpeg's `ebur128` true-peak meter to 0.1 dB in our tests. The standard allows implementation-defined interpolators.
- The live loudness readout measures audio when it is handed to the browser's audio output, a fraction of a second before it is heard (the Web Audio scheduling lookahead), and covers only 1× playback because shuttle audio is resampled by the browser.
