/* Photo markup (flag `project-photos`, Drawboard Projects AE-34): Pen, Text,
   Arrow and Select, line widths 2 / 4 / 8, red / blue / black, Clear all,
   Save markup and Cancel, the same set and order as Drawboard's editor.

   Marks are kept in image pixels while you work and baked into one PNG on
   Save, drawn at the photo's own size, so the saved copy is as sharp as the
   photo. The original file is never changed (projectPhotosData.saveMarkup
   writes a separate marked copy). Survey extras: Ctrl+Z undoes the last
   mark, Delete removes the picked mark, and a drag in Select moves it. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTooltip } from '../components/Tooltip';
import { Icon } from '../home/HubShell';
import {
  MARKUP_COLOURS, MARKUP_WIDTHS, PICK_OUTLINE, arrowHead, hitMark, markBounds, moveMark, strokeScale,
} from './projectPhotos.js';

const TOOL_LIST = [
  { key: 'pen', label: 'Pen', icon: 'pen' },
  { key: 'text', label: 'Text', icon: 'text' },
  { key: 'arrow', label: 'Arrow', icon: 'arrow' },
  { key: 'select', label: 'Select', icon: 'selectCursor' },
];
const TEXT_SIZE = { 2: 18, 4: 24, 8: 36 };

function drawMark(ctx, mark, scale, picked) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = mark.colour;
  ctx.fillStyle = mark.colour;
  const w = mark.width * scale;
  if (mark.kind === 'pen') {
    const pts = mark.points || [];
    ctx.lineWidth = w;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale)));
    if (pts.length === 1) ctx.lineTo(pts[0][0] * scale + 0.01, pts[0][1] * scale);
    ctx.stroke();
  } else if (mark.kind === 'arrow') {
    ctx.lineWidth = w;
    const head = arrowHead(mark.x1, mark.y1, mark.x2, mark.y2, mark.width);
    // The shaft stops at the head's base so a thick line doesn't poke through.
    const bx = (head[1][0] + head[2][0]) / 2;
    const by = (head[1][1] + head[2][1]) / 2;
    ctx.beginPath();
    ctx.moveTo(mark.x1 * scale, mark.y1 * scale);
    ctx.lineTo(bx * scale, by * scale);
    ctx.stroke();
    ctx.beginPath();
    head.forEach(([x, y], i) => (i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale)));
    ctx.closePath();
    ctx.fill();
  } else if (mark.kind === 'text') {
    const size = mark.size * scale;
    ctx.font = `600 ${size}px Helvetica`;
    ctx.textBaseline = 'top';
    String(mark.text || '').split('\n').forEach((line, i) => ctx.fillText(line, mark.x * scale, mark.y * scale + i * size * 1.25));
  }
  if (picked) {
    const b = markBounds(mark);
    if (b) {
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = PICK_OUTLINE;
      ctx.strokeRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale);
    }
  }
  ctx.restore();
}

/** Bake the photo and its marks into a PNG at the photo's own size. */
export async function renderMarkedPng(image, marks) {
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, w, h);
  for (const m of marks) drawMark(ctx, m, 1, false);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the markup.'))), 'image/png'));
}

export default function PhotoMarkupEditor({ src, onSave, onCancel, busy = false }) {
  const tip = useTooltip();
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [tool, setTool] = useState('pen');
  const [width, setWidth] = useState(4);
  const [colour, setColour] = useState(MARKUP_COLOURS[0].value);
  const [marks, setMarks] = useState([]);
  const [history, setHistory] = useState([]);
  const [picked, setPicked] = useState(-1);
  const [draft, setDraft] = useState(null); // mark being drawn
  const [textAt, setTextAt] = useState(null); // { x, y } image px while typing
  const [textValue, setTextValue] = useState('');
  const [view, setView] = useState({ scale: 1, w: 0, h: 0 });
  const dragRef = useRef(null);

  useEffect(() => {
    setReady(false); setLoadError(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imageRef.current = img; setReady(true); };
    img.onerror = () => setLoadError('This photo could not be opened for markup.');
    img.src = src;
    return () => { img.onload = null; img.onerror = null; };
  }, [src]);

  // Fit the photo in the space the card gives it.
  useLayoutEffect(() => {
    if (!ready) return undefined;
    const fit = () => {
      const img = imageRef.current;
      const wrap = wrapRef.current;
      if (!img || !wrap) return;
      const maxW = Math.max(120, wrap.clientWidth);
      const maxH = Math.max(120, wrap.clientHeight);
      const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1.5);
      setView({ scale, w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });
    };
    fit();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    ro?.observe(wrapRef.current);
    return () => ro?.disconnect();
  }, [ready]);

  const imgScale = imageRef.current ? strokeScale(imageRef.current.naturalWidth, imageRef.current.naturalHeight) : 1;

  // Draw: photo, then marks, then the mark in progress.
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !view.w) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(view.w * dpr);
    canvas.height = Math.round(view.h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.drawImage(img, 0, 0, view.w, view.h);
    marks.forEach((m, i) => drawMark(ctx, m, view.scale, tool === 'select' && i === picked));
    if (draft) drawMark(ctx, draft, view.scale, false);
  }, [marks, draft, view, picked, tool]);

  const commit = useCallback((next) => {
    setHistory((h) => [...h.slice(-49), marks]);
    setMarks(next);
  }, [marks]);

  const toImage = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return [(e.clientX - r.left) / view.scale, (e.clientY - r.top) / view.scale];
  };

  const finishText = useCallback(() => {
    if (textAt && textValue.trim()) {
      commit([...marks, { kind: 'text', x: textAt.x, y: textAt.y, text: textValue.replace(/\s+$/, ''), colour, width, size: TEXT_SIZE[width] * imgScale }]);
    }
    setTextAt(null);
    setTextValue('');
  }, [colour, commit, imgScale, marks, textAt, textValue, width]);

  const onPointerDown = (e) => {
    if (busy || !ready || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const [x, y] = toImage(e);
    if (textAt) { finishText(); return; }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const w = width * imgScale;
    if (tool === 'pen') setDraft({ kind: 'pen', points: [[x, y]], colour, width: w });
    else if (tool === 'arrow') setDraft({ kind: 'arrow', x1: x, y1: y, x2: x, y2: y, colour, width: w });
    else if (tool === 'text') { setTextAt({ x, y }); setTextValue(''); }
    else if (tool === 'select') {
      const hit = hitMark(marks, x, y);
      setPicked(hit);
      if (hit >= 0) dragRef.current = { index: hit, x, y, start: marks[hit], moved: false };
    }
  };

  const onPointerMove = (e) => {
    if (!ready) return;
    const [x, y] = toImage(e);
    if (draft?.kind === 'pen') {
      const last = draft.points[draft.points.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) * view.scale >= 1) setDraft({ ...draft, points: [...draft.points, [x, y]] });
    } else if (draft?.kind === 'arrow') {
      setDraft({ ...draft, x2: x, y2: y });
    } else if (dragRef.current) {
      const d = dragRef.current;
      d.moved = true;
      const moved = moveMark(d.start, x - d.x, y - d.y);
      setMarks((cur) => cur.map((m, i) => (i === d.index ? moved : m)));
    }
  };

  const onPointerUp = () => {
    if (draft) {
      const keep = draft.kind === 'pen' || Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) * view.scale > 4;
      if (keep) commit([...marks, draft]);
      setDraft(null);
    }
    if (dragRef.current) {
      const d = dragRef.current;
      dragRef.current = null;
      if (d.moved) setHistory((h) => [...h.slice(-49), marks.map((m, i) => (i === d.index ? d.start : m))]);
    }
  };

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      setMarks(h[h.length - 1]);
      setPicked(-1);
      return h.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (textAt) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && tool === 'select' && picked >= 0) {
        e.preventDefault();
        commit(marks.filter((_, i) => i !== picked));
        setPicked(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit, marks, picked, textAt, tool, undo]);

  const save = async () => {
    if (!imageRef.current || busy) return;
    if (textAt) finishText();
    const blob = await renderMarkedPng(imageRef.current, marks);
    onSave?.(blob);
  };

  const cursor = tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';
  return (
    <div className="photo-markup" data-photo-markup>
      <div className="photo-markup-bar" role="toolbar" aria-label="Photo markup">
        <div className="photo-markup-group">
          {TOOL_LIST.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`photo-markup-tool${tool === t.key ? ' is-on' : ''}`}
              aria-pressed={tool === t.key}
              data-photo-tool={t.key}
              onClick={() => { if (textAt) finishText(); setTool(t.key); if (t.key !== 'select') setPicked(-1); }}
            >
              <Icon name={t.icon} size={13} />{t.label}
            </button>
          ))}
        </div>
        <div className="photo-markup-group">
          {MARKUP_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              className={`photo-markup-swatch${width === w ? ' is-on' : ''}`}
              aria-label={`Line width ${w}`}
              aria-pressed={width === w}
              data-photo-width={w}
              onClick={() => setWidth(w)}
              {...tip(`Width ${w}`, 'below')}
            >
              <span className="photo-markup-width" style={{ height: Math.max(2, w * 0.75) }} />
            </button>
          ))}
          {MARKUP_COLOURS.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`photo-markup-swatch${colour === c.value ? ' is-on' : ''}`}
              aria-label={c.label}
              aria-pressed={colour === c.value}
              data-photo-colour={c.key}
              onClick={() => setColour(c.value)}
              {...tip(c.label, 'below')}
            >
              <span className="photo-markup-dot" style={{ background: c.value }} />
            </button>
          ))}
          <button
            type="button"
            className="photo-markup-swatch"
            aria-label="Clear all"
            data-photo-clear
            disabled={!marks.length}
            onClick={() => { commit([]); setPicked(-1); }}
            {...tip('Clear all', 'below')}
          >
            <Icon name="rotateCcw" size={13} />
          </button>
        </div>
      </div>
      <div ref={wrapRef} className="photo-markup-stage">
        {loadError ? <div className="photo-empty-note">{loadError}</div> : !ready ? <div className="photo-empty-note">Opening photo…</div> : (
          <div className="photo-markup-canvas-wrap" style={{ width: view.w, height: view.h }}>
            <canvas
              ref={canvasRef}
              data-photo-canvas
              style={{ width: view.w, height: view.h, cursor, touchAction: 'none', display: 'block' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            {textAt && (
              <textarea
                className="photo-markup-text"
                data-photo-text-input
                autoFocus
                aria-label="Text on photo"
                value={textValue}
                rows={Math.max(1, textValue.split('\n').length)}
                style={{
                  left: textAt.x * view.scale,
                  top: textAt.y * view.scale,
                  color: colour,
                  fontSize: TEXT_SIZE[width] * imgScale * view.scale,
                }}
                onChange={(e) => setTextValue(e.target.value)}
                onBlur={finishText}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishText(); }
                  if (e.key === 'Escape') { e.preventDefault(); setTextAt(null); setTextValue(''); }
                }}
              />
            )}
          </div>
        )}
      </div>
      <div className="photo-markup-actions">
        <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" data-photo-save disabled={busy || !ready || (!marks.length && !textValue.trim())} onClick={save}>
          {busy ? 'Saving…' : 'Save markup'}
        </button>
        <button type="button" className="hub-btn dialog-touch-pad" data-photo-cancel disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
