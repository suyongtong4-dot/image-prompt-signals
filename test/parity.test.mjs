// One-off cross-check: run the shipped site script and the extracted module on the
// same pixel buffers and compare every number and every generated line.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as mine from '../src/signals.mjs';

const REFERENCE = fileURLToPath(new URL('../reference/visualtoprompt-script.js', import.meta.url));
const src = readFileSync(REFERENCE, 'utf8');
const start = src.indexOf('/* ---------- colour naming ---------- */');
const end = src.indexOf('/* ---------- render ---------- */');
const body = src.slice(start, end);

const factory = new Function('document', body + '\nreturn { analyze, describe, compose, nameColor };');

const W = 192, H = 192;
let buffer;

const fakeDocument = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      drawImage() {},
      getImageData: () => ({ data: buffer })
    })
  })
};

const orig = factory(fakeDocument);

function randomBuffer(seed) {
  const d = new Uint8Array(W * H * 4);
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const mode = seed % 4;
  for (let i = 0; i < W * H; i++) {
    let r, g, b;
    if (mode === 0) { r = rnd() * 255; g = rnd() * 255; b = rnd() * 255; }
    else if (mode === 1) { const v = rnd() * 255; r = v; g = v; b = v; }
    else if (mode === 2) { const x = i % W; r = (x / W) * 255; g = (x / W) * 120; b = 40 + rnd() * 20; }
    else { const v = rnd() > 0.5 ? 240 : 12; r = v; g = v * 0.9; b = v * 0.8; }
    d[i * 4] = r | 0; d[i * 4 + 1] = g | 0; d[i * 4 + 2] = b | 0; d[i * 4 + 3] = 255;
  }
  return d;
}

const sizes = [[1920, 1080], [1000, 1000], [640, 360], [800, 450], [3024, 4032]];
let checks = 0, diffs = 0;

for (let seed = 1; seed <= 24; seed++) {
  buffer = randomBuffer(seed);
  const [iw, ih] = sizes[seed % sizes.length];
  const img = { naturalWidth: iw, naturalHeight: ih };

  const a = orig.analyze(img);
  const b = mine.analyzeRGBA(buffer, W, H, iw, ih);

  for (const k of ['meanL', 'stdL', 'meanSat', 'edge', 'meanR', 'meanG', 'meanB', 'monoRatio', 'greenRatio', 'blueRatio', 'centreL', 'borderL', 'topL', 'bottomL', 'ar']) {
    checks++;
    if (Math.abs(a[k] - b[k]) > 1e-9) { diffs++; console.log(`metric ${k} seed ${seed}: ${a[k]} vs ${b[k]}`); }
  }
  checks++;
  if (a.arParam !== b.arParam) { diffs++; console.log(`arParam seed ${seed}: ${a.arParam} vs ${b.arParam}`); }

  checks++;
  if (JSON.stringify(a.palette) !== JSON.stringify(b.palette)) { diffs++; console.log(`palette seed ${seed} differs`); }

  const da = orig.describe(a), db = mine.describe(b);
  checks++;
  if (JSON.stringify(da) !== JSON.stringify(db)) { diffs++; console.log(`describe seed ${seed} differs`); }

  for (const model of ['midjourney', 'sd', 'flux', 'dalle']) {
    for (const len of ['short', 'medium', 'long']) {
      checks++;
      const pa = orig.compose(a, da, model, len);
      const pb = mine.compose(b, db, model, len);
      if (pa !== pb) { diffs++; console.log(`${model}/${len} seed ${seed} differs:\n  ${pa}\n  ${pb}`); }
    }
  }
}

console.log(`\n${checks} comparisons, ${diffs} differences`);
process.exit(diffs ? 1 : 0);
