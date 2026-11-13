/**
 * LaserPointerLayer — the Draw group's Laser pointer (Nightly 'laser-pointer',
 * Drawboard PDF Free-form > Laser pointer).
 *
 * While the tool is armed, a press on the page with a pen or mouse (or a
 * finger, where fingers run tools: utils/pencilMode.js) draws a glowing red
 * line that follows the pointer and fades away soon after you let go. It is
 * drawn in screen space over everything and is never saved or sent, so it
 * leaves no mark and no Undo step. A second finger (pinch) ends the stroke so
 * the page can zoom. The pure rules live in utils/laserTrail.js.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { pointerMayUseTool } from '../utils/pencilMode.js';
import {
  addLaserPoint, laserGone, laserOpacity, laserPath,
  LASER_COLOR, LASER_HEAD_RADIUS, LASER_WIDTH,
} from '../utils/laserTrail.js';

const CONTROL = 'button, input, textarea, select, a[href], [role="menu"], [role="dialog"], [role="toolbar"], [contenteditable="true"]';

// A small red dot for the cursor, so the pointer reads as a laser at once.
const LASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><circle cx='8' cy='8' r='5' fill='${LASER_COLOR}' stroke='white' stroke-width='1.5'/></svg>`,
)}") 8 8, crosshair`;

export default function LaserPointerLayer({ active, hostRef }) {
  const [strokes, setStrokes] = useState([]);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const liveRef = useRef(null); // { id, pointerId }
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (!active) return undefined;
    const host = hostRef?.current;
    if (!host) return undefined;
    const previousCursor = host.style.cursor;
    host.style.cursor = LASER_CURSOR;
    host.setAttribute('data-laser-pointer', 'true');
    let seq = 0;
    const touchIds = new Set();

    const endLive = () => {
      const live = liveRef.current;
      if (!live) return;
      liveRef.current = null;
      const endedAt = performance.now();
      setStrokes((list) => list.map((s) => (s.id === live.id ? { ...s, endedAt } : s)));
    };
    const onDown = (event) => {
      if (event.pointerType === 'touch') touchIds.add(event.pointerId);
      if (touchIds.size > 1) { endLive(); return; } // pinch: let the page zoom
      if (event.button !== 0 || !pointerMayUseTool(event.pointerType)) return;
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      if (target?.closest?.(CONTROL)) return;
      event.preventDefault();
      event.stopPropagation();
      endLive();
      seq += 1;
      const id = `laser-${Date.now()}-${seq}`;
      liveRef.current = { id, pointerId: event.pointerId };
      setStrokes((list) => [...list, { id, points: addLaserPoint([], event.clientX, event.clientY), endedAt: null }]);
    };
    const onMove = (event) => {
      const live = liveRef.current;
      if (!live || live.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
      const list = samples.length ? samples : [event];
      setStrokes((all) => all.map((s) => {
        if (s.id !== live.id) return s;
        let points = s.points;
        list.forEach((e) => { points = addLaserPoint(points, e.clientX, e.clientY); });
        return points === s.points ? s : { ...s, points };
      }));
    };
    const onUp = (event) => {
      if (event.pointerType === 'touch') touchIds.delete(event.pointerId);
      const live = liveRef.current;
      if (!live || live.pointerId !== event.pointerId) return;
      event.stopPropagation();
      endLive();
    };
    // Capture on the page host, so the page's own tool layers never see a
    // laser press (no selection box, no pan, no mark).
    host.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      host.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      host.style.cursor = previousCursor;
      host.removeAttribute('data-laser-pointer');
      liveRef.current = null;
    };
  }, [active, hostRef]);

  // Fade clock: runs only while something is on screen.
  useEffect(() => {
    if (!strokes.length) return undefined;
    let frame = requestAnimationFrame(function tick() {
      const t = performance.now();
      setNow(t);
      if (strokesRef.current.some((s) => laserGone(s.endedAt, t))) {
        setStrokes((list) => list.filter((s) => !laserGone(s.endedAt, t)));
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [strokes.length]);

  // Turning the tool off clears the screen at once.
  useEffect(() => { if (!active) setStrokes([]); }, [active]);

  if (!strokes.length || typeof document === 'undefined') return null;
  return createPortal(
    <svg
      data-laser-layer="true"
      aria-hidden="true"
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 2147483000, overflow: 'visible' }}
    >
      <defs>
        <filter id="survey-laser-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {strokes.map((stroke) => {
        const opacity = laserOpacity(stroke.endedAt, now);
        const head = stroke.points[stroke.points.length - 1];
        return (
          <g key={stroke.id} opacity={opacity} filter="url(#survey-laser-glow)">
            <path d={laserPath(stroke.points)} fill="none" stroke={LASER_COLOR} strokeWidth={LASER_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
            {head && <circle cx={head.x} cy={head.y} r={LASER_HEAD_RADIUS} fill={LASER_COLOR} />}
          </g>
        );
      })}
    </svg>,
    document.body,
  );
}
