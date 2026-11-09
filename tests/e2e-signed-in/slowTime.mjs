// Shared by the specs that capture a move frame by frame (search-hit-glide,
// survey-locate-marker).
//
// Slow motion for the frame capture: the cloud test machine draws a heavy
// drawing at a few frames a second, too few to see a 400 ms move. Time in the
// page (performance.now, animation-frame time stamps and timer delays) runs
// at `scale` while a jump is captured, so the move spans many real frames.
export const SLOW_TIME_SCRIPT = () => {
  const realNow = performance.now.bind(performance);
  let scale = 1;
  let baseReal = 0;
  let baseVirtual = 0;
  const virtualNow = () => baseVirtual + (realNow() - baseReal) * scale;
  window.__setTimeScale = (next) => {
    baseVirtual = virtualNow();
    baseReal = realNow();
    scale = next;
  };
  performance.now = virtualNow;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => raf(() => callback(virtualNow()));
  const timeout = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms, ...args) => timeout(fn, (Number(ms) || 0) / scale, ...args);
};
// Page time runs at this share of real time while a move is captured.
export const SLOW = 0.04;
