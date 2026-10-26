import { analyzeRGBA, describe, compose, CUTOFFS, SIGNALS, nameColor } from '../src/signals.mjs';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const W = 192, H = 192;

function fill(r, g, b) {
  const d = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; }
  return d;
}

console.log('flat mid-grey 192x192, 1920x1080 source');
{
  const m = analyzeRGBA(fill(128, 128, 128), W, H, 1920, 1080);
  check('meanL is 128', Math.abs(m.meanL - 128) < 0.01, m.meanL);
  check('stdL is 0', m.stdL < 0.01, m.stdL);
  check('edge is 0', m.edge < 0.01, m.edge);
  check('meanSat is 0', m.meanSat < 0.01, m.meanSat);
  check('monoRatio is 1', m.monoRatio === 1, m.monoRatio);
  check('aspect 16:9', m.arParam === '16:9', m.arParam);
  check('palette is one grey entry', m.palette.length === 1 && m.palette[0].name === 'grey', JSON.stringify(m.palette));
  check('palette share is 1', Math.abs(m.palette[0].share - 1) < 1e-9);

  const d = describe(m);
  check('flat grey reads as monochrome', d.sat === 'monochrome, black and white', d.sat);
  check('framing is widescreen', d.framing === 'widescreen 16:9', d.framing);
  check('distribution is evenly lit', d.dist === 'evenly lit', d.dist);
  check('subject is black and white photograph', d.subject === 'black and white photograph', d.subject);

  for (const model of ['midjourney', 'sd', 'flux', 'dalle']) {
    for (const len of ['short', 'medium', 'long']) {
      const p = compose(m, d, model, len);
      check(`${model}/${len} returns a non-empty string`, typeof p === 'string' && p.length > 20);
    }
  }
  check('midjourney carries --ar', compose(m, d, 'midjourney', 'short').endsWith('--ar 16:9'));
  check('sd carries quality tags', compose(m, d, 'sd', 'short').startsWith('masterpiece, best quality, '));
  check('short is shorter than long (midjourney)',
    compose(m, d, 'midjourney', 'short').length < compose(m, d, 'midjourney', 'long').length);
}

console.log('horizontal black-to-white ramp, 1000x1000 source');
{
  const d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = Math.round((x / (W - 1)) * 255);
      const i = (y * W + x) * 4;
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
    }
  }
  const m = analyzeRGBA(d, W, H, 1000, 1000);
  check('meanL near 127.5', Math.abs(m.meanL - 127.5) < 1.5, m.meanL);
  check('stdL matches uniform spread (~73.6)', Math.abs(m.stdL - 73.6) < 1.5, m.stdL);
  check('edge is non-zero', m.edge > 1, m.edge);
  check('square aspect', m.arParam === '1:1', m.arParam);
  check('high contrast reads as high', describe(m).contrast === 'high contrast', describe(m).contrast);
  check('left/right ramp is not brighter top or bottom', describe(m).vert === '', describe(m).vert);
}

console.log('nameColor sanity');
{
  check('black', nameColor(0, 0, 0) === 'black', nameColor(0, 0, 0));
  check('navy', nameColor(22, 36, 92) === 'navy', nameColor(22, 36, 92));
  check('white', nameColor(255, 255, 255) === 'white', nameColor(255, 255, 255));
}

console.log('signal table');
{
  check('12 signals declared', SIGNALS.length === 12, SIGNALS.length);
  check('every signal points at a real cut-off group', SIGNALS.every(s => CUTOFFS[s.cutoffs]), 'missing group');
  check('only green/blue dominance is marked inferred', SIGNALS.filter(s => !s.measured).length === 1 && SIGNALS.find(s => !s.measured).id === 'green-blue-dominance');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
