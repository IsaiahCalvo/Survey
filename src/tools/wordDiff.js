// Diff two sequences (of words). Myers' O(ND) diff for most inputs; when the
// two sides differ a lot, words that occur once on each side anchor the match
// (like patience diff) so a 200-page document never stalls.
//
// Returns hunks covering both sequences in order:
//   { type: 'equal' | 'change', a0, a1, b0, b1 }
// A 'change' hunk removes a[a0..a1) and adds b[b0..b1); either may be empty.

// Past this many edits (or this much work) Myers stops and anchors take over.
const MAX_EDITS = 1200;
const MAX_WORK = 4_000_000;

export function diffSeq(a, b) {
  const ids = new Map();
  const code = (s) => {
    let id = ids.get(s);
    if (id === undefined) { id = ids.size; ids.set(s, id); }
    return id;
  };
  const A = Int32Array.from(a, code);
  const B = Int32Array.from(b, code);
  const steps = [];
  diffRange(A, 0, A.length, B, 0, B.length, steps);
  return toHunks(steps);
}

// Steps are [kind, aIndex, bIndex, length]: kind 0 equal, 1 removed, 2 added.
function diffRange(A, a0, a1, B, b0, b1, out) {
  let pre = 0;
  while (a0 + pre < a1 && b0 + pre < b1 && A[a0 + pre] === B[b0 + pre]) pre += 1;
  if (pre) out.push([0, a0, b0, pre]);
  a0 += pre; b0 += pre;
  let suf = 0;
  while (a1 - suf > a0 && b1 - suf > b0 && A[a1 - suf - 1] === B[b1 - suf - 1]) suf += 1;
  a1 -= suf; b1 -= suf;
  if (a0 === a1 && b0 < b1) out.push([2, a0, b0, b1 - b0]);
  else if (b0 === b1 && a0 < a1) out.push([1, a0, b0, a1 - a0]);
  else if (a0 < a1) {
    const steps = myers(A, a0, a1, B, b0, b1);
    if (steps) out.push(...steps);
    else anchored(A, a0, a1, B, b0, b1, out);
  }
  if (suf) out.push([0, a1, b1, suf]);
}

function myers(A, aLo, aHi, B, bLo, bHi) {
  const N = aHi - aLo;
  const M = bHi - bLo;
  const max = Math.min(N + M, MAX_EDITS);
  const off = max + 1;
  const V = new Int32Array(2 * max + 3);
  const trace = [];
  let work = 0;
  for (let d = 0; d <= max; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && V[off + k - 1] < V[off + k + 1])) ? V[off + k + 1] : V[off + k - 1] + 1;
      let y = x - k;
      const x0 = x;
      while (x < N && y < M && A[aLo + x] === B[bLo + y]) { x += 1; y += 1; }
      work += 1 + x - x0;
      V[off + k] = x;
      if (x >= N && y >= M) {
        trace.push(V.slice(off - d, off + d + 1));
        return backtrack(trace, N, M, aLo, bLo);
      }
    }
    trace.push(V.slice(off - d, off + d + 1));
    if (work > MAX_WORK) return null;
  }
  return null;
}

function backtrack(trace, N, M, aLo, bLo) {
  const rev = [];
  let x = N;
  let y = M;
  for (let d = trace.length - 1; d > 0; d -= 1) {
    const prev = trace[d - 1];
    const k = x - y;
    const at = (kk) => prev[kk + d - 1];
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const pk = down ? k + 1 : k - 1;
    const px = at(pk);
    const py = px - pk;
    const sx = down ? px : px + 1;
    const sy = down ? py + 1 : py;
    if (x > sx) rev.push([0, aLo + sx, bLo + sy, x - sx]);
    rev.push(down ? [2, aLo + px, bLo + py, 1] : [1, aLo + px, bLo + py, 1]);
    x = px; y = py;
  }
  if (x > 0) rev.push([0, aLo, bLo, x]);
  return rev.reverse();
}

// Words found exactly once on each side, kept in the longest run that is in
// the same order on both sides, split the problem into smaller gaps.
function anchored(A, a0, a1, B, b0, b1, out) {
  const count = new Map();
  for (let i = a0; i < a1; i += 1) {
    const c = count.get(A[i]);
    count.set(A[i], c === undefined ? [1, 0, i, -1] : (c[0] += 1, c));
  }
  for (let j = b0; j < b1; j += 1) {
    const c = count.get(B[j]);
    if (c) { c[1] += 1; c[3] = j; }
  }
  const pairs = [];
  for (const [, c] of count) if (c[0] === 1 && c[1] === 1) pairs.push([c[2], c[3]]);
  pairs.sort((p, q) => p[0] - q[0]);
  const anchors = longestIncreasing(pairs);
  if (!anchors.length) {
    out.push([1, a0, b0, a1 - a0], [2, a1, b0, b1 - b0]);
    return;
  }
  let pa = a0;
  let pb = b0;
  for (const [i, j] of anchors) {
    diffRange(A, pa, i, B, pb, j, out);
    out.push([0, i, j, 1]);
    pa = i + 1; pb = j + 1;
  }
  diffRange(A, pa, a1, B, pb, b1, out);
}

// Longest run of pairs whose second index rises (pairs sorted by the first).
function longestIncreasing(pairs) {
  const tails = [];
  const prev = new Int32Array(pairs.length);
  for (let n = 0; n < pairs.length; n += 1) {
    const v = pairs[n][1];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < v) lo = mid + 1; else hi = mid;
    }
    prev[n] = lo ? tails[lo - 1] : -1;
    tails[lo] = n;
  }
  const out = [];
  for (let n = tails.length ? tails[tails.length - 1] : -1; n >= 0; n = prev[n]) out.push(pairs[n]);
  return out.reverse();
}

function toHunks(steps) {
  const hunks = [];
  let a = 0;
  let b = 0;
  for (const [kind, , , n] of steps) {
    if (!n) continue;
    const type = kind === 0 ? 'equal' : 'change';
    const last = hunks[hunks.length - 1];
    const h = last && last.type === type ? last : null;
    const na = kind === 2 ? 0 : n;
    const nb = kind === 1 ? 0 : n;
    if (h) { h.a1 += na; h.b1 += nb; } else hunks.push({ type, a0: a, a1: a + na, b0: b, b1: b + nb });
    a += na; b += nb;
  }
  return hunks;
}
