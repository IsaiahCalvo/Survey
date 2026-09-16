/**
 * multiTouchTapGate — the pointer bookkeeping behind "was this gesture a tap?".
 *
 * It answers two questions for the window-level double-tap edit recogniser in
 * PDFViewer, and it is a module of its own so both can be driven finger by
 * finger in tests (tests/doubleTapMultiTouchGuard.test.mjs):
 *
 *   1. WHICH point did THIS pointer start from — one record per pointerId, so a
 *      lift is always measured against its own press. A single shared slot let
 *      a second finger overwrite the first, and a pinch whose fingers started
 *      within the touch slop was filed as a tap (fixed 2026-09-15).
 *   2. IS the gesture disqualified — a bail that latches the moment more than
 *      one pointer is down and STAYS latched until every finger is up. The
 *      earlier version cleared its records when it latched, so the first lift
 *      read as "all fingers up" and unlatched the bail while a finger was still
 *      resting on the glass: a third finger tapping mid-pinch then started a
 *      fresh tap candidate, and two of those opened an editor nobody asked for.
 *
 * Intended UX: a pinch is a zoom and nothing else. It leaves nothing behind for
 * the next tap to pair with, whatever the fingers do and in whatever order they
 * lift.
 */

/**
 * @returns {{
 *   size: number,
 *   bailed: boolean,
 *   press: (pointerId: number|string, point: {x:number,y:number}) => number,
 *   bail: () => void,
 *   lift: (pointerId: number|string|null) => {start: {x:number,y:number}|null, bailed: boolean},
 * }}
 */
export function createMultiTouchTapGate() {
  /** pointerId -> where that pointer went down. */
  const downPoints = new Map();
  let bailed = false;

  return {
    /** How many pointers are down right now. */
    get size() { return downPoints.size; },
    /** Whether this gesture has been disqualified as a tap. */
    get bailed() { return bailed; },

    /** Record a pointerdown. Returns the new live-pointer count. */
    press(pointerId, point) {
      downPoints.set(pointerId, point);
      return downPoints.size;
    },

    /** Disqualify the gesture until every pointer has lifted. */
    bail() { bailed = true; },

    /**
     * Record a pointerup / pointercancel. Pass null to drop every pointer (a
     * cancel with no id).
     *
     * @returns {{start: {x:number,y:number}|null, bailed: boolean}} the point
     *   THIS pointer went down at, and whether the gesture was disqualified —
     *   read before the latch is released, so the last finger of a pinch is
     *   reported as bailed too.
     */
    lift(pointerId) {
      const start = pointerId == null ? null : (downPoints.get(pointerId) || null);
      if (pointerId == null) downPoints.clear();
      else downPoints.delete(pointerId);
      const wasBailed = bailed;
      if (downPoints.size === 0) bailed = false;
      return { start, bailed: wasBailed };
    },
  };
}
