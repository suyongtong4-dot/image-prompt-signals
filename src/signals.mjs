/* signals.mjs — the twelve measurements behind an image-to-prompt line.
 *
 * Dependency-free. Works in Node and in the browser. It takes raw RGBA pixels,
 * which is exactly what `ctx.getImageData()` gives you, so it can be dropped into
 * any canvas pipeline.
 *
 * Extracted from the client-side script that runs on https://visualtoprompt.com
 * (no build step, no network, no storage). The measurement grid is 192x192 and is
 * fixed on purpose: every number in data/compose-output.csv was taken on that grid,
 * and a number is only comparable to another number taken the same way.
 */

/* ---------- colour naming ---------- */

export const PALETTE = [
  ['black', [12, 12, 14]], ['charcoal', [46, 46, 52]], ['grey', [128, 128, 130]],
  ['silver', [190, 193, 198]], ['white', [246, 246, 248]],
  ['maroon', [110, 30, 40]], ['red', [198, 40, 40]], ['crimson', [150, 20, 45]],
  ['coral', [240, 110, 95]], ['orange', [235, 120, 30]], ['amber', [222, 162, 45]],
  ['gold', [212, 175, 80]], ['yellow', [242, 222, 70]],
  ['olive', [118, 120, 55]], ['lime', [163, 208, 55]], ['green', [52, 148, 64]],
  ['forest green', [32, 78, 44]], ['moss green', [95, 120, 62]],
  ['emerald', [22, 140, 100]], ['teal', [22, 140, 140]], ['cyan', [64, 190, 210]],
  ['sky blue', [96, 164, 226]], ['steel blue', [70, 120, 170]],
  ['blue', [42, 82, 190]], ['navy', [22, 36, 92]], ['slate', [92, 102, 116]],
  ['indigo', [72, 52, 150]], ['purple', [128, 60, 180]], ['violet', [156, 110, 220]],
  ['magenta', [200, 62, 170]], ['pink', [240, 152, 190]],
  ['brown', [118, 74, 45]], ['tan', [198, 168, 128]], ['beige', [228, 214, 190]],
  ['cream', [244, 232, 208]]
];

export function nameColor(r, g, b) {
  let best = 'grey', bd = Infinity;
  for (const [name, c] of PALETTE) {
    const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

function gcd(a, b) { while (b) { const t = b; b = a % b; a = t; } return a || 1; }

/* ---------- the cut-offs, in one place ----------
 * Every phrase in a generated line is one of these numbers compared to a constant.
 * Change a constant here and the wording flips at a different point. */

export const CUTOFFS = {
  framing: { ultraWide: 2.2, widescreen: 1.7, landscape: 1.4, nearSquare: 1.15, square: 0.9, portrait34: 0.7, portrait23: 0.55 },
  exposure: { bright: 175, wellLit: 130, moderate: 80 },
  contrast: { high: 68, medium: 38 },
  saturation: { monochromeRatio: 0.85, vivid: 0.45, moderate: 0.22 },
  temperature: { warmStrong: 14, warmSlight: 5, coolStrong: -14, coolSlight: -5 },
  detail: { high: 15, moderate: 7 },
  lightingDistribution: { ratio: 1.18 },
  verticalLighting: { ratio: 1.2 },
  palette: { bucketBits: 4, mergeDistance: 52, named: 5, inPrompt: 4 },
  dominance: { green: 0.45, blue: 0.45 },
  mood: { brightMeanL: 150, brightWarmth: 5, darkMeanL: 95, dramaticStdL: 68, coolWarmth: -5 }
};

/* The twelve signals, in the order the readout panel prints them. Each one is a
 * measured number compared against a constant above. `measured` says whether the
 * phrase that reaches the prompt comes from a hard number or from an inference. */

export const SIGNALS = [
  { id: 'framing', fields: ['ar'], cutoffs: 'framing', measured: true },
  { id: 'exposure', fields: ['meanL'], cutoffs: 'exposure', measured: true },
  { id: 'contrast', fields: ['stdL'], cutoffs: 'contrast', measured: true },
  { id: 'saturation', fields: ['meanSat'], cutoffs: 'saturation', measured: true },
  { id: 'monochrome-share', fields: ['monoRatio'], cutoffs: 'saturation', measured: true },
  { id: 'colour-temperature', fields: ['meanR', 'meanB'], cutoffs: 'temperature', measured: true },
  { id: 'detail-density', fields: ['edge'], cutoffs: 'detail', measured: true },
  { id: 'lighting-distribution', fields: ['centreL', 'borderL'], cutoffs: 'lightingDistribution', measured: true },
  { id: 'vertical-lighting', fields: ['topL', 'bottomL'], cutoffs: 'verticalLighting', measured: true },
  { id: 'dominant-palette', fields: ['palette'], cutoffs: 'palette', measured: true },
  { id: 'green-blue-dominance', fields: ['greenRatio', 'blueRatio'], cutoffs: 'dominance', measured: false },
  { id: 'mood', fields: ['meanL', 'stdL', 'meanR', 'meanB'], cutoffs: 'mood', measured: true }
];

/* ---------- measure ----------
 * data: Uint8ClampedArray / Uint8Array of RGBA, already resampled to 192x192
 * imgW / imgH: the real pixel size of the source file, used only for the aspect
 *              ratio and the --ar parameter
 */

export function analyzeRGBA(data, W, H, imgW, imgH) {
  const n = W * H;
  const lum = new Float64Array(n);
  let sumR = 0, sumG = 0, sumB = 0, sumSat = 0;
  let green = 0, blueish = 0, mono = 0;
  const buckets = new Map();

  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    sumR += r; sumG += g; sumB += b;
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const s = mx === 0 ? 0 : (mx - mn) / mx;
    sumSat += s;
    if (s < 0.10) mono++;
    if (g > r * 1.08 && g > b * 1.06) green++;
    if (b > r * 1.10 && b > g * 1.02) blueish++;

    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    let e = buckets.get(key);
    if (!e) { e = [0, 0, 0, 0]; buckets.set(key, e); }
    e[0]++; e[1] += r; e[2] += g; e[3] += b;
  }

  const meanR = sumR / n, meanG = sumG / n, meanB = sumB / n;
  const meanSat = sumSat / n;
  const monoRatio = mono / n, greenRatio = green / n, blueRatio = blueish / n;

  let sumL = 0;
  for (let i = 0; i < n; i++) sumL += lum[i];
  const meanL = sumL / n;

  let varr = 0;
  for (let i = 0; i < n; i++) { const dv = lum[i] - meanL; varr += dv * dv; }
  const stdL = Math.sqrt(varr / n);

  // Edge density: mean gradient magnitude, central differences, one-pixel border skipped.
  let edgeSum = 0, edgeCnt = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      const gx = lum[p + 1] - lum[p - 1];
      const gy = lum[p + W] - lum[p - W];
      edgeSum += Math.sqrt(gx * gx + gy * gy);
      edgeCnt++;
    }
  }
  const edge = edgeSum / edgeCnt;

  // Centre 40% box versus everything outside it; top 45% versus bottom 45%.
  let cSum = 0, cN = 0, bSum = 0, bN = 0, tSum = 0, tN = 0, btmSum = 0, btmN = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const L = lum[y * W + x];
      const inCentre = (x > W * 0.3 && x < W * 0.7 && y > H * 0.3 && y < H * 0.7);
      if (inCentre) { cSum += L; cN++; } else { bSum += L; bN++; }
      if (y < H * 0.45) { tSum += L; tN++; }
      else if (y > H * 0.55) { btmSum += L; btmN++; }
    }
  }
  const centreL = cSum / cN, borderL = bSum / bN, topL = tSum / tN, bottomL = btmSum / btmN;

  // Palette: 4-bit buckets, merged at RGB distance 52 so the top five are
  // perceptually distinct colours rather than five shades of one gradient.
  // Bucket keys are visited in ascending numeric order, which is the order the
  // original object-keyed implementation produced and therefore the order the
  // merge sees them in.
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const list = keys.map(k => buckets.get(k)).sort((a, b) => b[0] - a[0]);
  const clusters = [];
  for (const e of list) {
    const cr = e[1] / e[0], cg = e[2] / e[0], cb = e[3] / e[0];
    let hit = null;
    for (const cl of clusters) {
      const dd = Math.hypot(cl.r - cr, cl.g - cg, cl.b - cb);
      if (dd < CUTOFFS.palette.mergeDistance) { hit = cl; break; }
    }
    if (hit) {
      const tot = hit.cnt + e[0];
      hit.r = (hit.r * hit.cnt + cr * e[0]) / tot;
      hit.g = (hit.g * hit.cnt + cg * e[0]) / tot;
      hit.b = (hit.b * hit.cnt + cb * e[0]) / tot;
      hit.cnt = tot;
    } else {
      clusters.push({ r: cr, g: cg, b: cb, cnt: e[0] });
    }
  }
  clusters.sort((a, b) => b.cnt - a.cnt);

  const palette = [], byName = {};
  for (const q of clusters) {
    if (palette.length >= CUTOFFS.palette.named) break;
    const nm = nameColor(q.r, q.g, q.b);
    if (byName[nm]) { byName[nm].share += q.cnt / n; continue; }
    const entry = { r: Math.round(q.r), g: Math.round(q.g), b: Math.round(q.b), name: nm, share: q.cnt / n };
    byName[nm] = entry;
    palette.push(entry);
  }

  const ar = imgW / imgH;
  const g0 = gcd(Math.round(imgW), Math.round(imgH));
  let ra = Math.round(imgW / g0), rb = Math.round(imgH / g0);
  const mxr = Math.max(ra, rb);
  if (mxr > 60) { const k = 60 / mxr; ra = Math.max(1, Math.round(ra * k)); rb = Math.max(1, Math.round(rb * k)); }

  return {
    w: imgW, h: imgH, ar, arParam: `${ra}:${rb}`,
    meanL, stdL, meanSat, edge,
    meanR, meanG, meanB,
    monoRatio, greenRatio, blueRatio,
    centreL, borderL, topL, bottomL,
    palette
  };
}

/* ---------- numbers to words ---------- */

export function describe(m) {
  const d = {};
  const C = CUTOFFS;

  // framing
  if (m.ar >= C.framing.ultraWide) d.framing = 'ultra-wide panoramic';
  else if (m.ar >= C.framing.widescreen) d.framing = 'widescreen 16:9';
  else if (m.ar >= C.framing.landscape) d.framing = 'landscape 3:2';
  else if (m.ar >= C.framing.nearSquare) d.framing = 'near-square 4:3';
  else if (m.ar >= C.framing.square) d.framing = 'square 1:1';
  else if (m.ar >= C.framing.portrait34) d.framing = 'portrait 3:4';
  else if (m.ar >= C.framing.portrait23) d.framing = 'portrait 2:3';
  else d.framing = 'tall vertical 9:16';

  // exposure
  if (m.meanL > C.exposure.bright) d.exposure = 'bright, high-key lighting';
  else if (m.meanL > C.exposure.wellLit) d.exposure = 'well-lit, balanced exposure';
  else if (m.meanL > C.exposure.moderate) d.exposure = 'moderate, slightly dim lighting';
  else d.exposure = 'dark, low-key lighting';

  // contrast
  if (m.stdL > C.contrast.high) d.contrast = 'high contrast';
  else if (m.stdL > C.contrast.medium) d.contrast = 'medium contrast';
  else d.contrast = 'soft, low contrast';

  // saturation, with monochrome checked first
  if (m.monoRatio > C.saturation.monochromeRatio) d.sat = 'monochrome, black and white';
  else if (m.meanSat > C.saturation.vivid) d.sat = 'vivid, saturated colour';
  else if (m.meanSat > C.saturation.moderate) d.sat = 'moderately saturated colour';
  else d.sat = 'muted, desaturated tones';

  // colour temperature: red mean minus blue mean
  const dt = m.meanR - m.meanB;
  if (dt > C.temperature.warmStrong) d.temp = 'warm golden colour temperature';
  else if (dt > C.temperature.warmSlight) d.temp = 'slightly warm tone';
  else if (dt < C.temperature.coolStrong) d.temp = 'cool blue colour temperature';
  else if (dt < C.temperature.coolSlight) d.temp = 'slightly cool tone';
  else d.temp = 'neutral colour temperature';

  // detail
  if (m.edge > C.detail.high) d.detail = 'highly detailed with intricate texture';
  else if (m.edge > C.detail.moderate) d.detail = 'moderate detail and texture';
  else d.detail = 'clean and minimal, smooth surfaces';

  // lighting distribution
  const R = C.lightingDistribution.ratio;
  if (m.centreL > m.borderL * R) d.dist = 'light falling on the centre with darker edges';
  else if (m.borderL > m.centreL * R) d.dist = 'brighter edges with a darker centre';
  else d.dist = 'evenly lit';

  const V = C.verticalLighting.ratio;
  d.vert = '';
  if (m.topL > m.bottomL * V) d.vert = 'brighter upper half';
  else if (m.bottomL > m.topL * V) d.vert = 'brighter lower half';

  // palette words
  const names = [];
  for (const p of m.palette) {
    if (names.length >= CUTOFFS.palette.inPrompt) break;
    if (!names.includes(p.name)) names.push(p.name);
  }
  d.paletteWords = names.length ? names.join(', ') : 'mixed tones';

  /* Scene hint. Only monochrome is written into the line, because only monochrome
     is measured. Green / blue dominance stays a tagged hint: "this frame is mostly
     green" is not the same claim as "this frame shows foliage". */
  d.subject = null;
  if (m.monoRatio > C.saturation.monochromeRatio) {
    d.subject = 'black and white photograph';
    d.hint = 'monochrome (measured)';
  } else if (m.greenRatio > C.dominance.green) {
    d.hint = 'green-dominant (inferred)';
  } else if (m.blueRatio > C.dominance.blue) {
    d.hint = 'blue-dominant (inferred)';
  } else {
    d.hint = 'no dominant hue (measured)';
  }

  // mood
  const M = C.mood;
  if (m.meanL > M.brightMeanL && dt > M.brightWarmth) d.mood = 'bright and uplifting atmosphere';
  else if (m.meanL < M.darkMeanL || m.stdL > M.dramaticStdL) d.mood = 'moody and dramatic atmosphere';
  else if (dt < M.coolWarmth) d.mood = 'calm and cool atmosphere';
  else d.mood = 'balanced, natural atmosphere';

  return d;
}

const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* ---------- assemble a line for a target model ----------
 * model: 'midjourney' | 'sd' | 'flux' | 'dalle'
 * len:   'short' | 'medium' | 'long'
 */

export function compose(m, d, model, len) {
  const core = [];
  if (d.subject) core.push(d.subject);
  core.push(`${d.framing} composition`);
  core.push(d.exposure);
  core.push(d.sat);
  core.push(d.temp);
  if (len !== 'short') { core.push(d.contrast); core.push(d.detail); core.push(d.dist); }
  if (len === 'long') { if (d.vert) core.push(d.vert); core.push(d.mood); }

  const colourLine = `dominant palette of ${d.paletteWords}`;

  if (model === 'midjourney') {
    const mj = core.slice();
    mj.splice(2, 0, colourLine);
    return `${mj.join(', ')} --ar ${m.arParam}`;
  }

  if (model === 'sd') {
    // sd pins two quality tags in front of every line; 40 of 40 frames in the
    // published set carry them.
    const sd = core.slice();
    sd.splice(2, 0, colourLine);
    return `masterpiece, best quality, ${sd.join(', ')}`;
  }

  if (model === 'flux') {
    const s = [`A ${d.framing} image.`];
    if (d.subject) s.push(`The frame is dominated by ${d.subject}.`);
    s.push(`${cap(d.exposure)}.`);
    s.push(`The dominant colours are ${d.paletteWords}.`);
    if (len !== 'short') s.push(`${cap(d.sat)}, ${d.temp}.`);
    if (len !== 'short') s.push(`${cap(d.detail)}.`);
    if (len === 'long') { s.push(`${cap(d.dist)}.`); s.push(`${cap(d.mood)}.`); }
    return s.join(' ');
  }

  if (model === 'dalle') {
    let s = `A ${d.framing} image`;
    if (d.subject) s += ` dominated by ${d.subject}`;
    s += `, ${d.exposure}, with a palette of ${d.paletteWords}.`;
    if (len !== 'short') s += ` ${cap(d.sat)}, ${d.temp}, ${d.detail}.`;
    if (len === 'long') s += ` ${cap(d.mood)}.`;
    return s;
  }

  throw new Error(`unknown target model: ${model}`);
}

/* ---------- one call from pixels to a line ---------- */

export function imageToPrompt(rgba, gridW, gridH, imgW, imgH, model = 'midjourney', len = 'medium') {
  const metrics = analyzeRGBA(rgba, gridW, gridH, imgW, imgH);
  const described = describe(metrics);
  return { metrics, described, prompt: compose(metrics, described, model, len) };
}
