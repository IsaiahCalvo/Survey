// Open speed (round 5): "the viewer has drawn a page of the open PDF". The
// annotation open waits on it (bounded) before its heavy shadow-copy work, so
// a reopen shows its first page before that work instead of after it.
// reset() starts a new load; anyone already waiting keeps waiting for it.
export function createPageDrawnSignal() {
  let drawn = false;
  let waiters = [];
  return {
    reset() {
      drawn = false;
    },
    markDrawn() {
      if (drawn) return;
      drawn = true;
      const ready = waiters;
      waiters = [];
      for (const resolve of ready) resolve();
    },
    whenDrawn() {
      return drawn ? Promise.resolve() : new Promise((resolve) => { waiters.push(resolve); });
    },
  };
}
