// Reads an NYT Pips screenshot: the board's cells, its regions and their conditions, the
// dominoes left in the tray, and any dominoes already placed on the board.
// Sizes are measured relative to the cell pitch found in the image, and colours come from
// the image itself, so it works for any board size and in light or dark mode.
(function (root) {
  'use strict';

  const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  const chroma = p => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
  const luma = p => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];

  // Strong region colours (badges and dashed outlines), as opposed to the pale cell fills.
  const isInk = p => chroma(p) > 70 && luma(p) < 175;
  // Badges and outlines proper. Dark-mode cell fills can pass the looser test above.
  const isBadgeInk = p => chroma(p) > 70 && luma(p) < 130;
  // The solid outline drawn around placed dominoes: near-black, or a very dark shade of the
  // region colour. Navy outlines are the one region ink this dark, so bluish pixels are excluded.
  const isOutline = p => luma(p) < 70 && chroma(p) < 80 && p[2] < p[0] + 40;
  // Tray tiles: grey outline and pips, the same in light and dark mode. On smaller screens
  // the thin outline blurs towards the face colour, so accept any darkish grey.
  const isTrayInk = (p, page) => luma(p) < 160 && chroma(p) < 25 && dist(p, page) > 40;

  // Character templates for badge labels: 12x12 coverage (0-9 per bin) plus aspect ratio, learnt
  // from sample screenshots. No sample had a 0 or a 9: the 9 is the 6 turned upside down and the
  // 0 is a drawn ring, so labels using them are flagged as less certain.
  let GLYPHS = {
    '0': { grid: '000479974000017999999710079941149970499400004994799100001997997000000799997000000799799100001997499400004994079941149970017999999710000479974000', aspect: 0.78 },
    '1': { grid: '000257996000457899996000999999996000542599996000000399996000000399996000000399996000000399996000000399996000444699997444999999999999999999999999', aspect: 0.564 },
    '2': { grid: '003799998520158999999983699973379997356510039999000000059997000000289994000001899940000157997410013799851000279999755555899999999999999999999999', aspect: 0.765 },
    '3': { grid: '002599998520038999999983289952359995023400029995000014479841000039998300000039999963000012239997135400009999799842259998279999999972014799997420', aspect: 0.796 },
    '4': { grid: '000001899600000016999600000069999600000697799600005972699600049820699600598200699700999777899977999999999999222222899722000000899600000000899600', aspect: 0.824 },
    '5': { grid: '039999999993039999999971039965555530059930000000069965765310069999999961002765689995000100038998135200017997699742379995279999999851014899997200', aspect: 0.824 },
    '6': { grid: '000156776410002799999972048985558997389930002531699902222100899968999751999977779996899910019999699910009999389952239996027999999851001599997300', aspect: 0.771 },
    '7': { grid: '899999999999999999999999555555569996000000159972000000599830000002899500000017997100000059995000000389972000002799950000005999930000006999930000', aspect: 0.735 },
    '8': { grid: '002578876410038999999961289952258994599930006994299985358851038999999510015999999961269853579997799600017999899831138998489997799972035899997520', aspect: 0.78 },
    '9': { grid: '003799995100158999999720699932259983999900019996999910019998699977779999157999869998001222209996135200039983799855589840279999997200014677651000', aspect: 0.771 },
    '<': { grid: '000000001368000000025899000013689986001379998520358998530000999842000000999842000000358998520000000379998520000013689986000000025899000000000258', aspect: 0.819 },
    '>': { grid: '863100000000999620000000689986310000025899973100000146899852000001358998000000148999000025899863014799984100579987420000998631000000863100000000', aspect: 0.826 },
    '=': { grid: '999999999999999999999999999999999999888888888888222222222221000000000000000000000000000000000000777777777777999999999999999999999999999999999999', aspect: 1.441 },
    '≠': { grid: '000000005610000000039500000000178200777761594167999941960599444305820343000039400000441068024444970495289999522871355555006930000000028500000000', aspect: 0.776 },
  };

  function makeGetter(img) {
    const { width: W, height: H, data } = img;
    return (x, y) => {
      x = x < 0 ? 0 : x >= W ? W - 1 : x | 0;
      y = y < 0 ? 0 : y >= H ? H - 1 : y | 0;
      const i = (y * W + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
  }

  function modeColor(samples) {
    const counts = new Map();
    for (const p of samples) {
      const key = ((p[0] >> 3) << 10) | ((p[1] >> 3) << 5) | (p[2] >> 3);
      const e = counts.get(key);
      if (e) { e.n++; e.r += p[0]; e.g += p[1]; e.b += p[2]; }
      else counts.set(key, { n: 1, r: p[0], g: p[1], b: p[2] });
    }
    let top = null;
    for (const e of counts.values()) if (!top || e.n > top.n) top = e;
    return top ? [top.r / top.n, top.g / top.n, top.b / top.n] : [0, 0, 0];
  }

  // Connected components of a binary mask (4-connected), with area and bounding box.
  function components(mask, w, h, minArea = 1) {
    const label = new Int32Array(w * h).fill(-1);
    const out = [];
    const stack = new Int32Array(w * h);
    for (let start = 0; start < w * h; start++) {
      if (!mask[start] || label[start] >= 0) continue;
      const id = out.length;
      let sp = 0, area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, sx = 0, sy = 0;
      stack[sp++] = start; label[start] = id;
      while (sp) {
        const i = stack[--sp], x = i % w, y = (i / w) | 0;
        area++; sx += x; sy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && mask[i - 1] && label[i - 1] < 0) { label[i - 1] = id; stack[sp++] = i - 1; }
        if (x < w - 1 && mask[i + 1] && label[i + 1] < 0) { label[i + 1] = id; stack[sp++] = i + 1; }
        if (y > 0 && mask[i - w] && label[i - w] < 0) { label[i - w] = id; stack[sp++] = i - w; }
        if (y < h - 1 && mask[i + w] && label[i + w] < 0) { label[i + w] = id; stack[sp++] = i + w; }
      }
      out.push({ id, area, x0, y0, x1, y1, cx: sx / area, cy: sy / area });
    }
    return { comps: out.filter(c => c.area >= minArea), label };
  }

  // ---- Board location ----------------------------------------------------------------------
  // The board is the largest blob that differs from the page background below the header.
  function findBoard(img, get) {
    const W = img.width, H = img.height;
    const pageSamples = [];
    for (let y = Math.round(H * 0.2); y < H * 0.8; y += 8) for (let x = 2; x < W * 0.03; x += 4) pageSamples.push(get(x, y));
    const page = modeColor(pageSamples);
    const f = 4, w = Math.ceil(W / f), h = Math.ceil(H / f);
    const top = Math.floor((H * 0.16) / f);
    const mask = new Uint8Array(w * h);
    for (let y = top; y < h; y++) for (let x = 0; x < w; x++) if (dist(get(x * f, y * f), page) > 24) mask[y * w + x] = 1;
    const { comps } = components(mask, w, h);
    const board = comps.reduce((a, b) => (b.area > a.area ? b : a));
    const bbox = { x0: board.x0 * f, y0: board.y0 * f, x1: Math.min(W, (board.x1 + 1) * f), y1: Math.min(H, (board.y1 + 1) * f) };
    // Board background: just inside the board's left and right edges.
    const bg = [];
    for (let y = bbox.y0; y < bbox.y1; y += 3) {
      let x = bbox.x0;
      while (x < bbox.x1 && dist(get(x, y), page) <= 24) x++;
      if (x < bbox.x1) { bg.push(get(x + 4, y)); bg.push(get(x + 6, y)); }
      x = bbox.x1 - 1;
      while (x > bbox.x0 && dist(get(x, y), page) <= 24) x--;
      if (x > bbox.x0) { bg.push(get(x - 4, y)); bg.push(get(x - 6, y)); }
    }
    return { page, bbox, boardBg: modeColor(bg) };
  }

  // ---- Grid --------------------------------------------------------------------------------
  // Cells are equal squares on a lattice, separated by thin gaps of board background. Collect
  // the edges where a gap meets a cell, then find the pitch that lines them up best.
  function collectEdges(get, bbox, classify, horizontal, minRun) {
    const starts = [], ends = [];
    const [a0, a1, b0, b1] = horizontal ? [bbox.y0, bbox.y1, bbox.x0, bbox.x1] : [bbox.x0, bbox.x1, bbox.y0, bbox.y1];
    for (let a = a0; a < a1; a += 2) {
      const runs = [];
      let prev = -1, runStart = b0;
      for (let b = b0; b <= b1; b++) {
        const c = b < b1 ? classify(horizontal ? get(b, a) : get(a, b)) : -2;
        if (c !== prev) {
          if (prev !== -1) runs.push({ c: prev, s: runStart, e: b });
          prev = c; runStart = b;
        }
      }
      for (let i = 1; i < runs.length; i++) {
        const A = runs[i - 1], B = runs[i];
        if (A.c === 1 && B.c === 2 && B.e - B.s >= minRun && A.e - A.s >= 2) starts.push(B.s);
        if (A.c === 2 && B.c === 1 && A.e - A.s >= minRun && B.e - B.s >= 2) ends.push(A.e);
      }
    }
    return { starts, ends };
  }

  function phaseScore(xs, p) {
    let c = 0, s = 0;
    for (const x of xs) { const a = (2 * Math.PI * x) / p; c += Math.cos(a); s += Math.sin(a); }
    return { R: Math.hypot(c, s), phase: Math.atan2(s, c) };
  }

  function findPitch(edges, pmin, pmax) {
    const score = p => phaseScore(edges.starts, p).R + phaseScore(edges.ends, p).R;
    let best = pmin, bestR = -1;
    for (let p = pmin; p <= pmax; p += 0.25) { const R = score(p); if (R > bestR) { bestR = R; best = p; } }
    // Half the true pitch lines the edges up just as well, so prefer the doubled pitch when it scores as high.
    while (best * 2 <= pmax * 1.05) {
      let p2 = best * 2, r2 = -1;
      for (let p = best * 2 - 1; p <= best * 2 + 1; p += 0.05) { const R = score(p); if (R > r2) { r2 = R; p2 = p; } }
      if (r2 < 0.85 * score(best)) break;
      best = p2;
    }
    let fine = best, fineR = -1;
    for (let p = best - 0.6; p <= best + 0.6; p += 0.02) { const R = score(p); if (R > fineR) { fineR = R; fine = p; } }
    const n = edges.starts.length + edges.ends.length;
    return { p: fine, quality: n ? fineR / n : 0 };
  }

  const wrap = (v, p) => ((v % p) + p) % p;

  function findGrid(img, get, board) {
    const { page, boardBg, bbox } = board;
    const classify = p => (dist(p, page) < 30 ? 0 : dist(p, boardBg) < 20 ? 1 : 2);
    const minRun = Math.round(img.width * 0.02);
    const hEdges = collectEdges(get, bbox, classify, true, minRun);
    const vEdges = collectEdges(get, bbox, classify, false, minRun);
    const pmin = img.width * 0.06, pmax = img.width * 0.3;
    const hx = findPitch(hEdges, pmin, pmax), vy = findPitch(vEdges, pmin, pmax);
    // Both directions share one pitch; trust the steadier estimate if they disagree.
    let p = (hx.p + vy.p) / 2;
    if (Math.abs(hx.p - vy.p) > 0.02 * p) p = hx.quality >= vy.quality ? hx.p : vy.p;
    const offset = xs => wrap((phaseScore(xs, p).phase / (2 * Math.PI)) * p, p);
    const oL = offset(hEdges.starts), oR = offset(hEdges.ends);
    const oT = offset(vEdges.starts), oB = offset(vEdges.ends);
    const s = (wrap(oR - oL, p) + wrap(oB - oT, p)) / 2;
    return { p, s, g: p - s, oL, oT };
  }

  // ---- Cells -------------------------------------------------------------------------------
  function findCells(get, board, grid) {
    const { page, boardBg, bbox } = board;
    const { p, s, oL, oT } = grid;
    const kmin = Math.floor((bbox.x0 - oL) / p) - 1, kmax = Math.ceil((bbox.x1 - oL) / p) + 1;
    const jmin = Math.floor((bbox.y0 - oT) / p) - 1, jmax = Math.ceil((bbox.y1 - oT) / p) + 1;
    const found = [];
    for (let j = jmin; j <= jmax; j++) {
      for (let k = kmin; k <= kmax; k++) {
        const x0 = oL + k * p, y0 = oT + j * p;
        if (x0 + s < bbox.x0 || x0 > bbox.x1 || y0 + s < bbox.y0 || y0 > bbox.y1) continue;
        let inside = 0;
        for (const a of [0.3, 0.5, 0.7]) for (const b of [0.3, 0.5, 0.7]) {
          const q = get(x0 + a * s, y0 + b * s);
          if (dist(q, page) > 30 && dist(q, boardBg) > 18) inside++;
        }
        if (inside >= 6) found.push({ j, k, x0, y0 });
      }
    }
    const j0 = Math.min(...found.map(c => c.j)), k0 = Math.min(...found.map(c => c.k));
    return found.map((c, id) => ({ id, r: c.j - j0, c: c.k - k0, x0: c.x0, y0: c.y0 }));
  }

  // ---- Badges ------------------------------------------------------------------------------
  // Each condition sits in a diamond centred on a cell corner (the bottom-right corner of the
  // region's last cell). Test every corner next to a cell for a solid diamond of region colour.
  // Probe points stay clear of the label text and of the diamond's top-left quarter, which
  // the owning cell's rounded corner partly covers.
  const RING = [[0.33, 0], [-0.33, 0], [0, 0.33], [0, -0.3], [0.25, 0.1], [-0.25, 0.1], [0.1, 0.25], [-0.1, 0.25], [0.15, -0.18]];
  const BADGE_R = 0.45;

  function findBadges(get, cells, grid) {
    const { p, g } = grid;
    const at = new Map(cells.map(c => [c.r + ',' + c.c, c]));
    const seen = new Set();
    const badges = [];
    for (const cell of cells) {
      for (const [dr, dc] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
        const r = cell.r + dr, c = cell.c + dc, key = r + ',' + c;
        if (seen.has(key)) continue;
        seen.add(key);
        const cx = cell.x0 + dc * p - g / 2, cy = cell.y0 + dr * p - g / 2;
        const hits = RING.map(([dx, dy]) => get(cx + dx * p, cy + dy * p)).filter(isBadgeInk);
        if (hits.length < 7) continue;
        const color = [0, 1, 2].map(i => hits.map(h => h[i]).sort((a, b) => a - b)[hits.length >> 1]);
        if (hits.filter(h => dist(h, color) <= 90).length < 7) continue;
        const around = [[r - 1, c - 1], [r - 1, c], [r, c - 1], [r, c]].map(([a, b]) => at.get(a + ',' + b)).filter(Boolean);
        badges.push({ cx, cy, r, c, color, around });
      }
    }
    return badges;
  }

  const inBadge = (badges, p) => (x, y) => badges.some(b => Math.abs(x - b.cx) + Math.abs(y - b.cy) < (BADGE_R + 0.03) * p);

  // White label text inside a badge, split into characters and matched against templates.
  function readBadge(get, badge, p) {
    const R = Math.round(0.36 * p), size = 2 * R + 1;
    const cy = badge.cy + 0.03 * p; // the label sits slightly below the corner
    const mask = new Uint8Array(size * size);
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
      if (Math.abs(x) + Math.abs(y) > R) continue;
      const q = get(badge.cx + x, cy + y);
      if (luma(q) > 235 && chroma(q) < 25) mask[(y + R) * size + (x + R)] = 1;
    }
    const { comps, label } = components(mask, size, size, Math.max(4, Math.round(p * p * 0.0012)));
    comps.sort((a, b) => a.x0 - b.x0);
    // Pieces that overlap horizontally (the two bars of "=", or "≠") form one character.
    const chars = [];
    for (const k of comps) {
      const last = chars[chars.length - 1];
      const overlap = last ? Math.min(last.x1, k.x1) - Math.max(last.x0, k.x0) : -1;
      if (last && overlap > 0.3 * Math.min(last.x1 - last.x0, k.x1 - k.x0)) {
        last.ids.push(k.id);
        last.x0 = Math.min(last.x0, k.x0); last.x1 = Math.max(last.x1, k.x1);
        last.y0 = Math.min(last.y0, k.y0); last.y1 = Math.max(last.y1, k.y1);
      } else chars.push({ ids: [k.id], x0: k.x0, x1: k.x1, y0: k.y0, y1: k.y1 });
    }
    const feats = chars.map(ch => glyphFeature(label, size, ch, p));
    const reads = feats.map(classifyGlyph);
    return { text: reads.map(r => r.ch).join(''), confidence: Math.min(1, ...reads.map(r => r.margin)), feats };
  }

  function glyphFeature(label, size, ch, p) {
    const N = 12, grid = new Float32Array(N * N);
    const w = ch.x1 - ch.x0 + 1, h = ch.y1 - ch.y0 + 1;
    const ids = new Set(ch.ids);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let on = 0, tot = 0;
      for (let y = Math.floor(ch.y0 + (j * h) / N); y < Math.ceil(ch.y0 + ((j + 1) * h) / N); y++) {
        for (let x = Math.floor(ch.x0 + (i * w) / N); x < Math.ceil(ch.x0 + ((i + 1) * w) / N); x++) {
          tot++;
          if (ids.has(label[y * size + x])) on++;
        }
      }
      grid[j * N + i] = tot ? on / tot : 0;
    }
    return { grid, aspect: w / h, height: h / p };
  }

  function classifyGlyph(f) {
    if (!GLYPHS) return { ch: '?', margin: 0 };
    const scored = Object.entries(GLYPHS).map(([ch, t]) => {
      let s = 0;
      for (let k = 0; k < f.grid.length; k++) { const d = f.grid[k] - (t.grid.charCodeAt(k) - 48) / 9; s += d * d; }
      s += 40 * Math.pow(Math.log(f.aspect / t.aspect), 2);
      return { ch, s };
    }).sort((a, b) => a.s - b.s);
    return { ch: scored[0].ch, score: scored[0].s, margin: Math.min(1, (scored[1].s - scored[0].s) / 4) };
  }

  function parseCondition(text) {
    if (text === '=') return { type: 'eq' };
    if (text === '≠') return { type: 'ne' };
    let m = /^([<>]?)(\d+)$/.exec(text);
    if (!m) return null;
    const n = +m[2];
    return m[1] === '<' ? { type: 'lt', n } : m[1] === '>' ? { type: 'gt', n } : { type: 'sum', n };
  }

  // ---- Cell appearance -----------------------------------------------------------------------
  function cellFill(get, cell, grid, masked) {
    const { s, p } = grid;
    const samples = [];
    const m = 0.12 * s;
    for (let y = m; y < s - m; y += 3) for (let x = m; x < s - m; x += 3) {
      const ax = cell.x0 + x, ay = cell.y0 + y;
      if (masked(ax, ay)) continue;
      // Skip the corners, where badges can overlap.
      const cx = Math.min(x, s - x), cy = Math.min(y, s - y);
      if (cx + cy < 0.3 * p) continue;
      samples.push(get(ax, ay));
    }
    return modeColor(samples);
  }

  // Fraction of a cell side that carries the solid placed-domino outline, which runs just
  // outside the cell square, in the gap.
  function outlineFraction(get, cell, grid, side, masked) {
    const { s, p } = grid;
    let dark = 0, n = 0;
    for (let t = 0.15; t <= 0.85; t += 0.035) {
      let hit = false, skip = false;
      for (let o = -0.04 * p; o <= 0.09 * p; o += 1) {
        let x, y;
        if (side === 0) { x = cell.x0 - o; y = cell.y0 + t * s; }               // left
        else if (side === 1) { x = cell.x0 + s + o; y = cell.y0 + t * s; }      // right
        else if (side === 2) { x = cell.x0 + t * s; y = cell.y0 - o; }          // top
        else { x = cell.x0 + t * s; y = cell.y0 + s + o; }                      // bottom
        if (masked(x, y)) { skip = true; continue; }
        if (isOutline(get(x, y))) { hit = true; break; }
      }
      if (skip && !hit) continue;
      n++;
      if (hit) dark++;
    }
    return n ? dark / n : 0;
  }

  // Dashed region outline along one side of a cell (inside the cell square).
  function dashPixels(get, cell, grid, side, fill, masked) {
    const { s, p } = grid;
    let count = 0;
    for (let t = 0.12; t <= 0.88; t += 0.01) {
      for (let o = 0; o <= 0.1 * p; o += 1) {
        let x, y;
        if (side === 0) { x = cell.x0 + o; y = cell.y0 + t * s; }
        else if (side === 1) { x = cell.x0 + s - 1 - o; y = cell.y0 + t * s; }
        else if (side === 2) { x = cell.x0 + t * s; y = cell.y0 + o; }
        else { x = cell.x0 + t * s; y = cell.y0 + s - 1 - o; }
        if (masked(x, y)) continue;
        const q = get(x, y);
        if (isInk(q) && dist(q, fill) > 120) count++;
      }
    }
    return count;
  }

  // Is the gap between two neighbouring cells filled in (same region, or one domino)?
  function gapFilled(get, a, b, grid, boardBg, masked) {
    const { s, g } = grid;
    // Scan across the whole gap: a placed domino's outline can run right down its middle.
    let filled = 0, n = 0;
    const horizontal = a.r === b.r;
    const first = horizontal ? (a.c < b.c ? a : b) : (a.r < b.r ? a : b);
    for (let t = 0.2; t <= 0.8; t += 0.04) {
      for (let u = 0.15; u <= 0.85; u += 0.14) {
        const x = horizontal ? first.x0 + s + u * g : first.x0 + t * s;
        const y = horizontal ? first.y0 + t * s : first.y0 + s + u * g;
        if (masked(x, y)) continue;
        const q = get(x, y);
        if (isOutline(q)) continue;
        n++;
        if (dist(q, boardBg) > 20) filled++;
      }
    }
    return n ? filled / n : 0;
  }

  // Pips on a placed half: dark dots on the light domino face.
  function countPips(get, cell, grid, fill, masked) {
    const { s, p } = grid;
    const m = Math.round(0.1 * s), w = Math.round(s) - 2 * m;
    const mask = new Uint8Array(w * w);
    const fl = luma(fill);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const ax = cell.x0 + m + x, ay = cell.y0 + m + y;
      if (masked(ax, ay)) continue;
      if (luma(get(ax, ay)) < fl - 70) mask[y * w + x] = 1;
    }
    const { comps } = components(mask, w, w);
    return comps.filter(k => k.area >= 0.006 * p * p && k.area <= 0.08 * p * p).length;
  }

  // ---- Tray --------------------------------------------------------------------------------
  function readTray(img, get, top, page) {
    const W = img.width, H = img.height, h = H - top;
    const mask = new Uint8Array(W * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < W; x++) {
      if (isTrayInk(get(x, top + y), page)) mask[y * W + x] = 1;
    }
    const { comps } = components(mask, W, h, 4);
    // A tile is a wide grey outline around a light face; placeholders for placed dominoes have no face.
    const face = k => luma(get((k.x0 + k.x1) / 2 + (k.x1 - k.x0) * 0.1, top + k.y0 + (k.y1 - k.y0) * 0.2)) > 200;
    const tiles = comps.filter(k => k.x1 - k.x0 > 0.06 * W && k.y1 - k.y0 > 0.025 * W && k.x1 - k.x0 > 1.4 * (k.y1 - k.y0) && face(k));
    const dots = comps.filter(k => !tiles.includes(k) && k.x1 - k.x0 < 0.05 * W);
    const out = tiles.map(t => {
      const mid = (t.x0 + t.x1) / 2;
      const inside = dots.filter(d => d.cx > t.x0 && d.cx < t.x1 && d.cy > t.y0 && d.cy < t.y1 &&
        d.area > 0.0015 * (t.x1 - t.x0) * (t.y1 - t.y0));
      return {
        a: inside.filter(d => d.cx < mid).length,
        b: inside.filter(d => d.cx >= mid).length,
        box: { x0: t.x0, y0: t.y0 + top, x1: t.x1, y1: t.y1 + top },
      };
    });
    out.sort((u, v) => (Math.abs(u.box.y0 - v.box.y0) > 0.02 * W ? u.box.y0 - v.box.y0 : u.box.x0 - v.box.x0));
    return out;
  }

  // ---- Main ----------------------------------------------------------------------------------
  function analyze(img) {
    const get = makeGetter(img);
    const board = findBoard(img, get);
    const grid = findGrid(img, get, board);
    const cells = findCells(get, board, grid);
    const { p } = grid;
    const badges = findBadges(get, cells, grid);
    const masked = inBadge(badges, p);
    const warnings = [];
    const at = new Map(cells.map(c => [c.r + ',' + c.c, c]));
    const nbr = (c, dr, dc) => at.get((c.r + dr) + ',' + (c.c + dc));

    for (const cell of cells) {
      cell.fill = cellFill(get, cell, grid, masked);
      cell.outline = [0, 1, 2, 3].map(side => outlineFraction(get, cell, grid, side, masked));
      cell.dashes = [0, 1, 2, 3].map(side => dashPixels(get, cell, grid, side, cell.fill, masked));
    }

    // Placed dominoes: a placed half is outlined on its outer sides and open on the divider side,
    // facing its other half. A neighbouring domino's outline can make an empty cell look outlined
    // on one or two sides, so a half only counts once it has a matching partner.
    const SIDES = [[0, -1, 0, 1], [0, 1, 1, 0], [-1, 0, 2, 3], [1, 0, 3, 2]]; // dr, dc, side, opposite
    const outlined = (c, side) => c.outline[side] > 0.4;
    const maybePlaced = c => [0, 1, 2, 3].filter(side => outlined(c, side)).length >= 2;
    for (const cell of cells) {
      if (!maybePlaced(cell)) continue;
      const options = SIDES.map(([dr, dc, side, opp]) => ({ n: nbr(cell, dr, dc), side, opp }))
        .filter(o => o.n && maybePlaced(o.n) && !outlined(cell, o.side) && !outlined(o.n, o.opp) &&
          gapFilled(get, cell, o.n, grid, board.boardBg, masked) > 0.6);
      if (options.length === 1) cell.partner = options[0].n.id;
    }
    const placed = [];
    for (const cell of cells) {
      const other = cell.partner === undefined ? null : cells[cell.partner];
      cell.placed = !!other && other.partner === cell.id;
      if (!cell.placed && maybePlaced(cell) && [0, 1, 2, 3].filter(side => outlined(cell, side)).length >= 3) {
        warnings.push(`Couldn't tell which domino the placed half at row ${cell.r + 1}, column ${cell.c + 1} belongs to.`);
      }
      if (!cell.placed) delete cell.partner;
    }
    for (const cell of cells) {
      if (!cell.placed || cell.partner < cell.id) continue;
      const other = cells[cell.partner];
      cell.pips = countPips(get, cell, grid, cell.fill, masked);
      other.pips = countPips(get, other, grid, other.fill, masked);
      placed.push({ cells: [cell.id, other.id], pips: [cell.pips, other.pips] });
    }

    // Regions: neighbours with no dashed outline between them and the gap filled in. The two
    // halves of a placed domino always look joined and lose their dashes along the divider, so
    // for them the deciding clue is whether both faces carry the same region tint.
    const DASH_MIN = 0.4 * p;
    const parent = cells.map(c => c.id);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const cell of cells) {
      for (const [dr, dc, side, opp] of [SIDES[1], SIDES[3]]) {
        const o = nbr(cell, dr, dc);
        if (!o) continue;
        if (cell.dashes[side] > DASH_MIN || o.dashes[opp] > DASH_MIN) continue;
        if (cell.partner === o.id) {
          if (dist(cell.fill, o.fill) > 30) continue;
        } else if (gapFilled(get, cell, o, grid, board.boardBg, masked) < 0.6) continue;
        parent[find(cell.id)] = find(o.id);
      }
    }
    const groups = new Map();
    for (const cell of cells) {
      const root = find(cell.id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(cell.id);
    }

    // Attach each badge to the region of the neighbouring cell whose outline colour matches
    // best, preferring the cell to its upper left (the region's last cell).
    const regionOf = new Map();
    const regions = [];
    for (const ids of groups.values()) {
      const region = { id: regions.length, cells: ids, cond: null, label: '', color: null };
      regions.push(region);
      for (const id of ids) regionOf.set(id, region);
    }
    for (const cell of cells) {
      const samples = [];
      const { s } = grid;
      for (let t = 0; t < s; t += 2) for (const o of [2, 4, 6]) {
        for (const [x, y] of [[cell.x0 + o, cell.y0 + t], [cell.x0 + s - o, cell.y0 + t], [cell.x0 + t, cell.y0 + o], [cell.x0 + t, cell.y0 + s - o]]) {
          if (masked(x, y)) continue;
          const q = get(x, y);
          if (isBadgeInk(q)) samples.push(q);
        }
      }
      cell.ink = samples.length > 10 ? modeColor(samples) : null;
    }
    for (const badge of badges) {
      let best = null, bestScore = Infinity;
      for (const cell of badge.around) {
        const region = regionOf.get(cell.id);
        const ink = region.cells.map(i => cells[i].ink).find(Boolean);
        const score = (ink ? dist(ink, badge.color) : 200) + (cell.r === badge.r - 1 && cell.c === badge.c - 1 ? 0 : 40) + (region.cond ? 500 : 0);
        if (score < bestScore) { bestScore = score; best = region; }
      }
      if (!best) continue;
      const read = readBadge(get, badge, p);
      badge.read = read;
      badge.region = best.id;
      best.label = read.text;
      best.cond = parseCondition(read.text);
      best.color = badge.color;
      best.confidence = read.confidence;
      if (!best.cond) warnings.push(`Couldn't read the condition "${read.text}".`);
    }

    const trayTop = Math.round(board.bbox.y1 + 0.3 * p);
    const tray = readTray(img, get, trayTop, board.page);

    return {
      grid, board, warnings, badges, tray, placed,
      cells: cells.map(c => ({ id: c.id, r: c.r, c: c.c, x0: c.x0, y0: c.y0, region: regionOf.get(c.id).id, placed: c.placed, pips: c.pips })),
      regions: regions.map(r => ({ id: r.id, cells: r.cells, cond: r.cond, label: r.label, color: r.color, confidence: r.confidence })),
      debugCells: cells,
    };
  }

  // A compact, editable description of the puzzle for the solver.
  function toPuzzle(res) {
    return {
      cells: res.cells.map(c => ({ r: c.r, c: c.c })),
      regions: res.regions.filter(r => r.cond).map(r => ({ cells: r.cells.slice(), type: r.cond.type, n: r.cond.n, color: r.color })),
      tray: res.tray.map(t => [t.a, t.b]),
      placed: res.placed.map(d => ({ cells: d.cells.slice(), pips: d.pips.slice() })),
    };
  }

  root.PipsVision = {
    analyze, toPuzzle, parseCondition,
    setGlyphs(g) { GLYPHS = g; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
