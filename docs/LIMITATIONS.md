# Known limitations

What Montage does not do yet or does only partly. Each entry names the area, the limit and, where useful, the workaround. Keep this file in sync with every feature commit.

## Media and formats

- RAW formats (BRAW, R3D, ARRIRAW) are not supported; convert to ProRes first.
- H.264/HEVC decoding and encoding depend on the browser; Chromium builds without proprietary codecs fall back to VP9 for export and proxies.
- HDR export is ProRes only (Rec.2020 HLG/PQ); HDR in MP4 needs a 10-bit HEVC encoder the browser may not have. The preview is SDR.
- Camera log is detected automatically only for Blackmagic Film (the `com.apple.proapps.customgamma` tag); other cameras need a manual input transform.
- Rare "memory access out of bounds" page error suspected in the ProRes WASM decoder under concurrent decoding of one file.

## Compositing (node graph)

- Nodes render in project frame space at preview resolution; there is no per-node resolution or region of interest yet.
- No 3D scenes, cameras or lights.
- Masks are closed shapes; open strokes and paint are not supported. Bezier and polygon masks are flattened to at most 128 points.
- Rotoscoping keyframes are per coordinate; adding or removing vertices on an animated mask is blocked.
- `graph.disable` keeps added nodes in the effect chain; remove nodes you no longer want.
- Node templates are stored in the browser (localStorage), not in the project file; export them as JSON with `montage.templates.get` to move them.

## Text node

- Up to 128 glyphs animate individually; extra glyphs are hidden.
- Fonts: IBM Plex Sans, IBM Plex Mono and the system serif and sans-serif.
- Size or outline width animation re-rasterizes the text every frame (slower).
- Glyph boxes may overlap with tight kerning; during strong per-glyph animation a neighbour's edge can show.

## Tracking

- One point tracker (translation only); no planar, rotation or scale tracking.
- Clip rotation is ignored when mapping tracked points to the frame.
- Frames with a weak match (correlation below 0.5) are dropped; the path is interpolated between kept keyframes.
- Tracking runs on a copy scaled to 360 lines by default (`height` option).

## Audio

- No buses, automation, LUFS metering or noise reduction yet (phase 5).

## Editing and interchange

- No source viewer, trim modes, nested timelines, multicam, OTIO/FCPXML/EDL or subtitles yet (phases 6 and 7).
- No remote storage (S3).

## Platform

- Browser tabs have a memory ceiling of roughly 2–4 GB (less on iOS); the memory governor lowers preview resolution under pressure.
- Needs cross-origin isolation for worker threads; on hosts without it the engine runs slower on the main thread.
