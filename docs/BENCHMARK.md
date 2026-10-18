# Benchmarks

The benchmark drives the production build in a real Chrome, measures playback, seeking and export through the engine metrics (`montage.stats().metrics`) and writes `bench-results/<time>.json` and `.md`.

## Requirements

- Node 20 or newer and `npm install` done in the repository.
- Google Chrome installed (used by default), or any Chromium via `CHROME_PATH=/path/to/chrome`.
- `ffmpeg` on the `PATH` to generate the test media on the first run (cached in the system temp folder).

## Running

```bash
npm run bench                         # every profile, source and scenario
npm run bench -- desktop              # one profile: desktop or phone
npm run bench -- prores-2160-4s.mov   # one source
npm run bench -- --quick              # skip exports
BENCH_MEDIA=/path/a.mov,/path/b.mov npm run bench   # add your own footage
HEADLESS=0 npm run bench              # watch it in a visible window
```

Chrome uses the real GPU. `SOFTWARE_GL=1` forces the software renderer (what cloud machines without a GPU use); numbers from such runs are only comparable with each other.

## Scenarios

| Scenario | What it measures |
|---|---|
| `seek` | 40 random seeks: mean and p95 time to a rendered frame, stale requests dropped by coalescing |
| `play` | 5 s of playback: frames presented and dropped, decode and render p95 |
| `play-heavy` | the same with grade, curves, a graded picture-in-picture and an animated title |
| `export-mp4-720` | MP4 export speed in frames per second, time per stage |
| `export-prores-hq` | ProRes 422 HQ export speed, time per stage |

Every row also reports GPU memory (textures and render targets), open decoders and JS heap growth.

## Profiles

- `desktop`: the browser as it is.
- `phone`: a 390×844 touch viewport reporting 4 GB of memory and 4 cores, which switches the engine to its mobile budget.
