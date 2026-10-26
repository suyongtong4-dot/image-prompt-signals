# Image prompt signals

Twelve numbers you can measure on any image, the cut-offs that turn them into words,
and 480 prompt lines generated from forty real files across four target models.

Nothing here calls a model. There is no API key, no network request, no inference.
The measurements are arithmetic on pixels; the wording is a lookup table over those
measurements. That is the whole method, and it is the reason the output is the same
every time you run it.

- `src/signals.mjs` — dependency-free ES module: RGBA pixels in, prompt line out. Runs in Node and in the browser.
- `data/compose-output.csv` — 480 rows: 40 images × 4 targets × 3 lengths.
- `data/signals.json` — the twelve signals and their constants, machine-readable.
- `test/` — 39 unit checks, plus a parity test that compares this module against the shipped browser script number for number.

## The twelve signals

Every phrase in a generated line is one of these numbers compared to a constant.
`measured` means the phrase comes from a hard number; the one exception is marked.

| Signal | Field(s) | Cut-offs | Feeds |
|---|---|---|---|
| Framing | `ar` | ≥ 2.2 / 1.7 / 1.4 / 1.15 / 0.9 / 0.7 / 0.55 | `ultra-wide panoramic` … `tall vertical 9:16` |
| Exposure | `meanL` | > 175 / 130 / 80 | `bright, high-key` … `dark, low-key` |
| Contrast | `stdL` | > 68 / 38 | `high` / `medium` / `soft, low` |
| Saturation | `meanSat` | > 0.45 / 0.22 | `vivid` / `moderately saturated` / `muted` |
| Monochrome share | `monoRatio` | > 0.85 | `monochrome, black and white` |
| Colour temperature | `meanR − meanB` | > 14 / 5, < −5 / −14 | `warm golden` … `cool blue` |
| Detail density | `edge` | > 15 / 7 | `highly detailed` / `moderate` / `clean and minimal` |
| Lighting distribution | `centreL`, `borderL` | ratio 1.18 either way | centre-lit / edge-lit / `evenly lit` |
| Vertical lighting | `topL`, `bottomL` | ratio 1.2 either way | `brighter upper half` / lower / none |
| Dominant palette | `palette[]` | 4-bit buckets, merged at RGB distance 52 | top 5 named, top 4 reach the prompt |
| Green / blue dominance | `greenRatio`, `blueRatio` | > 0.45 | hint only — **inferred**, never written into the line |
| Mood | `meanL`, `stdL`, `meanR−B` | 150 / 95 / 68 / 5 / −5 | `bright and uplifting` … `moody and dramatic` |

Two definitions matter more than the rest:

- **Luminance** is `0.2126 R + 0.7152 G + 0.0722 B`, computed on 8-bit sRGB values without gamma linearisation.
- **Edge density** is the mean gradient magnitude over the frame, using central differences and skipping the one-pixel border. It is a texture proxy, not an edge detector with a threshold.

The palette step is the only one that is not a straight comparison: pixels are counted
into 4-bit RGB buckets (4096 possible), buckets are sorted by population, and each is
merged into the first existing cluster within distance 52 in RGB space. Without the
merge you would get five near-identical greys for a photo of a wall.

## The dataset

`data/compose-output.csv` — 480 rows, one per image × target × length.

| Column | Meaning |
|---|---|
| `image`, `width`, `height` | source file and its real pixel size |
| `aspect_param` | the `--ar` value written into the line |
| `edge_full` | edge density measured at the image's own resolution |
| `target` | `midjourney` / `sd` / `flux` / `dalle` |
| `length` | `short` / `medium` / `long` — 160 rows each |
| `chars` | character count of the generated line |
| `prompt` | the line itself |

How it was produced, precisely:

- 40 source files: 39 photographs and 1 screenshot of code.
- Every file was 16:9, so **`aspect_param` is `16:9` in all 480 rows**. This dataset says nothing about how other aspect ratios are worded.
- Every image was measured on a fixed 192×192 grid after browser canvas resampling.
- Generated 2026-10-08 by `src/compose.js` with `MODELS = midjourney, sd, flux, dalle` and `LENGTH = short, medium, long`.

Two caveats worth taking seriously:

1. **`edge_full` is not comparable with `edge`.** `edge_full` runs on the undecimated RGBA buffer at native resolution; `edge` runs on the 192×192 grid. Downsampling removes high-frequency detail, so the two numbers measure different things even on the same file. Do not average them together.
2. **Character counts range from 90 to 357.** Length is a set of rules about which clauses are included, not a target word count. A `long` line on a flat image can be shorter than a `medium` line on a busy one.

## Using the module

```js
import { imageToPrompt } from './src/signals.mjs';

const canvas = document.createElement('canvas');
canvas.width = canvas.height = 192;
const ctx = canvas.getContext('2d', { willReadFrequently: true });
ctx.drawImage(img, 0, 0, 192, 192);
const rgba = ctx.getImageData(0, 0, 192, 192).data;

const { metrics, described, prompt } = imageToPrompt(
  rgba, 192, 192, img.naturalWidth, img.naturalHeight,
  'midjourney', 'medium'
);
```

`metrics` holds the raw numbers, `described` the phrases they resolved to, `prompt`
the assembled line. The pieces are exported separately if you want to use the
measurements without the wording:

```js
import { analyzeRGBA, describe, compose } from './src/signals.mjs';
const m = analyzeRGBA(rgba, 192, 192, 1920, 1080);
const d = describe(m);
const line = compose(m, d, 'flux', 'long');
```

The grid size is a parameter, but the constants were tuned on 192×192. Change the grid
and the edge-density figures move, because averaging over fewer pixels changes the
gradient distribution.

## Why the output is deterministic

`describe()` and `compose()` contain no randomness, no temperature, no sampling. Given
the same RGBA buffer you get the same string, which is what makes the 480-row CSV
reproducible and diffable. It also means the output cannot invent detail that is not in
the pixels — and it will not describe a subject, because subject recognition is not one
of the twelve signals. A photo of a dog and a photo of a cat with the same luminance,
contrast and palette produce the same line.

## Tests

```
node test/signals.test.mjs   # 39 checks: flat grey, black-to-white ramp, aspect, model/length matrix
node test/parity.test.mjs    # 720 comparisons against reference/visualtoprompt-script.js
```

`reference/visualtoprompt-script.js` is the shipped browser script, kept here so the
parity test has something to compare against. The parity test runs both implementations
over 24 synthetic buffers (random colour, greyscale noise, gradients, two-tone blocks)
and compares 15 metric values, the palette array, the `describe()` output and all
twelve model/length combinations. It currently reports **720 comparisons, 0 differences**.

That test is the reason this module can be trusted as a reimplementation rather than a
rewrite: the first version of it failed, because the extracted code iterated palette
buckets in insertion order while the original iterated object keys in ascending numeric
order, which changes which cluster a bucket merges into. The fix is in
`analyzeRGBA()` and the difference is visible on real photos, not just on tests.

## Scope

This is a measurement-and-wording library, not an image understanding model. It does
not detect objects, faces, people, brands, text or scene type. Green and blue dominance
are reported as hints because a green-dominant frame might be foliage, a painted wall or
a green screen, and nothing in the pixel statistics distinguishes them.

The browser tool these numbers come from is at [visualtoprompt.com](https://visualtoprompt.com/) — it runs this same code on your device and uploads nothing.

## License

MIT for the code and the data in this repository.
