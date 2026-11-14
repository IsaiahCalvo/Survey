/**
 * RulerLayer — the Draw group's Ruler (Nightly 'ruler-tool', Drawboard PDF
 * Draw > Ruler). A see-through straight edge over the pages, in screen space:
 *   - drag it to move it (pen, mouse or finger: it is a tool on the screen,
 *     not a mark, so a finger on it moves it);
 *   - turn it with two fingers, the round grabber at its right end, or the
 *     mouse wheel over it (Shift turns 15° a step); it settles on 0°, 15°,
 *     30° ... when close; a double click on the angle sets it level;
 *   - a pen or highlighter line started just outside a long edge runs along
 *     that edge (SVGAnnotationLayer reads utils/ruler.js), so it is straight.
 * It is never saved and leaves no Undo step.
 */
import { useEffect, useRef } from 'react';
import Icon from '../Icons';
import { useTooltip } from './Tooltip';
import {
  RULER_WIDTH, readoutAngle, setRulerOn, setRulerPlace, settleAngle, startingPlace, useRulerPlace,
} from '../utils/ruler.js';
import './RulerLayer.css';

const MINOR = 8; // px between small ticks
const MAJOR_EVERY = 5; // every fifth tick is long

function Ticks({ length }) {
  const lines = [];
  for (let i = 1, x = MINOR; x < length - 2; i += 1, x += MINOR) {
    const h = i % MAJOR_EVERY === 0 ? 13 : 7;
    lines.push(`M${x} 0v${h}M${x} ${RULER_WIDTH}v${-h}`);
  }
  return (
    <svg className="survey-ruler__ticks" width={length} height={RULER_WIDTH} aria-hidden="true">
      <path d={lines.join('')} />
    </svg>
  );
}

export default function RulerLayer({ active, hostRef }) {
  const tip = useTooltip();
  const place = useRulerPlace();
  const placeRef = useRef(place);
  placeRef.current = place;
  const bodyRef = useRef(null);

  // First show: across the middle of the viewer.
  useEffect(() => {
    if (!active || placeRef.current) return;
    const rect = hostRef?.current?.getBoundingClientRect?.();
    setRulerPlace(startingPlace(rect));
  }, [active, hostRef]);

  // Wheel turns it (a non-passive listener, so the page does not scroll).
  useEffect(() => {
    const body = bodyRef.current;
    if (!active || !body) return undefined;
    const onWheel = (event) => {
      const current = placeRef.current;
      if (!current) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 15 : 1;
      const turn = (event.deltaY || event.deltaX) > 0 ? step : -step;
      const raw = current.angle + turn;
      setRulerPlace({ ...current, angle: event.shiftKey ? Math.round(raw / 15) * 15 : raw });
    };
    body.addEventListener('wheel', onWheel, { passive: false });
    return () => body.removeEventListener('wheel', onWheel);
  }, [active, Boolean(place)]);

  if (!active || !place) return null;

  const pointers = new Map();
  const startMove = (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    if (target?.closest?.('button, [data-ruler-turn], [data-ruler-readout]')) return;
    event.preventDefault();
    event.stopPropagation();
    const el = event.currentTarget;
    el.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    let last = new Map(pointers);
    const onMove = (e) => {
      if (!pointers.has(e.pointerId)) return;
      e.preventDefault();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const current = placeRef.current;
      if (!current) return;
      const ids = [...pointers.keys()].filter((id) => last.has(id));
      if (ids.length >= 2) {
        // Two fingers: move with their middle, turn with the line between them.
        const [p0, p1] = ids.slice(0, 2).map((id) => pointers.get(id));
        const [q0, q1] = ids.slice(0, 2).map((id) => last.get(id));
        const turn = (Math.atan2(p1.y - p0.y, p1.x - p0.x) - Math.atan2(q1.y - q0.y, q1.x - q0.x)) * 180 / Math.PI;
        setRulerPlace({
          ...current,
          cx: current.cx + ((p0.x + p1.x) - (q0.x + q1.x)) / 2,
          cy: current.cy + ((p0.y + p1.y) - (q0.y + q1.y)) / 2,
          angle: current.angle + turn,
        });
      } else if (ids.length === 1) {
        const p = pointers.get(ids[0]);
        const q = last.get(ids[0]);
        setRulerPlace({ ...current, cx: current.cx + p.x - q.x, cy: current.cy + p.y - q.y });
      }
      last = new Map(pointers);
    };
    const onEnd = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      last = new Map(pointers);
      if (pointers.size > 0) return;
      const current = placeRef.current;
      if (current) setRulerPlace({ ...current, angle: settleAngle(current.angle) });
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onEnd);
      el.removeEventListener('pointercancel', onEnd);
    };
    if (pointers.size === 1) {
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onEnd);
      el.addEventListener('pointercancel', onEnd);
    }
  };

  const startTurn = (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    event.stopPropagation();
    const el = event.currentTarget;
    el.setPointerCapture?.(event.pointerId);
    const onMove = (e) => {
      const current = placeRef.current;
      if (!current) return;
      const angle = Math.atan2(e.clientY - current.cy, e.clientX - current.cx) * 180 / Math.PI;
      setRulerPlace({ ...current, angle });
    };
    const onEnd = () => {
      const current = placeRef.current;
      if (current) setRulerPlace({ ...current, angle: settleAngle(current.angle) });
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onEnd);
      el.removeEventListener('pointercancel', onEnd);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onEnd);
    el.addEventListener('pointercancel', onEnd);
  };

  const level = () => setRulerPlace({ ...place, angle: 0 });

  // Not portalled: it renders in the viewer's own layer, so it sits over the
  // pages and under the viewer's cards and menus.
  return (
    <div
      ref={bodyRef}
      className="survey-ruler"
      data-ruler="true"
      data-ruler-angle={readoutAngle(place.angle)}
      role="group"
      aria-label={`Ruler, ${readoutAngle(place.angle)} degrees`}
      style={{
        width: place.length,
        height: RULER_WIDTH,
        transform: `translate(${place.cx - place.length / 2}px, ${place.cy - RULER_WIDTH / 2}px) rotate(${place.angle}deg)`,
      }}
      onPointerDown={startMove}
    >
      <Ticks length={place.length} />
      <span className="survey-ruler__angle" data-ruler-readout="" onDoubleClick={level}>
        {readoutAngle(place.angle)}°
      </span>
      <button
        type="button"
        className="survey-ruler__close"
        aria-label="Put the ruler away"
        data-ruler-close=""
        {...tip('Put the ruler away', 'below')}
        onClick={() => setRulerOn(false)}
      >
        <Icon name="close" size={14} color="currentColor" />
      </button>
      <span
        className="survey-ruler__turn"
        data-ruler-turn=""
        role="slider"
        tabIndex={0}
        aria-label="Turn the ruler"
        aria-valuemin={0}
        aria-valuemax={179}
        aria-valuenow={readoutAngle(place.angle)}
        {...tip('Drag to turn', 'below')}
        onPointerDown={startTurn}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 15 : 1;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setRulerPlace({ ...place, angle: place.angle + step }); }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setRulerPlace({ ...place, angle: place.angle - step }); }
        }}
      />
    </div>
  );
}
