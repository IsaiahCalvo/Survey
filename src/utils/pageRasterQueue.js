/**
 * pageRasterQueue.js — the order the PDF pages get drawn in.
 *
 * Owner 2026-10-04: "shouldn't the first page load before the second page?"
 * Every mounted page used to start drawing at the same moment, so the page on
 * screen shared the CPU (and the one pdf.js worker) with the pages around it,
 * and a lighter page 2 routinely finished before page 1. Drawing is
 * main-thread and single-worker work, so running pages side by side never
 * made the set faster — it only made the page you are looking at slower.
 *
 * One page draws at a time, picked at each turn:
 *   1. pages on screen before pages kept ready off screen,
 *   2. then the page nearest the current page,
 *   3. then the lower page number.
 * A page off screen that is mid-draw when a page on screen asks for a turn is
 * stopped (it asks again and starts over later), so the page in view never
 * waits behind one you cannot see.
 *
 * createPageRasterQueue({ isVisible(index), focusIndex() }) returns
 *   request(index, { onPreempt }) -> turn
 *     turn.ready     promise that resolves when it is this page's turn
 *     turn.release() frees the turn (finished, failed, cancelled or unmounted);
 *                    safe to call more than once, and before the turn starts
 *   pump()           re-checks the order (call when what is on screen changes)
 */

export function comparePageRasterPriority(a, b, { isVisible, focusIndex }) {
  const va = isVisible(a) ? 0 : 1;
  const vb = isVisible(b) ? 0 : 1;
  if (va !== vb) return va - vb;
  const focus = focusIndex();
  const da = Math.abs(a - focus);
  const db = Math.abs(b - focus);
  if (da !== db) return da - db;
  return a - b;
}

export function createPageRasterQueue({ isVisible = () => true, focusIndex = () => 0 } = {}) {
  const waiting = [];
  let active = null;
  const order = { isVisible, focusIndex };

  const pump = () => {
    if (active) {
      if (!active.preempted && !isVisible(active.index) && waiting.some((t) => isVisible(t.index))) {
        active.preempted = true;
        try { active.onPreempt?.(); } catch { /* a stop request never throws out */ }
      }
      return;
    }
    if (waiting.length === 0) return;
    let best = 0;
    for (let i = 1; i < waiting.length; i += 1) {
      if (comparePageRasterPriority(waiting[i].index, waiting[best].index, order) < 0) best = i;
    }
    const next = waiting.splice(best, 1)[0];
    active = next;
    next.started = true;
    next.start();
  };

  const request = (index, { onPreempt } = {}) => {
    const turn = {
      index,
      onPreempt,
      started: false,
      preempted: false,
      released: false,
      start: null,
      ready: null,
      release: () => {
        if (turn.released) return;
        turn.released = true;
        const at = waiting.indexOf(turn);
        if (at >= 0) waiting.splice(at, 1);
        if (active === turn) active = null;
        pump();
      },
    };
    turn.ready = new Promise((resolve) => { turn.start = resolve; });
    waiting.push(turn);
    pump();
    return turn;
  };

  return {
    request,
    pump,
    get activeIndex() { return active ? active.index : null; },
    get waitingCount() { return waiting.length; },
  };
}
