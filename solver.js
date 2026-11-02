// Hint engine for NYT Pips. It keeps notes like a careful player would (each cell's possible
// pips, and which neighbours are or can't be one domino) and returns the easiest rule from
// RULES.md that makes progress, with an explanation.
(function (root) {
  'use strict';

  // ---- Bits and dominoes --------------------------------------------------------------------
  const bit = v => 1 << v;
  const ALL = 0x7f;
  const pc = m => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
  const valsOf = m => { const out = []; for (let v = 0; v <= 6; v++) if (m & bit(v)) out.push(v); return out; };
  const lo = m => { for (let v = 0; v <= 6; v++) if (m & bit(v)) return v; return 99; };
  const hi = m => { for (let v = 6; v >= 0; v--) if (m & bit(v)) return v; return -99; };
  const tIdx = (a, b) => (a <= b ? a * 7 + b : b * 7 + a);
  const tPips = t => [(t / 7) | 0, t % 7];

  // Reference markers in hint text; the app turns them into colour-coded chips and highlights.
  const C = cells => `[[c:${[].concat(cells).join(',')}]]`;
  const G = k => `[[g:${k}]]`;
  const D = (a, b) => `[[d:${a},${b}]]`;
  const DT = t => D(...tPips(t));
  const list = (items, joiner = 'and') => items.length <= 1 ? String(items[0]) : items.slice(0, -1).join(', ') + ` ${joiner} ` + items[items.length - 1];
  const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;

  // ---- Puzzle -------------------------------------------------------------------------------
  // puzzle: { cells: [{r, c}], regions: [{cells, type: sum|lt|gt|eq|ne, n}],
  //           tray: [[a, b]] (unplaced), placed: [{cells: [i, j], pips: [a, b]}] }
  function build(puzzle) {
    const cells = puzzle.cells.map(c => ({ r: c.r, c: c.c }));
    const N = cells.length;
    const at = new Map(cells.map((c, i) => [c.r + ',' + c.c, i]));
    const nbrs = cells.map(c => [[0, 1], [1, 0], [0, -1], [-1, 0]]
      .map(([dr, dc]) => at.get((c.r + dr) + ',' + (c.c + dc))).filter(j => j !== undefined));
    const edges = [], edgeId = new Map();
    for (let i = 0; i < N; i++) for (const j of nbrs[i]) if (i < j) { edgeId.set(i * N + j, edges.length); edges.push([i, j]); }
    const regions = puzzle.regions.map(r => ({ cells: r.cells.slice(), type: r.type, n: r.n }));
    const regionOf = new Int16Array(N).fill(-1);
    regions.forEach((r, k) => r.cells.forEach(i => { regionOf[i] = k; }));
    const all = puzzle.tray.concat(puzzle.placed.map(d => d.pips));
    const count = new Int16Array(49), halves = new Int16Array(7);
    let total = 0;
    for (const [a, b] of all) { count[tIdx(a, b)]++; halves[a]++; halves[b]++; total += a + b; }
    const order = cells.map((_, i) => i).sort((a, b) => cells[a].r - cells[b].r || cells[a].c - cells[b].c);
    return { N, cells, nbrs, edges, edgeId, regions, regionOf, count, halves, total, order, dominoes: all.length };
  }
  const eid = (P, i, j) => P.edgeId.get(i < j ? i * P.N + j : j * P.N + i);

  // ---- State --------------------------------------------------------------------------------
  function initial(P, puzzle) {
    const S = {
      P, cand: new Uint8Array(P.N).fill(ALL), partner: new Int16Array(P.N).fill(-1),
      split: new Uint8Array(P.edges.length), counted: new Uint8Array(P.edges.length), used: new Int16Array(49),
    };
    for (const d of puzzle.placed) {
      const [i, j] = d.cells;
      S.partner[i] = j; S.partner[j] = i;
      S.cand[i] = bit(d.pips[0]); S.cand[j] = bit(d.pips[1]);
    }
    normalize(S);
    return S;
  }

  function clone(S) {
    return { P: S.P, cand: S.cand.slice(), partner: S.partner.slice(), split: S.split.slice(), counted: S.counted.slice(), used: S.used.slice() };
  }

  // Bookkeeping after any change: a joined cell can't pair with anyone else, and a joined pair
  // whose two values are known is a placed domino, taken out of the tray.
  function normalize(S) {
    const { P } = S;
    for (let i = 0; i < P.N; i++) {
      const p = S.partner[i];
      if (p < 0) continue;
      for (const j of P.nbrs[i]) if (j !== p) S.split[eid(P, i, j)] = 1;
      if (i < p) {
        const e = eid(P, i, p);
        if (!S.counted[e] && pc(S.cand[i]) === 1 && pc(S.cand[p]) === 1) {
          S.counted[e] = 1;
          S.used[tIdx(lo(S.cand[i]), lo(S.cand[p]))]++;
        }
      }
    }
  }

  function apply(S, st) {
    const T = clone(S);
    for (const [i, j] of st.joins) { T.partner[i] = j; T.partner[j] = i; }
    for (const [i, j] of st.splits) T.split[eid(T.P, i, j)] = 1;
    for (const { cell, v } of st.elims) T.cand[cell] &= ~bit(v);
    normalize(T);
    return T;
  }

  const known = (S, i) => (pc(S.cand[i]) === 1 ? lo(S.cand[i]) : -1);
  const avail = (S, t) => S.P.count[t] - S.used[t];
  const isPlaced = (S, i) => S.partner[i] >= 0 && !!S.counted[eid(S.P, i, S.partner[i])];
  const openNbrs = (S, i) => S.P.nbrs[i].filter(j => S.partner[j] < 0 && !S.split[eid(S.P, i, j)]);

  function placedList(S) {
    const out = [];
    for (const [i, j] of S.P.edges) if (S.counted[eid(S.P, i, j)]) out.push({ cells: [i, j], pips: [known(S, i), known(S, j)] });
    return out;
  }

  // Pairs that still need a domino: joined pairs not yet identified, and possible joins.
  function slots(S) {
    const out = [];
    for (const [i, j] of S.P.edges) {
      const e = eid(S.P, i, j);
      if (S.split[e] || S.counted[e]) continue;
      if (S.partner[i] === j) out.push([i, j, true]);
      else if (S.partner[i] < 0 && S.partner[j] < 0) out.push([i, j, false]);
    }
    return out;
  }

  // A domino lying entirely inside one region must suit it on its own.
  function regionPairOk(S, i, j, a, b) {
    const k = S.P.regionOf[i];
    if (k < 0 || k !== S.P.regionOf[j]) return true;
    const R = S.P.regions[k];
    if (R.type === 'eq') return a === b;
    if (R.type === 'ne') return a !== b;
    let mn = a + b, mx = a + b;
    for (const c of R.cells) if (c !== i && c !== j) { mn += lo(S.cand[c]); mx += hi(S.cand[c]); }
    if (R.type === 'sum') return mn <= R.n && mx >= R.n;
    if (R.type === 'lt') return mn < R.n;
    if (R.type === 'gt') return mx > R.n;
    return true;
  }

  function fits(S, i, j, a, b, regions = true) {
    if (!(S.cand[i] & bit(a)) || !(S.cand[j] & bit(b))) return false;
    if (avail(S, tIdx(a, b)) <= 0) return false;
    return !regions || regionPairOk(S, i, j, a, b);
  }

  function homes(S, t) {
    const [a, b] = tPips(t), out = [];
    for (const [i, j] of slots(S)) {
      if (fits(S, i, j, a, b)) out.push({ i, j, a, b });
      if (a !== b && fits(S, i, j, b, a)) out.push({ i, j, a: b, b: a });
    }
    return out;
  }

  function covers(S, i) {
    const out = [];
    const partners = S.partner[i] >= 0 ? [S.partner[i]] : openNbrs(S, i);
    for (const j of partners) for (const a of valsOf(S.cand[i])) for (const b of valsOf(S.cand[j])) {
      if (fits(S, i, j, a, b)) out.push({ j, a, b });
    }
    return out;
  }

  // How many cells already show each value, and which undecided cells could still take it.
  function supply(S) {
    const knownCount = new Int16Array(7), possible = [[], [], [], [], [], [], []];
    for (let i = 0; i < S.P.N; i++) {
      const k = known(S, i);
      if (k >= 0) knownCount[k]++;
      else for (const v of valsOf(S.cand[i])) possible[v].push(i);
    }
    const need = Array.from(S.P.halves, (h, v) => h - knownCount[v]);
    return { knownCount, possible, need };
  }

  // Remaining halves of each value available to the cells of one region.
  function regionSupply(S, k) {
    const inR = new Set(S.P.regions[k].cells);
    return Array.from(S.P.halves, (h, v) => {
      let outside = 0;
      for (let i = 0; i < S.P.N; i++) if (!inR.has(i) && known(S, i) === v) outside++;
      return h - outside;
    });
  }

  function step(o) {
    return Object.assign({ joins: [], splits: [], elims: [], focus: [], regions: [], dominoes: [] }, o);
  }
  const elimsTo = (S, cell, keep) => valsOf(S.cand[cell] & ~keep).map(v => ({ cell, v }));
  const valuesText = vs => list([...vs].sort((a, b) => a - b), 'or');

  // ---- Contradictions -----------------------------------------------------------------------
  // Returns a description of the first thing that can no longer work, or null.
  function contradiction(S) {
    const { P } = S;
    for (let i = 0; i < P.N; i++) if (!S.cand[i]) return { cells: [i], text: 'a cell would have no possible values left' };
    for (let i = 0; i < P.N; i++) {
      if (S.partner[i] < 0 && !openNbrs(S, i).length) return { cells: [i], text: 'a cell would have no neighbour left to pair with' };
    }
    for (let t = 0; t < 49; t++) if (S.used[t] > P.count[t]) return { cells: [], text: `the ${DT(t)} would be needed twice` };
    for (const [i, j, joined] of slots(S)) {
      if (!joined) continue;
      if (!covers(S, i).length) return { cells: [i, j], text: 'a domino would have nothing left in the tray that fits it' };
    }
    const { need, possible } = supply(S);
    for (let v = 0; v <= 6; v++) {
      if (need[v] < 0) return { cells: [], text: `there would be more ${v}s than the tray has` };
      if (possible[v].length < need[v]) return { cells: [], text: `there would be too few places left for the ${v}s` };
    }
    for (let k = 0; k < P.regions.length; k++) {
      const R = P.regions[k];
      let mn = 0, mx = 0, and = ALL, union = 0;
      const seen = new Set();
      for (const c of R.cells) {
        mn += lo(S.cand[c]); mx += hi(S.cand[c]); and &= S.cand[c]; union |= S.cand[c];
        const v = known(S, c);
        if (R.type === 'ne' && v >= 0) { if (seen.has(v)) return { cells: R.cells, text: `the ${G(k)} region would repeat a value` }; seen.add(v); }
      }
      const bad = (R.type === 'sum' && (mn > R.n || mx < R.n)) || (R.type === 'lt' && mn >= R.n) ||
        (R.type === 'gt' && mx <= R.n) || (R.type === 'eq' && !and) || (R.type === 'ne' && pc(union) < R.cells.length);
      if (bad) return { cells: R.cells, text: `the ${G(k)} region couldn't be satisfied` };
    }
    const gap = badGap(S, -1, -1);
    if (gap) return { cells: gap, text: 'some cells would be cut off in a gap no dominoes can fill' };
    for (let t = 0; t < 49; t++) {
      if (avail(S, t) > 0 && homes(S, t).length < avail(S, t)) return { cells: [], text: `the ${DT(t)} would have nowhere to go` };
    }
    return null;
  }

  // Gaps of free cells (optionally after joining i and j) that dominoes can't fill: an odd
  // number of cells, or unequal light and dark squares on a chessboard colouring.
  function badGap(S, i, j) {
    const { P } = S;
    const free = c => S.partner[c] < 0 && c !== i && c !== j;
    const seen = new Uint8Array(P.N);
    for (let start = 0; start < P.N; start++) {
      if (seen[start] || !free(start)) continue;
      const comp = [start];
      seen[start] = 1;
      for (let k = 0; k < comp.length; k++) {
        for (const n of P.nbrs[comp[k]]) {
          if (seen[n] || !free(n) || S.split[eid(P, comp[k], n)]) continue;
          seen[n] = 1;
          comp.push(n);
        }
      }
      let dark = 0;
      for (const c of comp) dark += (P.cells[c].r + P.cells[c].c) & 1;
      if (comp.length % 2 || dark * 2 !== comp.length) return comp;
    }
    return null;
  }

  // ---- Level 1 ------------------------------------------------------------------------------
  function fixedRegion(S) {
    const { P } = S;
    for (let k = 0; k < P.regions.length; k++) {
      const R = P.regions[k], size = R.cells.length;
      let v = -1, why = '';
      if (R.type === 'sum') {
        if (size === 1) { v = R.n; why = `is a single cell that must total ${R.n}`; }
        else if (R.n === 0) { v = 0; why = 'must add up to 0'; }
        else if (R.n === 6 * size) { v = 6; why = `must add up to ${R.n}, the most ${size} cells can hold`; }
      } else if (R.type === 'lt' && R.n === 1) {
        v = 0; why = size === 1 ? 'is a single cell that must be less than 1' : 'must add up to less than 1';
      } else if (R.type === 'gt' && R.n === 6 * size - 1) {
        v = 6; why = size === 1 ? 'is a single cell that must be more than 5' : `must add up to more than ${R.n}`;
      }
      if (v < 0 || v > 6) continue;
      const elims = R.cells.flatMap(c => elimsTo(S, c, bit(v)));
      if (!elims.length) continue;
      return step({
        rule: 'Fixed region', level: 1, elims, focus: R.cells, regions: [k],
        nudge: `The ${G(k)} region can only be filled one way.`,
        text: `The ${G(k)} region ${why}, so ${size === 1 ? "it's" : 'every cell in it is'} ${v}.`,
      });
    }
    return null;
  }

  function deadEnd(S) {
    for (let i = 0; i < S.P.N; i++) {
      if (S.partner[i] >= 0) continue;
      const open = openNbrs(S, i);
      if (open.length !== 1) continue;
      const j = open[0];
      return step({
        rule: 'Dead end', level: 1, joins: [[i, j]], focus: [i, j],
        nudge: `${C(i)} has only one neighbour left to pair with.`,
        text: `${C(i)} has only one neighbour it can still pair with, ${C(j)}, so they're one domino.`,
      });
    }
    return null;
  }

  function dominoEnds(S) {
    for (const [i, j, joined] of slots(S)) {
      if (!joined) continue;
      const types = new Set(), okA = new Set(), okB = new Set();
      for (const a of valsOf(S.cand[i])) for (const b of valsOf(S.cand[j])) {
        if (fits(S, i, j, a, b, false)) { okA.add(a); okB.add(b); types.add(tIdx(a, b)); }
      }
      const elims = [...valsOf(S.cand[i]).filter(a => !okA.has(a)).map(v => ({ cell: i, v })),
        ...valsOf(S.cand[j]).filter(b => !okB.has(b)).map(v => ({ cell: j, v }))];
      if (!elims.length || !types.size) continue;
      const names = [...types].map(DT);
      const one = okA.size === 1 && okB.size === 1;
      return step({
        rule: 'Domino ends', level: 1, elims, focus: [i, j], dominoes: [...types],
        nudge: `Check which dominoes in the tray could be the one on ${C(i)} and ${C(j)}.`,
        text: `${C(i)} and ${C(j)} are one domino. The only unplaced ${types.size === 1 ? 'domino that fits them is' : 'dominoes that fit them are'} ${list(names)}. ` +
          (one ? `So ${C(i)} is ${[...okA][0]} and ${C(j)} is ${[...okB][0]}.`
            : `That leaves ${valuesText(okA)} for ${C(i)} and ${valuesText(okB)} for ${C(j)}.`),
      });
    }
    return null;
  }

  function usedUp(S) {
    const { need } = supply(S);
    for (let v = 0; v <= 6; v++) {
      if (need[v] !== 0) continue;
      const cells = [];
      for (let i = 0; i < S.P.N; i++) if (known(S, i) < 0 && (S.cand[i] & bit(v))) cells.push(i);
      if (!cells.length) continue;
      const h = S.P.halves[v];
      return step({
        rule: 'Used up', level: 1, elims: cells.map(cell => ({ cell, v })), focus: cells,
        nudge: `Count how many ${v}s the tray has.`,
        text: h === 0 ? `No domino in the tray has a ${v}, so no cell can be ${v}. Remove it from ${C(cells)}.`
          : `The tray has ${plural(h, `half showing ${v}`, `halves showing ${v}`)}, and ${h === 1 ? "it's" : "they're all"} already accounted for on the board. So no other cell can be ${v}: remove it from ${C(cells)}.`,
      });
    }
    return null;
  }

  // ---- Level 2 ------------------------------------------------------------------------------
  function regionLimits(S) {
    const { P } = S;
    for (let k = 0; k < P.regions.length; k++) {
      const R = P.regions[k];
      if (!['sum', 'lt', 'gt'].includes(R.type)) continue;
      const elims = [], affected = [];
      let ex = null;
      for (const x of R.cells) {
        if (known(S, x) >= 0) continue;
        let mn = 0, mx = 0;
        for (const c of R.cells) if (c !== x) { mn += lo(S.cand[c]); mx += hi(S.cand[c]); }
        let lb = 0, ub = 6;
        if (R.type === 'sum') { lb = R.n - mx; ub = R.n - mn; }
        else if (R.type === 'lt') ub = R.n - 1 - mn;
        else lb = R.n + 1 - mx;
        const out = valsOf(S.cand[x]).filter(v => v < lb || v > ub);
        if (!out.length) continue;
        out.forEach(v => elims.push({ cell: x, v }));
        affected.push(x);
        if (!ex) ex = { x, lb, ub, mn, mx, cut: out };
      }
      if (!elims.length) continue;
      const size = R.cells.length, { x } = ex;
      const above = ex.cut.some(v => v > ex.ub), below = ex.cut.some(v => v < ex.lb);
      let text;
      if (size === 1) {
        text = R.type === 'lt' ? `The ${G(k)} region is a single cell that must be less than ${R.n}, so it's at most ${R.n - 1}.`
          : R.type === 'gt' ? `The ${G(k)} region is a single cell that must be more than ${R.n}, so it's at least ${R.n + 1}.`
            : `The ${G(k)} region is a single cell that must total ${R.n}.`;
      } else {
        const goal = R.type === 'sum' ? `adds up to ${R.n}` : R.type === 'lt' ? `adds up to less than ${R.n}` : `adds up to more than ${R.n}`;
        const parts = [];
        if (above) parts.push(`the rest of it adds up to at least ${ex.mn}, so ${C(x)} is at most ${ex.ub}`);
        if (below) parts.push(`the rest of it adds up to at most ${ex.mx}, so ${C(x)} is at least ${ex.lb}`);
        text = `The ${G(k)} region ${goal}. ${list(parts).replace(/^./, ch => ch.toUpperCase())}.`;
        const others = affected.filter(c => c !== x);
        if (others.length) text += ` The same reasoning trims ${C(others)}.`;
      }
      return step({
        rule: 'Region limits', level: 2, elims, focus: affected, regions: [k],
        nudge: `Compare the ${G(k)} region's condition with what its other cells can add up to.`,
        text,
      });
    }
    return null;
  }

  function allEqual(S) {
    const { P } = S;
    for (let k = 0; k < P.regions.length; k++) {
      const R = P.regions[k];
      if (R.type !== 'eq') continue;
      const common = R.cells.reduce((m, c) => m & S.cand[c], ALL);
      const elims = R.cells.flatMap(c => elimsTo(S, c, common));
      if (elims.length) {
        return step({
          rule: 'All equal', level: 2, elims, focus: R.cells, regions: [k],
          nudge: `Every cell in the ${G(k)} region must match.`,
          text: `Every cell in the ${G(k)} region has the same value, and only ${valuesText(valsOf(common))} ${pc(common) === 1 ? 'is' : 'are'} still possible in all of them. Each cell keeps just ${pc(common) === 1 ? 'that' : 'those'}.`,
        });
      }
      const sup = regionSupply(S, k);
      const short = valsOf(common).filter(v => sup[v] < R.cells.length);
      if (!short.length) continue;
      const v = short[0];
      return step({
        rule: 'All equal', level: 2, elims: R.cells.map(cell => ({ cell, v })).filter(e => S.cand[e.cell] & bit(v)), focus: R.cells, regions: [k],
        nudge: `Compare the size of the ${G(k)} region with how many of each value the tray has.`,
        text: `The ${G(k)} region needs ${R.cells.length} matching values, but only ${plural(sup[v], `half showing ${v}`, `halves showing ${v}`)} could still go there. So the region can't be all ${v}s.`,
      });
    }
    return null;
  }

  function allDifferent(S) {
    const { P } = S;
    for (let k = 0; k < P.regions.length; k++) {
      const R = P.regions[k];
      if (R.type !== 'ne') continue;
      for (const c of R.cells) {
        const v = known(S, c);
        if (v < 0) continue;
        const hit = R.cells.filter(o => o !== c && known(S, o) < 0 && (S.cand[o] & bit(v)));
        if (!hit.length) continue;
        return step({
          rule: 'All different', level: 2, elims: hit.map(cell => ({ cell, v })), focus: [c, ...hit], regions: [k],
          nudge: `The values in the ${G(k)} region must all be different.`,
          text: `${C(c)} is ${v}, and every value in the ${G(k)} region must be different, so ${C(hit)} can't be ${v}.`,
        });
      }
      const open = R.cells.filter(c => known(S, c) < 0);
      for (let size = 2; size <= 3; size++) {
        for (const group of combos(open, size)) {
          const union = group.reduce((m, c) => m | S.cand[c], 0);
          if (pc(union) !== size) continue;
          const elims = open.filter(c => !group.includes(c)).flatMap(c => valsOf(S.cand[c] & union).map(v => ({ cell: c, v })));
          if (!elims.length) continue;
          return step({
            rule: 'All different', level: 2, elims, focus: open, regions: [k],
            nudge: `In the ${G(k)} region, some cells share the same few values.`,
            text: `In the ${G(k)} region, ${C(group)} can only be ${valuesText(valsOf(union))} between them, so those values are used up there and ${C([...new Set(elims.map(e => e.cell))])} can't have them.`,
          });
        }
      }
      const sup = regionSupply(S, k);
      const usable = valsOf(ALL).filter(v => sup[v] >= 1);
      if (usable.length === R.cells.length) {
        const keep = usable.reduce((m, v) => m | bit(v), 0);
        const elims = R.cells.flatMap(c => elimsTo(S, c, keep));
        if (elims.length) {
          return step({
            rule: 'All different', level: 2, elims, focus: R.cells, regions: [k],
            nudge: `Count which values could still go in the ${G(k)} region.`,
            text: `The ${G(k)} region needs ${R.cells.length} different values, and only ${list(usable)} are still available for it. So it uses exactly those, and nothing else.`,
          });
        }
      }
    }
    return null;
  }

  function doesntFit(S) {
    const { P } = S;
    for (const [i, j, joined] of slots(S)) {
      if (joined) continue;
      let any = false, plain = false;
      for (const a of valsOf(S.cand[i])) for (const b of valsOf(S.cand[j])) {
        if (!fits(S, i, j, a, b, false)) continue;
        plain = true;
        if (regionPairOk(S, i, j, a, b)) { any = true; break; }
      }
      if (any) continue;
      const k = P.regionOf[i], R = P.regions[k];
      let why = 'no unplaced domino has values that fit both of them';
      if (plain && R) {
        why = R.type === 'eq' ? `a domino lying inside the ${G(k)} region would have to be a double, and no double that's left fits`
          : R.type === 'ne' ? `a domino lying inside the ${G(k)} region can't be a double, and only doubles fit`
            : `any domino that fits would put the wrong total in the ${G(k)} region`;
      }
      return step({
        rule: "Doesn't fit", level: 2, splits: [[i, j]], focus: [i, j], regions: plain && R ? [k] : [],
        nudge: `Could ${C(i)} and ${C(j)} be the same domino?`,
        text: `${C(i)} and ${C(j)} can't be one domino: ${why}.`,
      });
    }
    return null;
  }

  function insideRegion(S) {
    const { P } = S;
    for (const [i, j, joined] of slots(S)) {
      if (!joined) continue;
      const k = P.regionOf[i];
      if (k < 0 || k !== P.regionOf[j]) continue;
      const types = new Set(), okA = new Set(), okB = new Set();
      for (const a of valsOf(S.cand[i])) for (const b of valsOf(S.cand[j])) {
        if (fits(S, i, j, a, b)) { okA.add(a); okB.add(b); types.add(tIdx(a, b)); }
      }
      const elims = [...valsOf(S.cand[i]).filter(a => !okA.has(a)).map(v => ({ cell: i, v })),
        ...valsOf(S.cand[j]).filter(b => !okB.has(b)).map(v => ({ cell: j, v }))];
      if (!elims.length || !types.size) continue;
      const R = P.regions[k];
      const kind = R.type === 'eq' ? 'so it must be a double' : R.type === 'ne' ? "so it can't be a double"
        : R.type === 'sum' ? `so its pips count towards the region's ${R.n}` : R.type === 'lt' ? `so its pips count towards keeping the region under ${R.n}` : `so its pips count towards taking the region over ${R.n}`;
      return step({
        rule: 'Domino inside a region', level: 2, elims, focus: [i, j], regions: [k], dominoes: [...types],
        nudge: `The domino on ${C(i)} and ${C(j)} sits entirely inside the ${G(k)} region.`,
        text: `${C(i)} and ${C(j)} are one domino inside the ${G(k)} region, ${kind}. That leaves ${list([...types].map(DT), 'or')}.`,
      });
    }
    return null;
  }

  function whereDoTheyGo(S) {
    const { need, possible } = supply(S);
    for (let v = 6; v >= 0; v--) {
      if (need[v] <= 0 || possible[v].length !== need[v]) continue;
      const cells = possible[v];
      return step({
        rule: `Where do the ${v}s go?`, level: 2, elims: cells.flatMap(c => elimsTo(S, c, bit(v))), focus: cells,
        nudge: `Find every cell that could still be a ${v}.`,
        text: `Every half in the tray ends up on the board, and ${need[v] === 1 ? `one more ${v} still needs a place` : `${need[v]} more ${v}s still need places`}. Only ${C(cells)} can still be ${v}, so ${cells.length === 1 ? "it's" : 'they all are'} ${v}.`,
      });
    }
    return null;
  }

  function onlyHome(S) {
    const found = [];
    for (let t = 0; t < 49; t++) {
      const m = avail(S, t);
      if (m <= 0) continue;
      found.push({ t, m, h: homes(S, t) });
    }
    found.sort((a, b) => a.h.length - b.h.length);
    for (const { t, m, h } of found) {
      if (h.length < m) continue;
      const [a, b] = tPips(t);
      if (m === 1) {
        const pairs = new Set(h.map(x => x.i + ',' + x.j));
        if (pairs.size === 1) {
          const { i, j } = h[0];
          const joins = S.partner[i] === j ? [] : [[i, j]];
          const keepI = h.reduce((mk, x) => mk | bit(x.a), 0), keepJ = h.reduce((mk, x) => mk | bit(x.b), 0);
          const elims = [...elimsTo(S, i, keepI), ...elimsTo(S, j, keepJ)];
          if (!joins.length && !elims.length) continue;
          return step({
            rule: 'Only home', level: 2, joins, elims, focus: [i, j], dominoes: [t],
            nudge: `Where can the ${DT(t)} go?`,
            text: `The ${DT(t)} needs two neighbouring cells that can hold ${a === b ? `${a} and ${a}` : `${a} and ${b}`}. The only place left is ${C(i)} and ${C(j)}` +
              (h.length === 1 ? `, with ${h[0].a} on ${C(i)} and ${h[0].b} on ${C(j)}.` : ', either way round.'),
          });
        }
        const shared = [...new Set(h.flatMap(x => [x.i, x.j]))].filter(c => h.every(x => x.i === c || x.j === c));
        for (const c of shared) {
          const keep = h.reduce((mk, x) => mk | bit(x.i === c ? x.a : x.b), 0);
          const elims = elimsTo(S, c, keep);
          if (!elims.length) continue;
          return step({
            rule: 'Only home', level: 2, elims, focus: [...new Set(h.flatMap(x => [x.i, x.j]))], dominoes: [t],
            nudge: `Where can the ${DT(t)} go?`,
            text: `Every place the ${DT(t)} could go covers ${C(c)}, so that cell is part of it and must be ${valuesText(valsOf(keep))}.`,
          });
        }
      } else if (h.length === m) {
        const cellsUsed = h.flatMap(x => [x.i, x.j]);
        if (new Set(cellsUsed).size !== cellsUsed.length) continue;
        const joins = h.filter(x => S.partner[x.i] !== x.j).map(x => [x.i, x.j]);
        const elims = h.flatMap(x => [...elimsTo(S, x.i, bit(x.a)), ...elimsTo(S, x.j, bit(x.b))]);
        if (!joins.length && !elims.length) continue;
        return step({
          rule: 'Only home', level: 2, joins, elims, focus: cellsUsed, dominoes: [t],
          nudge: `Where can the ${m} copies of the ${DT(t)} go?`,
          text: `The tray has ${m} copies of the ${DT(t)}, and there are exactly ${m} separate places they fit: ${C(cellsUsed)}. They go there.`,
        });
      }
    }
    return null;
  }

  function onlyCover(S) {
    const order = [];
    for (let i = 0; i < S.P.N; i++) if (!isPlaced(S, i)) order.push({ i, o: covers(S, i) });
    order.sort((a, b) => a.o.length - b.o.length);
    for (const { i, o } of order) {
      if (!o.length) continue;
      const partners = new Set(o.map(x => x.j));
      const keepI = o.reduce((m, x) => m | bit(x.a), 0);
      if (partners.size === 1) {
        const j = o[0].j;
        const keepJ = o.reduce((m, x) => m | bit(x.b), 0);
        const joins = S.partner[i] === j ? [] : [[i, j]];
        const elims = [...elimsTo(S, i, keepI), ...elimsTo(S, j, keepJ)];
        if (!joins.length && !elims.length) continue;
        const types = [...new Set(o.map(x => tIdx(x.a, x.b)))];
        return step({
          rule: 'Only cover', level: 2, joins, elims, focus: [i, j], dominoes: types,
          nudge: `How could ${C(i)} be covered?`,
          text: `The only ${types.length === 1 ? 'domino' : 'dominoes'} that can cover ${C(i)} ${types.length === 1 ? 'is' : 'are'} ${list(types.map(DT), 'or')}, ` +
            `paired with ${C(j)}${o.length === 1 ? `: ${o[0].a} on ${C(i)} and ${o[0].b} on ${C(j)}.` : '.'}`,
        });
      }
      const elims = elimsTo(S, i, keepI);
      if (!elims.length) continue;
      return step({
        rule: 'Only cover', level: 2, elims, focus: [i, ...partners],
        nudge: `How could ${C(i)} be covered?`,
        text: `Every domino that could still cover ${C(i)} puts ${valuesText(valsOf(keepI))} on it, so it can't be ${valuesText(elims.map(e => e.v))}.`,
      });
    }
    return null;
  }

  function stranded(S) {
    for (const [i, j, joined] of slots(S)) {
      if (joined) continue;
      const gap = badGap(S, i, j);
      if (!gap) continue;
      const odd = gap.length % 2 === 1;
      return step({
        rule: 'Stranded cells', level: 2, splits: [[i, j]], focus: [i, j, ...gap],
        nudge: `What would happen to the cells around ${C(i)} and ${C(j)} if they were one domino?`,
        text: `If ${C(i)} and ${C(j)} were one domino, ${C(gap)} would be cut off on ${gap.length === 1 ? 'its own' : 'their own'}. ` +
          (odd ? `That's an odd number of cells, which dominoes can't fill.` : `Coloured like a chessboard, those cells aren't half one colour and half the other, and every domino covers one of each.`) +
          ` So they're different dominoes.`,
      });
    }
    return null;
  }

  // ---- Level 3 ------------------------------------------------------------------------------
  function* combos(arr, k, start = 0, acc = []) {
    if (acc.length === k) { yield acc.slice(); return; }
    for (let i = start; i <= arr.length - (k - acc.length); i++) { acc.push(arr[i]); yield* combos(arr, k, i + 1, acc); acc.pop(); }
  }

  function sumCombinations(S) {
    const { P } = S;
    const { knownCount } = supply(S);
    for (let k = 0; k < P.regions.length; k++) {
      const R = P.regions[k];
      const open = R.cells.filter(c => known(S, c) < 0);
      if (!open.length || open.length > 6) continue;
      const base = R.cells.filter(c => known(S, c) >= 0).map(c => known(S, c));
      const baseSum = base.reduce((a, b) => a + b, 0);
      const ok = open.map(() => 0);
      const shapes = new Set();
      const vals = new Array(open.length);
      const used = new Int16Array(7);
      const pairs = []; // joined pairs inside the region among open cells
      for (let x = 0; x < open.length; x++) for (let y = x + 1; y < open.length; y++) if (S.partner[open[x]] === open[y]) pairs.push([x, y]);
      let count = 0;
      const rec = (d, sum) => {
        if (count > 20000) return;
        if (d === open.length) {
          const s = baseSum + sum;
          if (R.type === 'sum' && s !== R.n) return;
          if (R.type === 'lt' && s >= R.n) return;
          if (R.type === 'gt' && s <= R.n) return;
          if (R.type === 'eq' && !vals.every(v => v === vals[0] && base.every(b => b === v))) return;
          if (R.type === 'ne') { const all = base.concat(vals); if (new Set(all).size !== all.length) return; }
          for (const [x, y] of pairs) if (avail(S, tIdx(vals[x], vals[y])) <= 0) return;
          count++;
          vals.forEach((v, x) => { ok[x] |= bit(v); });
          shapes.add(base.concat(vals).sort((a, b) => a - b).join('+'));
          return;
        }
        for (const v of valsOf(S.cand[open[d]])) {
          if (knownCount[v] + used[v] + 1 > P.halves[v]) continue;
          used[v]++; vals[d] = v;
          rec(d + 1, sum + v);
          used[v]--;
        }
      };
      rec(0, 0);
      if (count > 20000 || !count) continue;
      const elims = open.flatMap((c, x) => elimsTo(S, c, ok[x]));
      if (!elims.length) continue;
      const shown = [...shapes].slice(0, 4).map(s => s.replace(/\+/g, ' + '));
      const goal = R.type === 'sum' ? `make ${R.n}` : R.type === 'lt' ? `stay under ${R.n}` : R.type === 'gt' ? `go over ${R.n}` : R.type === 'eq' ? 'match' : 'all differ';
      return step({
        rule: 'Sum combinations', level: 3, elims, focus: R.cells, regions: [k],
        nudge: `List the ways to fill the ${G(k)} region.`,
        text: `List the ways the ${G(k)} region's cells can ${goal} using their possible values and what the tray holds: ${shapes.size > 4 ? 'the options include ' : 'only '}${list(shown, 'or')}${shapes.size > 4 ? ', among others' : ''}. Values that appear in none of them can go: ${C([...new Set(elims.map(e => e.cell))])}.`,
      });
    }
    return null;
  }

  function boardTotal(S) {
    const { P } = S;
    const exact = P.regions.map((r, k) => k).filter(k => P.regions[k].type === 'sum');
    if (!exact.length) return null;
    const inExact = new Set(exact.flatMap(k => P.regions[k].cells));
    const rest = [];
    for (let i = 0; i < P.N; i++) if (!inExact.has(i)) rest.push(i);
    if (!rest.length || rest.every(i => known(S, i) >= 0)) return null;
    const target = P.total - exact.reduce((s, k) => s + P.regions[k].n, 0);
    // Range each other region (or loose cell) can contribute, clipped by its own condition.
    const groups = new Map();
    for (const i of rest) { const k = P.regionOf[i]; const key = k < 0 ? 'c' + i : 'r' + k; if (!groups.has(key)) groups.set(key, { k, cells: [] }); groups.get(key).cells.push(i); }
    const range = (g, skip) => {
      let mn = 0, mx = 0;
      for (const c of g.cells) if (c !== skip) { mn += lo(S.cand[c]); mx += hi(S.cand[c]); }
      if (skip === undefined && g.k >= 0) {
        const R = P.regions[g.k];
        if (R.type === 'lt') mx = Math.min(mx, R.n - 1);
        if (R.type === 'gt') mn = Math.max(mn, R.n + 1);
      }
      return [mn, mx];
    };
    const elims = [], affected = [];
    for (const x of rest) {
      if (known(S, x) >= 0) continue;
      let mn = 0, mx = 0;
      for (const g of groups.values()) {
        const [a, b] = range(g, g.cells.includes(x) ? x : undefined);
        mn += a; mx += b;
      }
      const lb = target - mx, ub = target - mn;
      const out = valsOf(S.cand[x]).filter(v => v < lb || v > ub);
      if (!out.length) continue;
      out.forEach(v => elims.push({ cell: x, v }));
      affected.push(x);
    }
    if (!elims.length) return null;
    return step({
      rule: 'Board total', level: 3, elims, focus: affected, regions: exact,
      nudge: 'Add up all the pips in the tray.',
      text: `All the dominoes together hold ${P.total} pips, and the exact-sum regions take ${P.total - target} of them, so the other ${plural(rest.length, 'cell')} hold ${target} between them. Weighing that against what those cells can hold rules out some values for ${C(affected)}.`,
    });
  }

  // ---- Level 4 ------------------------------------------------------------------------------
  const BASIC = () => [fixedRegion, deadEnd, dominoEnds, usedUp, regionLimits, allEqual, allDifferent, doesntFit, insideRegion, whereDoTheyGo, onlyHome, onlyCover];

  // Follow the basic rules from a state until something breaks (or nothing changes).
  function follow(S, limit = 40) {
    const trail = [];
    let T = S;
    for (let n = 0; n < limit; n++) {
      const bad = contradiction(T);
      if (bad) return { bad, trail };
      let st = null;
      for (const rule of BASIC()) { st = rule(T); if (st) break; }
      if (!st) return { bad: null, trail };
      trail.push(st.rule);
      T = apply(T, st);
    }
    return { bad: null, trail };
  }

  function whatIf(S) {
    const tries = [];
    for (let i = 0; i < S.P.N; i++) {
      if (known(S, i) >= 0 || pc(S.cand[i]) !== 2) continue;
      for (const v of valsOf(S.cand[i])) tries.push({ cell: i, v, label: `${C(i)} were ${v}`, ask: `${C(i)} is ${v}`, assume: T => { T.cand[i] = bit(v); } });
    }
    for (const [i, j, joined] of slots(S)) {
      if (joined) continue;
      tries.push({ pair: [i, j], label: `${C(i)} and ${C(j)} were one domino`, ask: `${C(i)} and ${C(j)} are one domino`, assume: T => { T.partner[i] = j; T.partner[j] = i; } });
    }
    let best = null;
    for (const t of tries) {
      const T = clone(S);
      t.assume(T);
      normalize(T);
      const res = follow(T, best ? Math.min(40, best.trail.length) : 40);
      if (res.bad && (!best || res.trail.length < best.trail.length)) {
        best = { ...t, ...res };
        if (best.trail.length <= 1) break;
      }
    }
    if (!best) return null;
    const chain = best.trail.length ? `following the rules (${list([...new Set(best.trail)])}) leads to a dead end: ${best.bad.text}` : `then ${best.bad.text}`;
    const base = {
      rule: 'What if?', level: 4, focus: best.pair || [best.cell], regions: [],
      nudge: `Try assuming ${best.ask} and see what goes wrong.`,
      text: `Suppose ${best.label}: ${chain}. So ${best.pair ? "they're different dominoes" : `${C(best.cell)} can't be ${best.v}`}.`,
    };
    return step(best.pair ? { ...base, splits: [best.pair] } : { ...base, elims: [{ cell: best.cell, v: best.v }] });
  }

  // ---- Full search ----------------------------------------------------------------------------
  // Plain backtracking that only uses the conditions, independent of the rules above. Used to
  // check the puzzle as read, to reveal a move, and to test the rules.
  function solve(S, limit = 2, onSolution) {
    const { P } = S;
    const val = new Int8Array(P.N).fill(-1), mate = new Int16Array(P.N).fill(-1);
    const left = P.count.slice();
    const regSum = new Int16Array(P.regions.length), regLeft = P.regions.map(r => r.cells.length);
    const regEq = new Int8Array(P.regions.length).fill(-1), regNe = new Uint8Array(P.regions.length);
    const ok = (k, v) => {
      if (k < 0) return true;
      const R = P.regions[k], s = regSum[k] + v, rem = regLeft[k] - 1;
      if (R.type === 'sum') return s <= R.n && s + 6 * rem >= R.n;
      if (R.type === 'lt') return s < R.n;
      if (R.type === 'gt') return s + 6 * rem > R.n;
      if (R.type === 'eq') return regEq[k] < 0 || regEq[k] === v;
      if (R.type === 'ne') return !(regNe[k] & bit(v));
      return true;
    };
    const put = (i, v, sign) => {
      const k = P.regionOf[i];
      if (k < 0) return;
      regSum[k] += sign * v; regLeft[k] -= sign;
      if (P.regions[k].type === 'eq') regEq[k] = sign > 0 ? v : (regLeft[k] === P.regions[k].cells.length ? -1 : regEq[k]);
      if (P.regions[k].type === 'ne') regNe[k] ^= bit(v);
    };
    let found = 0;
    const rec = pos => {
      if (found >= limit) return;
      while (pos < P.N && val[P.order[pos]] >= 0) pos++;
      if (pos === P.N) {
        found++;
        if (onSolution) onSolution(val.slice(), mate.slice());
        return;
      }
      const i = P.order[pos];
      const partners = S.partner[i] >= 0 ? [S.partner[i]] : P.nbrs[i].filter(j => val[j] < 0 && S.partner[j] < 0 && !S.split[eid(P, i, j)]);
      for (const j of partners) {
        if (val[j] >= 0) continue;
        for (const a of valsOf(S.cand[i])) {
          if (!ok(P.regionOf[i], a)) continue;
          put(i, a, 1);
          for (const b of valsOf(S.cand[j])) {
            const t = tIdx(a, b);
            if (left[t] <= 0 || !ok(P.regionOf[j], b)) continue;
            left[t]--; put(j, b, 1); val[i] = a; val[j] = b; mate[i] = j; mate[j] = i;
            rec(pos + 1);
            left[t]++; put(j, b, -1); val[i] = -1; val[j] = -1; mate[i] = -1; mate[j] = -1;
            if (found >= limit) { put(i, a, -1); return; }
          }
          put(i, a, -1);
        }
      }
    };
    rec(0);
    return found;
  }

  function reveal(S) {
    let sol = null;
    const count = solve(S, 2, (val, mate) => { if (!sol) sol = { val, mate }; });
    if (!sol) return null;
    let bestCell = -1, bestN = 1e9;
    for (let i = 0; i < S.P.N; i++) {
      if (isPlaced(S, i)) continue;
      const n = covers(S, i).length;
      if (n < bestN) { bestN = n; bestCell = i; }
    }
    if (bestCell < 0) return null;
    const i = bestCell, j = sol.mate[i], a = sol.val[i], b = sol.val[j];
    return step({
      rule: 'Reveal', level: 4, joins: S.partner[i] === j ? [] : [[i, j]],
      elims: [...elimsTo(S, i, bit(a)), ...elimsTo(S, j, bit(b))], focus: [i, j], dominoes: [tIdx(a, b)],
      nudge: 'None of the rules I know make progress here.',
      text: count > 1
        ? `This part of the puzzle can go more than one way. One choice that works: the ${D(a, b)} on ${C(i)} and ${C(j)}, with ${a} on ${C(i)}.`
        : `None of the rules I know make progress from here. From the full solution, the ${D(a, b)} goes on ${C(i)} and ${C(j)}, with ${a} on ${C(i)}.`,
    });
  }

  const RULES = () => [...BASIC(), stranded, sumCombinations, boardTotal, whatIf];

  function nextStep(S) {
    if (contradiction(S)) return null;
    for (const rule of RULES()) {
      const st = rule(S);
      if (st) return withMoves(S, st);
    }
    const st = reveal(S);
    return st && withMoves(S, st);
  }

  // Mark which dominoes a step places, since placing a domino is the only move in the game.
  function withMoves(S, st) {
    const before = new Set(placedList(S).map(d => d.cells.join(',')));
    st.moves = placedList(apply(S, st)).filter(d => !before.has(d.cells.join(',')));
    return st;
  }

  function check(S) {
    const issues = [];
    const bad = contradiction(S);
    if (bad) issues.push({ kind: 'error', cells: bad.cells, text: `Something doesn't add up: ${bad.text}. Check the board was read correctly.` });
    let solutions = 0;
    if (!bad) {
      solutions = solve(S, 2);
      if (!solutions) issues.push({ kind: 'error', cells: [], text: 'No arrangement of the dominoes meets every condition. Check the board and tray were read correctly.' });
    }
    return { issues, solutions };
  }

  const solved = S => S.P.edges.filter(([i, j]) => S.counted[eid(S.P, i, j)]).length * 2 === S.P.N;

  root.PipsSolver = {
    build, initial, clone, apply, nextStep, check, solve, solved, contradiction,
    known, isPlaced, placedList, valsOf, tIdx, tPips, avail, slots, eid, RULES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
