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
 *     turn.claim()   call right before the draw starts: false when a page on
 *                    screen took the turn in the gap between `ready` and now
 *                    (release and ask again - there was no draw yet for
 *                    onPreempt to stop)
 *     turn.release() frees the turn (finished, failed, cancelled or unmounted);
 *                    safe to call more than once, and before the turn starts
 *     turn.continue(resume)  pdf.js's onContinue: runs `resume` next frame,
 *                    or later when this turn is held (see below)
 *   pump()           re-checks the order (call when what is on screen changes
 *                    or when a gesture ends)
 *
 * Kinds (owner 2026-10-06: smooth zoom at every level). request() takes
 * `kind`:
 *   'fill'     the page shows nothing yet,
 *   'sharpen'  the page already shows a softer bitmap,
 *   'prefetch' a page drawn ahead of need (lowest).
 * `isHeld(kind)` says whether that kind must wait right now (the viewer holds
 * sharpen/prefetch while anything moves the page, and every kind while a
 * pinch is live). A held turn does not start, and one already drawing pauses
 * at its next slice: re-drawing pages under a moving finger only stole frames
 * from the gesture (each finished page also re-rendered the whole viewer).
 * They resume, in order, on pump() once the gesture is over. A held draw
 * gives way to a page that has nothing on screen. A prefetch gives way to
 * any other page.
 */

const KIND_RANK = { fill: 0, sharpen: 1, prefetch: 2 };
const kindRank = (kind) => KIND_RANK[kind] ?? 0;

export function comparePageRasterPriority(a, b, { isVisible, focusIndex }, kindA = 'fill', kindB = 'fill') {
  const va = isVisible(a) ? 0 : 1;
  const vb = isVisible(b) ? 0 : 1;
  if (va !== vb) return va - vb;
  const ka = kindRank(kindA);
  const kb = kindRank(kindB);
  if (ka !== kb) return ka - kb;
  const focus = focusIndex();
  const da = Math.abs(a - focus);
  const db = Math.abs(b - focus);
  if (da !== db) return da - db;
  return a - b;
}

const defaultSchedule = (fn) => (typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame(() => fn())
  : setTimeout(fn, 16));

export function createPageRasterQueue({
  isVisible = () => true,
  focusIndex = () => 0,
  isHeld = () => false,
  schedule = defaultSchedule,
} = {}) {
  const waiting = [];
  let active = null;
  const order = { isVisible, focusIndex };
  const held = (kind) => { try { return Boolean(isHeld(kind)); } catch { return false; } };

  const preempt = (turn) => {
    if (turn.preempted) return;
    turn.preempted = true;
    // A draw paused at a slice boundary is stopped where it stands.
    turn.paused = null;
    try { turn.onPreempt?.(); } catch { /* a stop request never throws out */ }
  };

  const pump = () => {
    if (active) {
      if (active.preempted) return;
      const runnable = waiting.filter((t) => !held(t.kind));
      if (!isVisible(active.index) && runnable.some((t) => isVisible(t.index))) {
        preempt(active);
      } else if (held(active.kind) && runnable.some((t) => t.kind === 'fill')) {
        preempt(active);
      } else if (active.kind === 'prefetch' && runnable.some((t) => t.kind !== 'prefetch')) {
        preempt(active);
      } else if (active.paused && !held(active.kind)) {
        const resume = active.paused;
        active.paused = null;
        schedule(resume);
      }
      return;
    }
    if (waiting.length === 0) return;
    let best = -1;
    for (let i = 0; i < waiting.length; i += 1) {
      if (held(waiting[i].kind)) continue;
      if (best < 0 || comparePageRasterPriority(waiting[i].index, waiting[best].index, order, waiting[i].kind, waiting[best].kind) < 0) best = i;
    }
    if (best < 0) return;
    const next = waiting.splice(best, 1)[0];
    active = next;
    next.started = true;
    next.start();
  };

  const request = (index, { onPreempt, kind = 'fill' } = {}) => {
    const turn = {
      index,
      kind: KIND_RANK[kind] === undefined ? 'fill' : kind,
      onPreempt,
      started: false,
      preempted: false,
      released: false,
      claimed: false,
      paused: null,
      start: null,
      // Review 9 / robust 10 item 3: `ready` resolves in pump(), but the page
      // only creates its render task a microtask (or more) later. A page on
      // screen asking in that gap marked this turn preempted and called
      // onPreempt, which had nothing to cancel yet - so the off-screen draw
      // then ran to the end while the page in view waited. claim() lets the
      // holder see that before it starts.
      claim: () => {
        if (turn.released || turn.preempted) return false;
        turn.claimed = true;
        return true;
      },
      // pdf.js onContinue: the next slice of this draw. Held kinds wait for
      // the gesture to end (pump() resumes them); everything else goes on
      // next frame, as before.
      continue: (resume) => {
        if (turn.released || turn.preempted) { schedule(resume); return; }
        if (held(turn.kind)) { turn.paused = resume; return; }
        schedule(resume);
      },
      ready: null,
      release: () => {
        if (turn.released) return;
        turn.released = true;
        turn.paused = null;
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
    get activeKind() { return active ? active.kind : null; },
    get waitingCount() { return waiting.length; },
  };
}
