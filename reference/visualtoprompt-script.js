/* VisualToPrompt — image to prompt, entirely in the browser.
   No upload, no backend, no dependencies. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var drop = $('#drop'), fileInput = $('#file'), preview = $('#preview'),
      dropEmpty = $('#dropEmpty'), dropFilled = $('#dropFilled'),
      controls = $('#controls'), modelSel = $('#model'), lenSel = $('#length'),
      clearBtn = $('#clear'), out = $('#out'), copyBtn = $('#copy'),
      copied = $('#copied'), facts = $('#facts'), factsGrid = $('#factsGrid'),
      swatches = $('#swatches');

  var state = { url: null, metrics: null, dims: null };

  /* ---------- colour naming ---------- */
  var PALETTE = [
    ['black',[12,12,14]], ['charcoal',[46,46,52]], ['grey',[128,128,130]],
    ['silver',[190,193,198]], ['white',[246,246,248]],
    ['maroon',[110,30,40]], ['red',[198,40,40]], ['crimson',[150,20,45]],
    ['coral',[240,110,95]], ['orange',[235,120,30]], ['amber',[222,162,45]],
    ['gold',[212,175,80]], ['yellow',[242,222,70]],
    ['olive',[118,120,55]], ['lime',[163,208,55]], ['green',[52,148,64]],
    ['forest green',[32,78,44]], ['moss green',[95,120,62]],
    ['emerald',[22,140,100]], ['teal',[22,140,140]], ['cyan',[64,190,210]],
    ['sky blue',[96,164,226]], ['steel blue',[70,120,170]],
    ['blue',[42,82,190]], ['navy',[22,36,92]], ['slate',[92,102,116]],
    ['indigo',[72,52,150]], ['purple',[128,60,180]], ['violet',[156,110,220]],
    ['magenta',[200,62,170]], ['pink',[240,152,190]],
    ['brown',[118,74,45]], ['tan',[198,168,128]], ['beige',[228,214,190]],
    ['cream',[244,232,208]]
  ];

  function nameColor(r, g, b) {
    var best = 'grey', bd = Infinity;
    for (var i = 0; i < PALETTE.length; i++) {
      var c = PALETTE[i][1];
      var d = (r - c[0]) * (r - c[0]) + (g - c[1]) * (g - c[1]) + (b - c[2]) * (b - c[2]);
      if (d < bd) { bd = d; best = PALETTE[i][0]; }
    }
    return best;
  }

  function gcd(a, b) { while (b) { var t = b; b = a % b; a = t; } return a || 1; }

  /* ---------- measure the image ---------- */
  function analyze(img) {
    var W = 192, H = 192;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    var d = ctx.getImageData(0, 0, W, H).data;
    var n = W * H;

    var lum = new Float64Array(n);
    var sumR = 0, sumG = 0, sumB = 0, sumSat = 0;
    var green = 0, blueish = 0, mono = 0;
    var buckets = {};

    for (var i = 0; i < n; i++) {
      var r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      sumR += r; sumG += g; sumB += b;
      lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      var s = mx === 0 ? 0 : (mx - mn) / mx;
      sumSat += s;
      if (s < 0.10) mono++;
      if (g > r * 1.08 && g > b * 1.06) green++;
      if (b > r * 1.10 && b > g * 1.02) blueish++;

      var key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      var e = buckets[key];
      if (!e) { e = buckets[key] = [0, 0, 0, 0]; }
      e[0]++; e[1] += r; e[2] += g; e[3] += b;
    }

    var meanR = sumR / n, meanG = sumG / n, meanB = sumB / n;
    var meanSat = sumSat / n;
    var monoRatio = mono / n, greenRatio = green / n, blueRatio = blueish / n;

    var sumL = 0;
    for (i = 0; i < n; i++) sumL += lum[i];
    var meanL = sumL / n;
    var varr = 0;
    for (i = 0; i < n; i++) { var dv = lum[i] - meanL; varr += dv * dv; }
    var stdL = Math.sqrt(varr / n);

    // edge density
    var edgeSum = 0, edgeCnt = 0;
    for (var y = 1; y < H - 1; y++) {
      for (var x = 1; x < W - 1; x++) {
        var p = y * W + x;
        var gx = lum[p + 1] - lum[p - 1];
        var gy = lum[p + W] - lum[p - W];
        edgeSum += Math.sqrt(gx * gx + gy * gy);
        edgeCnt++;
      }
    }
    var edge = edgeSum / edgeCnt;

    // centre vs border
    var cSum = 0, cN = 0, bSum = 0, bN = 0, tSum = 0, tN = 0, btmSum = 0, bN2 = 0;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var L = lum[y * W + x];
        var inC = (x > W * 0.3 && x < W * 0.7 && y > H * 0.3 && y < H * 0.7);
        if (inC) { cSum += L; cN++; } else { bSum += L; bN++; }
        if (y < H * 0.45) { tSum += L; tN++; } else if (y > H * 0.55) { btmSum += L; bN2++; }
      }
    }
    var centreL = cSum / cN, borderL = bSum / bN, topL = tSum / tN, bottomL = btmSum / bN2;

    // palette: merge nearby buckets so we report perceptually distinct colours,
    // not five shades of the same gradient
    var list = [];
    for (var k in buckets) { if (buckets.hasOwnProperty(k)) list.push(buckets[k]); }
    list.sort(function (a, b2) { return b2[0] - a[0]; });
    var clusters = [];
    for (i = 0; i < list.length; i++) {
      var e2 = list[i];
      var cr = e2[1] / e2[0], cg = e2[2] / e2[0], cb = e2[3] / e2[0];
      var hit = null;
      for (var c = 0; c < clusters.length; c++) {
        var cl = clusters[c];
        var dd = Math.sqrt(Math.pow(cl.r - cr, 2) + Math.pow(cl.g - cg, 2) + Math.pow(cl.b - cb, 2));
        if (dd < 52) { hit = cl; break; }
      }
      if (hit) {
        var tot = hit.cnt + e2[0];
        hit.r = (hit.r * hit.cnt + cr * e2[0]) / tot;
        hit.g = (hit.g * hit.cnt + cg * e2[0]) / tot;
        hit.b = (hit.b * hit.cnt + cb * e2[0]) / tot;
        hit.cnt = tot;
      } else {
        clusters.push({ r: cr, g: cg, b: cb, cnt: e2[0] });
      }
    }
    clusters.sort(function (a, b3) { return b3.cnt - a.cnt; });
    var pal = [], byName = {};
    for (i = 0; i < clusters.length && pal.length < 5; i++) {
      var q = clusters[i];
      var nm = nameColor(q.r, q.g, q.b);
      if (byName[nm]) { byName[nm].share += q.cnt / n; continue; } // merge duplicate names
      var entry = {
        r: Math.round(q.r), g: Math.round(q.g), b: Math.round(q.b),
        name: nm, share: q.cnt / n
      };
      byName[nm] = entry;
      pal.push(entry);
    }

    var w = img.naturalWidth, h = img.naturalHeight;
    var ar = w / h;
    var g = gcd(Math.round(w), Math.round(h));
    var ra = Math.round(w / g), rb = Math.round(h / g);
    var mxr = Math.max(ra, rb);
    if (mxr > 60) { var kk = 60 / mxr; ra = Math.max(1, Math.round(ra * kk)); rb = Math.max(1, Math.round(rb * kk)); }

    return {
      w: w, h: h, ar: ar, arParam: ra + ':' + rb,
      meanL: meanL, stdL: stdL, meanSat: meanSat, edge: edge,
      meanR: meanR, meanG: meanG, meanB: meanB,
      monoRatio: monoRatio, greenRatio: greenRatio, blueRatio: blueRatio,
      centreL: centreL, borderL: borderL, topL: topL, bottomL: bottomL,
      palette: pal
    };
  }

  /* ---------- turn numbers into words ---------- */
  function describe(m) {
    var d = {};

    // framing
    var f;
    if (m.ar >= 2.2) f = 'ultra-wide panoramic';
    else if (m.ar >= 1.7) f = 'widescreen 16:9';
    else if (m.ar >= 1.4) f = 'landscape 3:2';
    else if (m.ar >= 1.15) f = 'near-square 4:3';
    else if (m.ar >= 0.9) f = 'square 1:1';
    else if (m.ar >= 0.7) f = 'portrait 3:4';
    else if (m.ar >= 0.55) f = 'portrait 2:3';
    else f = 'tall vertical 9:16';
    d.framing = f;

    // exposure
    if (m.meanL > 175) d.exposure = 'bright, high-key lighting';
    else if (m.meanL > 130) d.exposure = 'well-lit, balanced exposure';
    else if (m.meanL > 80) d.exposure = 'moderate, slightly dim lighting';
    else d.exposure = 'dark, low-key lighting';

    // contrast
    if (m.stdL > 68) d.contrast = 'high contrast';
    else if (m.stdL > 38) d.contrast = 'medium contrast';
    else d.contrast = 'soft, low contrast';

    // saturation / monochrome
    if (m.monoRatio > 0.85) d.sat = 'monochrome, black and white';
    else if (m.meanSat > 0.45) d.sat = 'vivid, saturated colour';
    else if (m.meanSat > 0.22) d.sat = 'moderately saturated colour';
    else d.sat = 'muted, desaturated tones';

    // temperature
    var dt = m.meanR - m.meanB;
    if (dt > 14) d.temp = 'warm golden colour temperature';
    else if (dt > 5) d.temp = 'slightly warm tone';
    else if (dt < -14) d.temp = 'cool blue colour temperature';
    else if (dt < -5) d.temp = 'slightly cool tone';
    else d.temp = 'neutral colour temperature';

    // detail
    if (m.edge > 15) d.detail = 'highly detailed with intricate texture';
    else if (m.edge > 7) d.detail = 'moderate detail and texture';
    else d.detail = 'clean and minimal, smooth surfaces';

    // lighting distribution
    var dist = 'evenly lit';
    if (m.centreL > m.borderL * 1.18) dist = 'light falling on the centre with darker edges';
    else if (m.borderL > m.centreL * 1.18) dist = 'brighter edges with a darker centre';
    d.dist = dist;

    var vert = '';
    if (m.topL > m.bottomL * 1.2) vert = 'brighter upper half';
    else if (m.bottomL > m.topL * 1.2) vert = 'brighter lower half';
    d.vert = vert;

    // palette words
    var names = [];
    for (var i = 0; i < m.palette.length && names.length < 4; i++) {
      if (names.indexOf(m.palette[i].name) === -1) names.push(m.palette[i].name);
    }
    d.paletteWords = names.length ? names.join(', ') : 'mixed tones';

    /* Scene hint — deliberately conservative.
       Only monochrome is stated in the prompt, because that one is measured.
       Green / blue dominance stays in the readout panel as a tagged hint and never
       becomes a claim about what the picture "is", because that cannot be measured
       reliably on the client side. */
    d.subject = null; d.hint = null;
    if (m.monoRatio > 0.85) {
      d.subject = 'black and white photograph'; d.hint = 'monochrome (measured)';
    } else if (m.greenRatio > 0.45) {
      d.hint = 'green-dominant (inferred)';
    } else if (m.blueRatio > 0.45) {
      d.hint = 'blue-dominant (inferred)';
    } else {
      d.hint = 'no dominant hue (measured)';
    }

    // mood
    if (m.meanL > 150 && dt > 5) d.mood = 'bright and uplifting atmosphere';
    else if (m.meanL < 95 || m.stdL > 68) d.mood = 'moody and dramatic atmosphere';
    else if (dt < -5) d.mood = 'calm and cool atmosphere';
    else d.mood = 'balanced, natural atmosphere';

    return d;
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function compose(m, d, model, len) {
    var core = [];
    if (d.subject) core.push(d.subject);
    core.push(d.framing + ' composition');
    core.push(d.exposure);
    core.push(d.sat);
    core.push(d.temp);
    if (len !== 'short') { core.push(d.contrast); core.push(d.detail); core.push(d.dist); }
    if (len === 'long') {
      if (d.vert) core.push(d.vert);
      core.push(d.mood);
    }
    var colourLine = 'dominant palette of ' + d.paletteWords;

    if (model === 'midjourney') {
      var mj = core.slice();
      mj.splice(2, 0, colourLine);
      return mj.join(', ') + ' --ar ' + m.arParam;
    }

    if (model === 'sd') {
      var sd = core.slice();
      sd.splice(2, 0, colourLine);
      return 'masterpiece, best quality, ' + sd.join(', ');
    }

    if (model === 'flux') {
      var s = ['A ' + d.framing + ' image.'];
      if (d.subject) s.push('The frame is dominated by ' + d.subject + '.');
      s.push(cap(d.exposure) + '.');
      s.push('The dominant colours are ' + d.paletteWords + '.');
      if (len !== 'short') s.push(cap(d.sat) + ', ' + d.temp + '.');
      if (len !== 'short') s.push(cap(d.detail) + '.');
      if (len === 'long') { s.push(cap(d.dist) + '.'); s.push(cap(d.mood) + '.'); }
      return s.join(' ');
    }

    // dalle
    var s2 = 'A ' + d.framing + ' image';
    if (d.subject) s2 += ' dominated by ' + d.subject;
    s2 += ', ' + d.exposure + ', with a palette of ' + d.paletteWords + '.';
    if (len !== 'short') s2 += ' ' + cap(d.sat) + ', ' + d.temp + ', ' + d.detail + '.';
    if (len === 'long') s2 += ' ' + cap(d.mood) + '.';
    return s2;
  }

  /* ---------- render ---------- */
  function render() {
    if (!state.metrics) { return; }
    var m = state.metrics, d = describe(m);
    var txt = compose(m, d, modelSel.value, lenSel.value);
    out.value = txt;
    copyBtn.disabled = false;
    copied.hidden = true;

    factsGrid.innerHTML = '';
    var rows = [
      ['Dimensions', m.w + ' × ' + m.h],
      ['Aspect ratio', m.arParam + '  (' + m.ar.toFixed(2) + ':1)'],
      ['Mean luminance', m.meanL.toFixed(1) + ' / 255'],
      ['Contrast (σ)', m.stdL.toFixed(1)],
      ['Mean saturation', m.meanSat.toFixed(2)],
      ['Edge density', m.edge.toFixed(1)],
      ['Colour temp (R−B)', (m.meanR - m.meanB).toFixed(1)],
      ['Monochrome pixels', (m.monoRatio * 100).toFixed(1) + '%'],
      ['Scene hint', d.hint]
    ];
    rows.forEach(function (r) {
      var el = document.createElement('div');
      var a = document.createElement('span'); a.textContent = r[0];
      var b = document.createElement('b'); b.textContent = r[1];
      el.appendChild(a); el.appendChild(b);
      factsGrid.appendChild(el);
    });

    swatches.innerHTML = '';
    m.palette.forEach(function (p) {
      var s = document.createElement('span');
      s.className = 'sw';
      var i = document.createElement('i');
      i.style.background = 'rgb(' + p.r + ',' + p.g + ',' + p.b + ')';
      s.appendChild(i);
      s.appendChild(document.createTextNode(p.name + ' ' + Math.round(p.share * 100) + '%'));
      swatches.appendChild(s);
    });

    facts.hidden = false;
  }

  /* ---------- input handling ---------- */
  function flash(msg) {
    out.value = msg;
    copyBtn.disabled = true;
    facts.hidden = true;
  }

  function loadFile(f) {
    if (!f) return;
    if (f.type && f.type.indexOf('image/') !== 0) { flash('That file is not an image. Try a JPG, PNG or WEBP.'); return; }
    if (state.url) { URL.revokeObjectURL(state.url); state.url = null; }
    var url = URL.createObjectURL(f);
    var img = new Image();
    img.onload = function () {
      state.url = url;
      try { state.metrics = analyze(img); } catch (err) {
        flash('Your browser blocked reading this image. Try a different file.'); return;
      }
      preview.src = url;
      dropEmpty.hidden = true; dropFilled.hidden = false; controls.hidden = false;
      render();
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      flash('Your browser could not decode that image. JPG, PNG and WEBP are the safest bets.');
    };
    img.src = url;
  }

  function pick() { fileInput.click(); }

  drop.addEventListener('click', function (e) { if (e.target !== clearBtn) pick(); });
  drop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
  });
  fileInput.addEventListener('change', function () { if (fileInput.files[0]) loadFile(fileInput.files[0]); });

  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.add('over'); });
  });
  ['dragleave', 'dragend'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) {
    e.preventDefault(); e.stopPropagation(); drop.classList.remove('over');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  window.addEventListener('paste', function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        var f = items[i].getAsFile();
        if (f) { e.preventDefault(); loadFile(f); return; }
      }
    }
  });

  clearBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (state.url) { URL.revokeObjectURL(state.url); state.url = null; }
    state.metrics = null;
    preview.removeAttribute('src');
    dropEmpty.hidden = false; dropFilled.hidden = true; controls.hidden = true;
    out.value = ''; copyBtn.disabled = true; facts.hidden = true; copied.hidden = true;
    fileInput.value = '';
  });

  modelSel.addEventListener('change', render);
  lenSel.addEventListener('change', render);

  /* ---------- copy ---------- */
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(t).then(function () { return true; },
        function () { return legacyCopy(t); });
    }
    return Promise.resolve(legacyCopy(t));
  }
  function legacyCopy(t) {
    var ta = document.createElement('textarea');
    ta.value = t; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    return ok;
  }

  copyBtn.addEventListener('click', function () {
    if (!out.value) return;
    copyText(out.value).then(function (ok) {
      copied.textContent = ok ? 'Copied to clipboard' : 'Press Ctrl+C to copy';
      copied.hidden = false;
      if (!ok) { out.focus(); out.select(); }
      setTimeout(function () { copied.hidden = true; }, 2200);
    });
  });

})();
