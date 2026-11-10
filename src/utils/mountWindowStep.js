// When a fast finger glide slows, the pages on screen mount together in one
// commit (each with all its marks), and the overscan pages around them follow
// one per frame instead of in that same commit, so the slow tail of the glide
// keeps moving between them.
export function stepMountWindow(prev, target, visible) {
  const [first, last] = target;
  const [vf, vl] = visible;
  if (!(last >= first) || !(vl >= vf)) return target;
  if (!(prev[1] >= prev[0]) || prev[1] < first || prev[0] > last) return [vf, vl];
  let lo = Math.max(prev[0], first);
  let hi = Math.min(prev[1], last);
  if (lo > vf || hi < vl) return [Math.min(lo, vf), Math.max(hi, vl)];
  if (hi < last) hi += 1;
  else if (lo > first) lo -= 1;
  return [lo, hi];
}
