# Known limitations

What Montage does not do yet or does only partly. Each entry names the area, the limit and, where useful, the workaround. Keep this file in sync with every feature commit.

## Media and formats

- RAW formats (BRAW, R3D, ARRIRAW) are not supported; convert to ProRes first.
- H.264/HEVC decoding and encoding depend on the browser; Chromium builds without proprietary codecs fall back to VP9 for export and proxies.
- HDR export is ProRes only (Rec.2020 HLG/PQ); HDR in MP4 needs a 10-bit HEVC encoder the browser may not have. The preview is SDR.
- Camera log is detected from the `com.apple.proapps.customgamma` tag (Blackmagic Film and name matches for S-Log3, LogC, V-Log, Canon Log 3) and from HLG/PQ transfer tags; other files need the input color space set by hand.
- ProRes decodes from different files run one at a time on the shared WASM runtime (each frame still uses all decoder threads); this works around a rare out-of-bounds crash that was suspected in concurrent decoding.

## Render cache

- Only preview frames are cached; export always renders from scratch.
- Disk entries are lossy WebP (quality 0.92), so a frame read back from disk can differ slightly from a fresh render.
- Switching a clip between proxy and original media does not change the cache key; the previous image can show until the frame is edited.
- When scopes are open, still frames are rendered every time (scopes need the live image); playback still uses the cache.
- GPU time is not measured; a frame counts as heavy by CPU time or by the number of render passes.

## Compositing (node graph)

- Nodes render in project frame space at preview resolution; there is no per-node resolution or region of interest yet.
- No 3D scenes, cameras or lights.
- Masks are closed shapes; open strokes and paint are not supported. Bezier and polygon masks are flattened to at most 128 points.
- Rotoscoping keyframes are per coordinate; adding or removing vertices on an animated mask is blocked.
- A graph with nothing connected to the output renders transparent black.
- `graph.disable` keeps added nodes in the effect chain; remove nodes you no longer want.
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

## Tracking

- One point tracker (translation only); no planar, rotation or scale tracking.
- Clip rotation is ignored when mapping tracked points to the frame.
- Frames with a weak match (correlation below 0.5) are dropped; the path is interpolated between kept keyframes.
- Tracking runs on a copy scaled to 360 lines by default (`height` option).

## Audio

- No buses, automation, LUFS metering or noise reduction yet (phase 5).

## Editing and interchange

- Splitting or trimming a clip inside an eased keyframe segment adds a boundary key with the exact value at the cut, but the remaining part of that eased segment is re-timed, so its curve shape changes slightly.

- No source viewer, trim modes, nested timelines, multicam, OTIO/FCPXML/EDL or subtitles yet (phases 6 and 7).
- No remote storage (S3).

## Platform

- Right after importing, the first playback of 4K ProRes can wait about two seconds while decoders, thumbnails and proxies start (measured with software rendering in CI).

- Browser tabs have a memory ceiling of roughly 2–4 GB (less on iOS); the memory governor lowers preview resolution under pressure.
- Needs cross-origin isolation for worker threads; on hosts without it the engine runs slower on the main thread.
