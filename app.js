(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const PS = PipsSolver;

  let puzzle = null;           // what was read from the screenshot (editable)
  let P = null, S = null;      // solver puzzle and current notes
  let history = [];
  let info = null, step = null, tier = 0, skipped = 0;
  let fixing = false;

  // ---- Loading ------------------------------------------------------------------------------
  $('pick').onclick = $('newShot').onclick = () => $('file').click();
  $('file').onchange = e => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ''; };
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

  async function loadFile(file) {
    $('busy').textContent = 'Reading screenshot…';
    try {
      const img = await decode(file);
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const res = PipsVision.analyze(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (res.cells.length < 2 || !(res.tray.length + res.placed.length)) throw new Error("it doesn't look like a Pips puzzle");

      const b = res.board.bbox;
      const bottom = res.tray.length ? Math.max(...res.tray.map(t => t.box.y1)) + 10 : b.y1;
      const crop = document.createElement('canvas');
      crop.width = Math.min(900, canvas.width);
      crop.height = Math.round(crop.width * (bottom - b.y0 + 20) / canvas.width);
      crop.getContext('2d').drawImage(canvas, 0, b.y0 - 10, canvas.width, bottom - b.y0 + 20, 0, 0, crop.width, crop.height);
      $('compareImg').src = crop.toDataURL('image/jpeg', 0.85);

      const pz = PipsVision.toPuzzle(res);
      pz.warnings = res.warnings;
      $('empty').hidden = true; $('main').hidden = false; $('newShot').hidden = false;
      $('busy').textContent = '';
      start(pz);
    } catch (err) {
      $('busy').textContent = "Couldn't read that image: " + err.message;
    }
  }

  function decode(file) {
    if (window.createImageBitmap) return createImageBitmap(file);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('unsupported image'));
      img.src = URL.createObjectURL(file);
    });
  }

  function start(pz) {
    puzzle = pz;
    P = PS.build(pz);
    S = PS.initial(P, pz);
    history = [];
    recompute();
  }

  // ---- Hint flow ----------------------------------------------------------------------------
  function recompute() {
    info = PS.check(S);
    step = info.issues.length ? null : PS.nextStep(S);
    tier = 0;
    skipped = 0;
    render();
  }

  $('hint').onclick = () => {
    if (!step) return;
    if (tier < 3) { tier++; render(); return; }
    history.push(S);
    S = PS.apply(S, step);
    recompute();
    if (step) { tier = 1; render(); }
  };

  $('back').onclick = () => {
    if (!history.length) return;
    S = history.pop();
    recompute();
  };

  // Notes only exist in the helper; the game's only move is placing a domino. Apply notes
  // until a step places one, then show that step in full.
  $('nextMove').onclick = () => {
    if (!step) return;
    let T = S, st = step, n = 0;
    while (st && !st.moves.length && n < 200) { T = PS.apply(T, st); n++; st = PS.nextStep(T); }
    history.push(S);
    S = T;
    info = PS.check(S);
    step = st;
    tier = st ? 3 : 0;
    skipped = n;
    render();
  };

  // ---- Fixing misreads ------------------------------------------------------------------------
  $('fixBtn').onclick = () => {
    fixing = !fixing;
    $('fixBtn').textContent = fixing ? 'Done fixing' : 'Fix a condition or domino';
    render();
  };

  function labelOf(r) {
    return r.type === 'sum' ? String(r.n) : r.type === 'lt' ? '<' + r.n : r.type === 'gt' ? '>' + r.n : r.type === 'eq' ? '=' : '≠';
  }

  function editRegion(cell) {
    const k = puzzle.regions.findIndex(r => r.cells.includes(cell));
    const current = k >= 0 ? labelOf(puzzle.regions[k]) : '';
    const answer = prompt(k >= 0 ? 'Condition for this region (e.g. 7, <3, >4, = or ≠; leave empty for none):'
      : 'This cell has no condition. Give it one (e.g. 7, <3, >4), or leave empty:', current);
    if (answer === null) return;
    const text = answer.trim().replace('!=', '≠').replace(/^≠$|^!$/, '≠');
    if (!text) { if (k >= 0) puzzle.regions.splice(k, 1); start(puzzle); return; }
    const cond = PipsVision.parseCondition(text);
    if (!cond) { alert(`"${answer}" isn't a condition I understand.`); return; }
    if (k >= 0) Object.assign(puzzle.regions[k], { type: cond.type, n: cond.n });
    else puzzle.regions.push({ cells: [cell], type: cond.type, n: cond.n, color: null });
    start(puzzle);
  }

  function editDomino(idx) {
    if (idx >= puzzle.tray.length) { alert('That domino was already placed in your screenshot.'); return; }
    const [a, b] = puzzle.tray[idx];
    const answer = prompt('Pips on this domino, e.g. 3-5:', `${a}-${b}`);
    if (answer === null) return;
    const m = /^\s*([0-6])\s*[-|, ]\s*([0-6])\s*$/.exec(answer);
    if (!m) { alert('Use two numbers from 0 to 6, like 3-5.'); return; }
    puzzle.tray[idx] = [+m[1], +m[2]];
    start(puzzle);
  }

  // ---- References ---------------------------------------------------------------------------
  // Hint text marks cell groups [[c:...]], regions [[g:k]] and dominoes [[d:a,b]]. Each gets a
  // colour shared by its chip and its highlight; cell groups also get a letter, since Pips has
  // no row or column numbers.
  const REF = /\[\[(c|g|d):([\d,]+)\]\]/g;

  function message(st) {
    if (tier === 1) return st.nudge;
    if (tier === 2) return st.nudge + ' The cells to look at are highlighted.';
    return st.text;
  }

  function refInfo(st) {
    const colours = new Map(), letters = new Map();
    for (const m of [st.nudge, st.text].join(' ').matchAll(REF)) {
      const key = m[1] + m[2];
      if (!colours.has(key)) colours.set(key, colours.size % 5);
      if (m[1] === 'c' && !letters.has(key)) letters.set(key, String.fromCharCode(65 + letters.size));
    }
    return { colours, letters };
  }

  const esc = s => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  function richText(text, refs) {
    let html = '', last = 0;
    for (const m of text.matchAll(REF)) {
      const key = m[1] + m[2], k = refs.colours.get(key);
      let label;
      if (m[1] === 'c') label = refs.letters.get(key);
      else if (m[1] === 'g') label = labelOf(puzzle.regions[+m[2]]);
      else label = m[2].replace(',', '|');
      html += esc(text.slice(last, m.index)) + `<span class="ref k${k}${m[1] === 'd' ? ' dom' : ''}">${esc(label)}</span>`;
      last = m.index + m[0].length;
    }
    return html + esc(text.slice(last));
  }

  // ---- Board ------------------------------------------------------------------------------
  const U = 100, CS = 88, GAP = U - CS, M = 44;
  const FALLBACK = [[0, 130, 147], [146, 81, 202], [219, 19, 122], [209, 86, 9], [84, 118, 1], [18, 64, 118]];
  const rgb = c => `rgb(${c.map(Math.round).join(',')})`;
  const regionColor = k => rgb(puzzle.regions[k].color || FALLBACK[k % FALLBACK.length]);
  const xy = i => [M + P.cells[i].c * U, M + P.cells[i].r * U];

  // Die faces in a unit square; the 6 is turned to run along the domino.
  function pipSpots(n, along) {
    const d = { 0: [], 1: [[0.5, 0.5]], 2: [[0.25, 0.25], [0.75, 0.75]], 3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
      4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]], 5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
      6: [[0.25, 0.22], [0.25, 0.5], [0.25, 0.78], [0.75, 0.22], [0.75, 0.5], [0.75, 0.78]] }[n];
    return along === 'h' && n === 6 ? d.map(([x, y]) => [y, x]) : d;
  }

  function renderBoard(refs) {
    const svg = $('board');
    const rows = Math.max(...P.cells.map(c => c.r)) + 1, cols = Math.max(...P.cells.map(c => c.c)) + 1;
    const W = 2 * M + cols * U - GAP, H = 2 * M + rows * U - GAP;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const at = new Map(P.cells.map((c, i) => [c.r + ',' + c.c, i]));
    const region = i => P.regionOf[i];
    const same = (i, j) => j !== undefined && region(i) >= 0 && region(i) === region(j);
    const active = !fixing && step && tier >= 1 ? step : null;
    const answer = active && tier >= 3 ? step : null;
    const shown = active ? message(active) : '';

    // What the current text points at.
    const ring = new Map(), tag = new Map();
    const domRefs = new Set();
    for (const m of shown.matchAll(REF)) {
      const key = m[1] + m[2], k = refs.colours.get(key);
      if (m[1] === 'c') for (const i of m[2].split(',').map(Number)) { if (!ring.has(i)) ring.set(i, k); if (!tag.has(i)) tag.set(i, [refs.letters.get(key), k]); }
      if (m[1] === 'g') for (const i of puzzle.regions[+m[2]].cells) if (!ring.has(i)) ring.set(i, k);
      if (m[1] === 'd') domRefs.add(m[2] + ':' + k);
    }
    const lit = new Set(active && tier >= 2 ? [...active.focus, ...ring.keys()] : []);
    const dimmed = i => active && tier >= 2 && !lit.has(i);

    // What the answer changes.
    const after = answer ? PS.apply(S, answer) : null;
    const elim = new Set(answer ? answer.elims.map(e => e.cell * 10 + e.v) : []);

    let out = '';
    // Board background, then regions merged across their inner gaps.
    for (let i = 0; i < P.N; i++) {
      const [x, y] = xy(i);
      out += `<rect class="boardbg" x="${x - 12}" y="${y - 12}" width="${CS + 24}" height="${CS + 24}" rx="18"/>`;
    }
    for (let i = 0; i < P.N; i++) {
      if (region(i) >= 0) continue;
      const [x, y] = xy(i);
      out += `<rect class="cellbg" x="${x}" y="${y}" width="${CS}" height="${CS}" rx="10"/>`;
    }
    // Each region is one translucent group, so its cells and the bridges between them don't
    // stack into darker bands where they overlap.
    puzzle.regions.forEach((r, k) => {
      out += `<g fill="${regionColor(k)}" opacity="0.32">`;
      for (const i of r.cells) {
        const [x, y] = xy(i), { r: row, c } = P.cells[i];
        const right = at.get(row + ',' + (c + 1)), down = at.get((row + 1) + ',' + c), diag = at.get((row + 1) + ',' + (c + 1));
        out += `<rect x="${x}" y="${y}" width="${CS}" height="${CS}" rx="10"/>`;
        if (same(i, right)) out += `<rect x="${x + CS - 12}" y="${y}" width="${GAP + 24}" height="${CS}"/>`;
        if (same(i, down)) out += `<rect x="${x}" y="${y + CS - 12}" width="${CS}" height="${GAP + 24}"/>`;
        if (same(i, right) && same(i, down) && same(i, diag)) out += `<rect x="${x + CS - 12}" y="${y + CS - 12}" width="${GAP + 24}" height="${GAP + 24}"/>`;
      }
      out += '</g>';
    });
    // Dashed region outlines on sides that face another region or the edge.
    for (let i = 0; i < P.N; i++) {
      const k = region(i);
      if (k < 0) continue;
      const [x, y] = xy(i), { r, c } = P.cells[i], col = regionColor(k), e = 4;
      const sides = [[0, -1, x + e, y + e, x + e, y + CS - e], [0, 1, x + CS - e, y + e, x + CS - e, y + CS - e],
        [-1, 0, x + e, y + e, x + CS - e, y + e], [1, 0, x + e, y + CS - e, x + CS - e, y + CS - e]];
      for (const [dr, dc, x1, y1, x2, y2] of sides) {
        if (same(i, at.get((r + dr) + ',' + (c + dc)))) continue;
        out += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="4" stroke-dasharray="11 7"/>`;
      }
    }

    // Splits between two free cells (pairs known not to be one domino), then joined pairs and
    // placed dominoes. Splits next to a domino are implied by it, so they aren't drawn.
    const view = after || S;
    for (const [i, j] of P.edges) {
      const e = PS.eid(P, i, j);
      if (!view.split[e] || view.partner[i] >= 0 || view.partner[j] >= 0) continue;
      const [xi, yi] = xy(i), [xj, yj] = xy(j);
      const cls = S.split[e] ? 'wall' : 'wall new';
      if (yi === yj) { const gx = Math.max(xi, xj) - GAP / 2; out += `<line class="${cls}" x1="${gx}" y1="${yi + CS * 0.3}" x2="${gx}" y2="${yi + CS * 0.7}"/>`; }
      else { const gy = Math.max(yi, yj) - GAP / 2; out += `<line class="${cls}" x1="${xi + CS * 0.3}" y1="${gy}" x2="${xi + CS * 0.7}" y2="${gy}"/>`; }
    }
    const pairRect = (i, j, pad) => {
      const [xi, yi] = xy(i), [xj, yj] = xy(j);
      return { x: Math.min(xi, xj) - pad, y: Math.min(yi, yj) - pad, w: Math.abs(xi - xj) + CS + 2 * pad, h: Math.abs(yi - yj) + CS + 2 * pad };
    };
    for (const [i, j] of P.edges) {
      const e = PS.eid(P, i, j);
      if (view.partner[i] !== j) continue;
      const isNew = !!answer && (S.partner[i] !== j || (!S.counted[e] && !!view.counted[e]));
      const rc = pairRect(i, j, 3);
      if (view.counted[e]) {
        out += `<rect class="face${isNew ? ' new' : ''}" x="${rc.x}" y="${rc.y}" width="${rc.w}" height="${rc.h}" rx="14" fill-opacity="0.92"/>`;
        const along = P.cells[i].r === P.cells[j].r ? 'h' : 'v';
        for (const c of [i, j]) {
          const [x, y] = xy(c);
          for (const [px, py] of pipSpots(PS.known(view, c), along)) out += `<circle class="pip" cx="${x + 10 + px * (CS - 20)}" cy="${y + 10 + py * (CS - 20)}" r="8"/>`;
        }
      } else {
        out += `<rect class="join${isNew ? ' new' : ''}" x="${rc.x}" y="${rc.y}" width="${rc.w}" height="${rc.h}" rx="14"/>`;
      }
    }

    // Notes: possible values in fixed 3x3 places (0 at top left), shown once a cell has been
    // narrowed down; or the value itself once it's known.
    for (let i = 0; i < P.N; i++) {
      if (PS.isPlaced(view, i)) continue;
      const [x, y] = xy(i);
      const v = PS.known(view, i);
      if (v >= 0) {
        const isNew = answer && PS.known(S, i) < 0;
        out += `<text class="known${isNew ? ' new' : ''}" x="${x + CS / 2}" y="${y + CS / 2 + 2}">${v}</text>`;
        continue;
      }
      if (view.cand[i] === 0x7f) continue;
      for (const d of PS.valsOf(S.cand[i])) {
        const cx = x + CS * ((d % 3) + 0.5) / 3, cy = y + CS * (((d / 3) | 0) + 0.5) / 3;
        if (elim.has(i * 10 + d)) {
          out += `<text class="cand el" x="${cx}" y="${cy}">${d}</text><line class="strike" x1="${cx - 9}" y1="${cy + 7}" x2="${cx + 9}" y2="${cy - 7}"/>`;
        } else out += `<text class="cand" x="${cx}" y="${cy}">${d}</text>`;
      }
    }

    // Hint highlights: dim the rest of the board (badges of regions not involved fade with it),
    // ring what's referenced, and letter each cell group.
    for (let i = 0; i < P.N; i++) {
      const [x, y] = xy(i);
      if (dimmed(i)) out += `<rect x="${x - 6}" y="${y - 6}" width="${CS + 12}" height="${CS + 12}" rx="14" style="fill: var(--bg); fill-opacity: 0.6"/>`;
    }

    // Condition badges at each region's last cell, like the game.
    puzzle.regions.forEach((r, k) => {
      const last = r.cells.slice().sort((a, b) => P.cells[a].r - P.cells[b].r || P.cells[a].c - P.cells[b].c).pop();
      const [x, y] = xy(last);
      const cx = x + CS + GAP / 2, cy = y + CS + GAP / 2, R = 36;
      const label = labelOf(r), size = label.length >= 3 ? 22 : label.length === 2 ? 27 : 32;
      const faded = r.cells.every(dimmed);
      out += `<g class="badge"${faded ? ' opacity="0.35"' : ''}><path d="M${cx} ${cy - R} L${cx + R} ${cy} L${cx} ${cy + R} L${cx - R} ${cy} Z" fill="${regionColor(k)}" stroke-linejoin="round" stroke="${regionColor(k)}" stroke-width="8"/>` +
        `<text x="${cx}" y="${cy + 1}" font-size="${size}">${esc(label)}</text></g>`;
    });
    for (const [i, k] of ring) {
      const [x, y] = xy(i);
      out += `<rect x="${x + 2}" y="${y + 2}" width="${CS - 4}" height="${CS - 4}" rx="10" style="fill: none; stroke: var(--k${k}); stroke-width: 6"/>`;
    }
    for (const [i, [letter, k]] of tag) {
      const [x, y] = xy(i);
      out += `<g class="tag"><circle cx="${x + 16}" cy="${y + 16}" r="14" style="fill: var(--k${k})"/><text x="${x + 16}" y="${y + 17}">${letter}</text></g>`;
    }
    for (const issue of info.issues) for (const i of issue.cells || []) {
      const [x, y] = xy(i);
      out += `<rect class="issue" x="${x - 4}" y="${y - 4}" width="${CS + 8}" height="${CS + 8}" rx="14"/>`;
    }
    svg.innerHTML = out;
    renderTray(domRefs);
  }

  // ---- Tray -------------------------------------------------------------------------------
  function renderTray(domRefs) {
    const items = puzzle.tray.map((d, idx) => ({ d, idx })).concat(puzzle.placed.map(p => ({ d: p.pips, idx: -1 })));
    // Later copies of each domino are the ones shown as used.
    const usedLeft = Array.from(S.used);
    const marks = items.map(() => false);
    for (let n = items.length - 1; n >= 0; n--) {
      const t = PS.tIdx(...items[n].d);
      if (usedLeft[t] > 0) { usedLeft[t]--; marks[n] = true; }
    }
    const refFor = d => { for (const r of domRefs) { const [ab, k] = r.split(':'); const [a, b] = ab.split(',').map(Number); if (PS.tIdx(a, b) === PS.tIdx(...d)) return +k; } return -1; };
    $('tray').innerHTML = items.map(({ d, idx }, n) => {
      const k = refFor(d);
      let s = `<svg viewBox="0 0 100 50" data-idx="${idx}" class="${marks[n] ? 'used' : ''}"><rect class="tile" x="2" y="2" width="96" height="46" rx="8"${k >= 0 ? ` style="stroke: var(--k${k}); stroke-width: 5"` : ''}/><line class="div" x1="50" y1="8" x2="50" y2="42"/>`;
      d.forEach((v, h) => { for (const [px, py] of pipSpots(v, 'h')) s += `<circle class="pip" cx="${h * 50 + 8 + px * 34}" cy="${8 + py * 34}" r="4.2"/>`; });
      return s + '</svg>';
    }).join('');
  }

  // ---- Panel ------------------------------------------------------------------------------
  // Anchors on rules.html, e.g. "Doesn't fit" -> doesnt-fit; every "Where do the …s go?" shares one.
  const slug = name => (name.startsWith('Where do the') ? 'where-do-they-go'
    : name.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));

  function render() {
    const refs = step ? refInfo(step) : { colours: new Map(), letters: new Map() };
    renderBoard(refs);
    const solved = PS.solved(S);
    $('back').disabled = !history.length;
    $('hint').disabled = !step || fixing;
    $('nextMove').disabled = !step || fixing || (tier >= 3 && step.moves.length > 0);
    const tech = $('technique'), msg = $('message');
    if (fixing) {
      tech.textContent = 'Fixing';
      msg.textContent = 'Tap a region to change its condition, or a domino in the tray to change its pips.';
    } else if (solved) {
      tech.textContent = 'Done';
      msg.textContent = 'Every domino is placed.';
    } else if (!step) {
      tech.textContent = '';
      msg.textContent = info.issues.length ? 'Fix the problem below first.' : 'No step found.';
    } else {
      tech.innerHTML = tier >= 2 ? esc(step.rule) + (step.moves.length ? ' · <span class="move">move</span>' : ' · note') : tier === 1 ? 'Hint' : '';
      if (tier === 0) msg.textContent = 'Tap Hint to get a nudge toward the next step.';
      else msg.innerHTML = richText(message(step), refs) + (tier === 3 && skipped ? ` <span class="note">(${skipped} note${skipped === 1 ? '' : 's'} applied on the way.)</span>` : '');
    }
    $('hint').textContent = tier === 0 ? 'Hint' : tier === 1 ? 'Show where' : tier === 2 ? 'Show answer' : 'Apply & next';
    const link = $('ruleLink');
    link.hidden = !(step && tier >= 2 && !fixing);
    if (!link.hidden) { link.href = 'rules.html#' + slug(step.rule); link.textContent = `How "${step.rule}" works`; }

    $('issues').innerHTML = info.issues.map(i => `<div class="issue-item">${richText(i.text, { colours: new Map(), letters: new Map() })}</div>`).join('');
    const placed = puzzle.placed.length, doms = puzzle.tray.length + placed;
    let note = `Read ${P.N} cells, ${puzzle.regions.length} conditions and ${doms} dominoes${placed ? ` (${placed} already placed)` : ''}.`;
    if (P.N !== 2 * doms) note += ` That doesn't add up: ${P.N} cells need ${P.N / 2} dominoes. Check the screenshot was read correctly.`;
    if (info.solutions > 1) note += ' This puzzle has more than one valid solution, so a few late steps may be free choices.';
    if (puzzle.warnings && puzzle.warnings.length) note += ' ' + puzzle.warnings.join(' ');
    $('note').textContent = note;
  }

  $('board').addEventListener('click', e => {
    if (!fixing) return;
    const svg = $('board'), box = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    const x = ((e.clientX - box.left) / box.width) * vb.width, y = ((e.clientY - box.top) / box.height) * vb.height;
    const c = Math.floor((x - M + GAP / 2) / U), r = Math.floor((y - M + GAP / 2) / U);
    const i = P.cells.findIndex(cell => cell.r === r && cell.c === c);
    if (i >= 0) editRegion(i);
  });
  $('tray').addEventListener('click', e => {
    if (!fixing) return;
    const tile = e.target.closest('svg');
    if (tile) editDomino(+tile.dataset.idx);
  });

  $('compareBtn').onclick = () => {
    const el = $('compare');
    const open = el.style.display !== 'block';
    el.style.display = open ? 'block' : 'none';
    $('compareBtn').textContent = open ? 'Hide screenshot' : 'Compare screenshot';
  };

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
