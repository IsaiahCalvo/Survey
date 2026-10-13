// Hold the clock still while an export builds filled clouds
// (2026-10-04, test-reliability pass).
//
// A FILLED cloud's PDF form carries its stroke band: a polygon union that
// cloudStrokeBandRings (src/utils/cloudAnnotationGeometry.js) runs under a
// 250 ms wall-clock budget, a Date.now() deadline. Past the budget it hands
// back the raw capsules instead ('pieces' mode: the same picture, different
// bytes). Tests that compare two exports BYTE FOR BYTE could therefore see one
// export on each side of the budget on a loaded machine and fail although the
// geometry was identical (cloudFillKnockout: 6 runs in 36 under heavy load;
// textCloudBorder: 1 in 8).
//
// Holding Date.now() still for the export makes both sides take the union
// path, so the comparison is about geometry only. The budget and its fallback
// keep their own coverage: cloudStrokeBandFuzz forces the fallback and checks
// it paints the same pixels, and the release-time budget is measured in the
// perf lane (cloudStrokeBandPathologicalBudget). The exporter's only other
// Date.now() reads are fallback ids, which these comparisons do not look at.
export async function withCloudBandBudgetHeld(run) {
  const realNow = Date.now;
  const heldNow = realNow();
  Date.now = () => heldNow;
  try {
    return await run();
  } finally {
    Date.now = realNow;
  }
}
