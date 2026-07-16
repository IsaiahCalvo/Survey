// ============================================================================
// Performance metrics for the canonical PDF.js feature demo.
// ============================================================================
// One requestAnimationFrame loop measures fps and worst-frame time consistently
// across feature-demo benchmark runs.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';

// Rolling frame-time meter. Returns { fps, worstFrame, heapMB } and a
// `bumpActivity()` you can call on wheel/scroll to mark a "gesture is active"
// window (so worst-frame reflects the gesture, not idle 60fps).
export function useFrameMeter(enabled = true) {
  const [perf, setPerf] = useState({ fps: 0, worstFrame: 0, heapMB: 0 });
  const activeUntilRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      activeUntilRef.current = 0;
      setPerf({ fps: 0, worstFrame: 0, heapMB: 0 });
      return undefined;
    }
    let raf;
    let last = performance.now();
    let worst = 0;
    let windowStart = last;
    let frames = 0;

    const tick = (now) => {
      const dt = now - last;
      last = now;
      frames += 1;
      // Only count toward "worst frame" while a gesture is active — idle frames
      // are a flat 16.7ms and would mask the jank we care about.
      if (now < activeUntilRef.current && dt > worst) worst = dt;

      if (now - windowStart > 500) {
        const fps = Math.round((frames * 1000) / (now - windowStart));
        const heapMB = performance.memory
          ? Math.round(performance.memory.usedJSHeapSize / 1048576)
          : 0;
        setPerf((p) => ({
          fps,
          // decay worst-frame slowly so a single spike stays visible ~1.5s
          worstFrame: now < activeUntilRef.current ? worst : Math.round(p.worstFrame * 0.5),
          heapMB,
        }));
        worst = 0;
        frames = 0;
        windowStart = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  const bumpActivity = useCallback((ms = 600) => {
    activeUntilRef.current = performance.now() + ms;
  }, []);

  return { perf, bumpActivity };
}

// Chromium single-canvas limits: ~32767px/dimension, and a practical "smooth"
// area budget well under the hard cap. Exceeding the area budget is exactly the
// pdf.js-direct "crispness cliff" the spike exists to make visible.
export const MAX_CANVAS_DIM = 16384;
export const MAX_CANVAS_AREA = 80 * 1024 * 1024; // ~80 MP smooth budget

// Given a desired backing size (already * dpr), return a clamp factor <= 1 and
// whether it clamped. factor 1 means it fits; < 1 means we had to shrink the
// raster (and the browser will upscale → visible blur = the cliff).
export function clampToBudget(backingW, backingH) {
  const dimOver = Math.max(backingW, backingH) / MAX_CANVAS_DIM;
  const areaOver = Math.sqrt((backingW * backingH) / MAX_CANVAS_AREA);
  const over = Math.max(dimOver, areaOver, 1);
  return { factor: over > 1 ? 1 / over : 1, clamped: over > 1 };
}
