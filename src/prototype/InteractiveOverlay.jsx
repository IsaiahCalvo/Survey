// ============================================================================
// PROTOTYPE — THROWAWAY. Imported-annotation layer, OWNED (no Syncfusion, no
// baked pixels) — a faithful copy of the real app's import recipe.
// ============================================================================
// The real app does NOT let Syncfusion render imported markups: it reads them
// with pdf-lib and converts each into its own smooth, editable shape (see
// src/utils/pdfAnnotationImporter.js → parseAppearanceStream +
// convertAppearancePathToFabricPath). The SMOOTH geometry lives in each mark's
// APPEARANCE STREAM (/AP /N) as real Bézier curves (PDF `c`/`v`/`y` ops) — NOT
// in the coarse /InkList point list. Tracing the inkList gives jagged polygons;
// parsing the appearance stream gives the true curves the original tool drew.
//
// So per markup we: read /AP /N, decode + parse its path operators into M/L/C/Z
// commands (the app's parser), map each coord through the pdf.js scale:1 rotated
// viewport (rotation-correct), and render a FILLED path (the dots/strokes are
// filled outlines at their real /CA opacity) — falling back to a smoothed
// /InkList only when no appearance exists. Authored in UNSCALED page space
// (viewBox="0 0 W H", preserveAspectRatio="none") so they stay pinned through any
// zoom/rotation with zero JS zoom math, and — because we draw them ourselves —
// each is a first-class object: selectable + movable.
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { PDFName, PDFArray, PDFDict, decodePDFRawStream } from 'pdf-lib';

const asArr = (v) => (v instanceof PDFArray ? v : null);
const asDict = (v) => (v instanceof PDFDict ? v : null);
const num = (v) => (v && typeof v.asNumber === 'function' ? v.asNumber() : null);
const r2 = (n) => Math.round(n * 100) / 100;

// --- parse a PDF appearance content stream into M/L/C/Z commands --------------
// Trimmed copy of the app's parseAppearanceStream — enough for ink/shape marks:
// path-building ops (m l c v y re h) + paint detection (f/F/f*/B/b/S → fill?).
function parseApStream(content) {
  const tokens = content.split(/\s+/).filter(Boolean);
  const ops = [];
  const path = [];
  let cur = null, hasFill = false, lineWidth = null;
  const take = (n) => {
    if (ops.length < n) return null;
    const raw = ops.slice(-n);
    if (!raw.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    ops.length -= n;
    return raw;
  };
  const close = () => { if (path.length && path[path.length - 1][0] !== 'Z') path.push(['Z']); };
  for (const t of tokens) {
    const n = Number(t);
    if (!Number.isNaN(n) && Number.isFinite(n)) { ops.push(n); continue; }
    if (t.startsWith('/')) { ops.push(t); continue; }
    switch (t) {
      case 'm': { const v = take(2); if (v) { path.push(['M', v[0], v[1]]); cur = { x: v[0], y: v[1] }; } break; }
      case 'l': { const v = take(2); if (v) { path.push(['L', v[0], v[1]]); cur = { x: v[0], y: v[1] }; } break; }
      case 'c': { const v = take(6); if (v) { path.push(['C', v[0], v[1], v[2], v[3], v[4], v[5]]); cur = { x: v[4], y: v[5] }; } break; }
      case 'v': { const v = take(4); if (v && cur) { path.push(['C', cur.x, cur.y, v[0], v[1], v[2], v[3]]); cur = { x: v[2], y: v[3] }; } break; }
      case 'y': { const v = take(4); if (v) { path.push(['C', v[0], v[1], v[2], v[3], v[2], v[3]]); cur = { x: v[2], y: v[3] }; } break; }
      case 're': { const v = take(4); if (v) { const [x, y, w, h] = v; path.push(['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']); cur = { x, y }; } break; }
      case 'h': case 's': case 'b': case 'b*': close(); if (t !== 'h') { /* paint below */ } break;
      case 'f': case 'F': case 'f*': case 'B': case 'B*': hasFill = true; break;
      case 'w': { const v = take(1); if (v) lineWidth = v[0]; break; }
      case 'q': case 'Q': ops.length = 0; break;
      default: ops.length = 0; break;
    }
    if (t === 'b' || t === 'b*' || t === 'B' || t === 'B*') hasFill = true;
  }
  return path.length ? { path, hasFill, lineWidth } : null;
}

// --- read the page's markups into editable, display-space path objects --------
export function extractInkAnnotations(pdfLibPage, viewport, ctx) {
  const annots = asArr(pdfLibPage?.node?.lookup?.(PDFName.of('Annots')));
  if (!annots) return [];
  const out = [];
  const mapPt = (x, y) => { const [vx, vy] = viewport.convertToViewportPoint(x, y); return [vx, vy]; };
  const mapCmds = (cmds) => cmds.map((c) => {
    if (c[0] === 'Z') return c;
    const o = [c[0]];
    for (let i = 1; i + 1 < c.length; i += 2) { const [x, y] = mapPt(c[i], c[i + 1]); o.push(x, y); }
    return o;
  });
  const colorRgb = (C) => (C && C.size() >= 3
    ? `${Math.round(num(C.lookup(0)) * 255)},${Math.round(num(C.lookup(1)) * 255)},${Math.round(num(C.lookup(2)) * 255)}`
    : '255,45,85');

  const apCommands = (a) => {
    try {
      const ap = a.lookup(PDFName.of('AP')); const apD = ap && asDict(ctx.lookup(ap));
      const N = apD && apD.lookup(PDFName.of('N')); const stream = N && ctx.lookup(N);
      if (!stream) return null;
      const bytes = decodePDFRawStream(stream).decode();
      let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return parseApStream(s);
    } catch { return null; }
  };

  // markup subtypes we redraw faithfully (Widget/Link/Popup are handled elsewhere)
  const MARKUP = new Set(['/Ink', '/Square', '/Circle', '/Polygon', '/PolyLine', '/Line', '/Underline', '/StrikeOut', '/Squiggly', '/Highlight']);
  // Highlight geometry = the QuadPoints text rectangles (its appearance often points to
  // a shared stamp XObject we can't follow). Each region is 8 numbers (4 corners).
  const quadCmds = (a) => {
    const QP = asArr(a.lookup(PDFName.of('QuadPoints')));
    if (!QP || QP.size() < 8) return null;
    const cmds = [];
    for (let r = 0; r + 7 < QP.size(); r += 8) {
      const pts = [];
      for (let k = 0; k < 8; k += 2) pts.push(mapPt(num(QP.lookup(r + k)), num(QP.lookup(r + k + 1))));
      const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs); const y0 = Math.min(...ys); const x1 = Math.max(...xs); const y1 = Math.max(...ys);
      cmds.push(['M', x0, y0], ['L', x1, y0], ['L', x1, y1], ['L', x0, y1], ['Z']);
    }
    return cmds.length ? cmds : null;
  };

  // Vertices = flat [x1,y1,x2,y2,…]; close it for Polygon, leave open for PolyLine/Line.
  const vertexCmds = (a, close) => {
    const V = asArr(a.lookup(PDFName.of('Vertices')));
    if (!V || V.size() < 4) return null;
    const cmds = [];
    for (let k = 0; k + 1 < V.size(); k += 2) {
      const [x, y] = mapPt(num(V.lookup(k)), num(V.lookup(k + 1)));
      cmds.push([k === 0 ? 'M' : 'L', x, y]);
    }
    if (close && cmds.length) cmds.push(['Z']);
    return cmds.length > 1 ? cmds : null;
  };

  for (let i = 0; i < annots.size(); i++) {
    const a = asDict(annots.lookup(i));
    if (!a) continue;
    const sub = a.lookup(PDFName.of('Subtype'))?.toString?.();
    if (!MARKUP.has(sub)) continue;

    // Honor the annotation's OWN colors + opacities, like the app's importer:
    // /C = stroke/border, /IC = interior fill; /CA = stroke opacity, /ca|/FillOpacity = fill opacity.
    const strokeC = asArr(a.lookup(PDFName.of('C')));
    const fillC = asArr(a.lookup(PDFName.of('IC')));
    const CA = num(a.lookup(PDFName.of('CA')));
    const strokeOp = CA == null ? 1 : CA;
    let fillOp = num(a.lookup(PDFName.of('ca')));
    if (fillOp == null) fillOp = num(a.lookup(PDFName.of('FillOpacity')));
    if (fillOp == null) fillOp = strokeOp;
    const BS = asDict(a.lookup(PDFName.of('BS')));
    const bw = BS ? num(BS.lookup(PDFName.of('W'))) : null;

    // Geometry: prefer the real appearance-stream path (cloud bumps, squiggle waves,
    // smooth ink) — the exact artwork. Fall back to Vertices / InkList / Rect.
    let cmds = null;
    const ap = apCommands(a);
    // line width: the annotation's /BS/W, else the width the appearance draws with.
    const strokeWidth = bw != null ? Math.max(0, bw) : (ap && ap.lineWidth != null ? ap.lineWidth : 1);

    // A PolyLine/Line is an OPEN multi-segment line. Some tools wrongly paint its
    // appearance with a fill op (B), which would blob it closed — so we always draw
    // these from their vertices as a plain open stroke, ignoring that.
    const isOpenLine = sub === '/PolyLine' || sub === '/Line';

    // Only true shapes use the interior color (/IC); pen/ink carry a junk black /IC
    // that must NOT be used as a fill (that turned red writing black + dots gray).
    const FILLABLE_SHAPE = new Set(['/Square', '/Circle', '/Polygon']);

    // Paint:
    //  • open line → stroke only
    //  • Square/Circle/Polygon with a real /IC and a visible fill opacity → border + translucent fill
    //  • appearance paints a fill (ink dots, markup bars) → fill with the mark's OWN color (/C) at /CA
    //  • otherwise stroke-only — pen writing, text-markup lines
    const LINE_MARKUP = sub === '/Underline' || sub === '/StrikeOut' || sub === '/Squiggly';
    let stroke = null;
    let fill = null;
    if (sub === '/Highlight') {
      // translucent fill over the text so it reads through (Acrobat ~0.4)
      fill = `rgba(${colorRgb(strokeC)},${CA != null ? CA : 0.4})`;
    } else if (LINE_MARKUP) {
      // underline / strikeout / squiggly are thin lines → STROKE (filling a line draws nothing)
      stroke = strokeC ? `rgba(${colorRgb(strokeC)},${strokeOp})` : null;
    } else if (isOpenLine) {
      stroke = strokeC ? `rgba(${colorRgb(strokeC)},${strokeOp})` : null;
    } else if (FILLABLE_SHAPE.has(sub)) {
      stroke = strokeWidth > 0 ? `rgba(${colorRgb(strokeC)},${strokeOp})` : null;
      if (fillC && fillOp > 0) fill = `rgba(${colorRgb(fillC)},${fillOp})`;
    } else if (ap && ap.hasFill) {
      // ink dots / pen strokes paint as a FILLED outline — fill only, no extra stroke
      // (adding a stroke doubled the pen up and made it thicker).
      fill = `rgba(${colorRgb(strokeC)},${strokeOp})`;
    } else {
      stroke = strokeC ? `rgba(${colorRgb(strokeC)},${strokeOp})` : null;
    }

    if (sub === '/Highlight') {
      cmds = quadCmds(a);
    } else if (isOpenLine) {
      cmds = vertexCmds(a, false) || (ap && ap.path.length ? mapCmds(ap.path) : null);
    } else if (ap && ap.path.length) {
      cmds = mapCmds(ap.path);
    } else if (sub === '/Polygon') {
      cmds = vertexCmds(a, true);
    } else if (sub === '/Ink') {
      const inkList = asArr(a.lookup(PDFName.of('InkList')));
      const paths = [];
      if (inkList) {
        for (let j = 0; j < inkList.size(); j++) {
          const seg = asArr(inkList.lookup(j)); if (!seg) continue;
          const pts = [];
          for (let k = 0; k + 1 < seg.size(); k += 2) { const x = num(seg.lookup(k)), y = num(seg.lookup(k + 1)); if (x != null && y != null) pts.push(mapPt(x, y)); }
          if (pts.length > 1) paths.push(pts);
        }
      }
      cmds = paths.length ? inkPathsToCmds(paths) : null;
    } else if (sub === '/Square' || sub === '/Circle') {
      const R = asArr(a.lookup(PDFName.of('Rect')));
      if (R && R.size() >= 4) {
        const [x1, y1] = mapPt(num(R.lookup(0)), num(R.lookup(1)));
        const [x2, y2] = mapPt(num(R.lookup(2)), num(R.lookup(3)));
        const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
        cmds = [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
      }
    }
    if (!cmds || !cmds.length) continue;
    // Text markups (underline/strikeout/squiggly/highlight) are anchored to text — they
    // should be selectable + deletable but NOT draggable.
    const TEXT_MARKUP = new Set(['/Underline', '/StrikeOut', '/Squiggly', '/Highlight']);
    out.push({ id: `${sub.slice(1)}${i}`, type: 'mark', cmds, stroke, fill, strokeWidth: strokeWidth > 0 ? strokeWidth : 1, noDrag: TEXT_MARKUP.has(sub) });
  }
  return out;
}

// /InkList fallback → smoothed M/Q/L commands (quadratic through midpoints).
function inkPathsToCmds(paths) {
  const cmds = [];
  for (const pts of paths) {
    if (!pts || !pts.length) continue;
    cmds.push(['M', pts[0][0], pts[0][1]]);
    if (pts.length === 2) { cmds.push(['L', pts[1][0], pts[1][1]]); continue; }
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      cmds.push(['Q', pts[i][0], pts[i][1], mx, my]);
    }
    cmds.push(['L', pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  }
  return cmds;
}

// --- generic command-array helpers (work for M/L/Q/C/Z) -----------------------
function buildD(cmds) {
  return cmds.map((c) => (c[0] === 'Z' ? 'Z' : c[0] + c.slice(1).map(r2).join(' '))).join(' ');
}
function translateCmds(cmds, dx, dy) {
  return cmds.map((c) => {
    if (c[0] === 'Z') return c;
    const o = [c[0]];
    for (let i = 1; i + 1 < c.length; i += 2) o.push(c[i] + dx, c[i + 1] + dy);
    return o;
  });
}
function bboxCmds(cmds) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cmds) for (let i = 1; i + 1 < c.length; i += 2) { x0 = Math.min(x0, c[i]); y0 = Math.min(y0, c[i + 1]); x1 = Math.max(x1, c[i]); y1 = Math.max(y1, c[i + 1]); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export default function InteractiveOverlay({ pageWidth, pageHeight, annotations, interactive, onChange }) {
  const svgRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const dragRef = useRef(null);
  const teardownRef = useRef(null);

  useEffect(() => () => { teardownRef.current?.(); }, []);
  useEffect(() => { if (!interactive) setSelected(null); }, [interactive]);

  // Delete / Backspace removes the selected mark.
  useEffect(() => {
    if (!interactive) return undefined;
    const onKey = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        onChange(annotations.filter((s) => s.id !== selected));
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [interactive, selected, annotations, onChange]);

  if (!pageWidth || !pageHeight || !annotations) return null;

  const pageDelta = (dxClient, dyClient) => {
    const rect = svgRef.current.getBoundingClientRect();
    return { dx: (dxClient / rect.width) * pageWidth, dy: (dyClient / rect.height) * pageHeight };
  };

  const onMarkPointerDown = (e, a) => {
    if (!interactive) return;
    e.stopPropagation();
    setSelected(a.id);
    // Text markups (anchored to text) select-only — no dragging.
    if (a.noDrag) return;
    dragRef.current = { id: a.id, startX: e.clientX, startY: e.clientY, original: a };
    const move = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const { dx, dy } = pageDelta(ev.clientX - d.startX, ev.clientY - d.startY);
      onChange(annotations.map((s) => (s.id === d.id ? { ...d.original, cmds: translateCmds(d.original.cmds, dx, dy) } : s)));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      teardownRef.current = null;
    };
    teardownRef.current = up;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const renderMark = (a) => {
    const d = buildD(a.cmds);
    const evt = interactive ? { onPointerDown: (e) => onMarkPointerDown(e, a) } : {};
    const cursor = interactive ? 'grab' : 'default';
    // New shape carries separate stroke + fill; legacy stress shapes use filled/paint.
    const fill = a.fill ?? (a.filled ? a.paint : 'none');
    const stroke = a.stroke ?? (a.filled ? 'none' : a.paint);
    const hasFill = fill && fill !== 'none';
    return (
      <path
        key={a.id}
        d={d}
        fill={hasFill ? fill : 'none'}
        fillRule="nonzero"
        stroke={stroke || 'none'}
        strokeWidth={a.strokeWidth ?? 0.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...evt}
        style={{ cursor, pointerEvents: interactive ? (hasFill ? 'all' : 'stroke') : 'none' }}
      />
    );
  };

  const selAnn = interactive ? annotations.find((a) => a.id === selected) : null;
  const selBox = selAnn ? bboxCmds(selAnn.cmds) : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
    >
      {annotations.map(renderMark)}
      {selBox && (
        <rect
          x={selBox.x - 4} y={selBox.y - 4} width={selBox.w + 8} height={selBox.h + 8}
          fill="none" stroke="#0a84ff" strokeDasharray="6 4" strokeWidth={1.5}
          vectorEffect="non-scaling-stroke" pointerEvents="none"
        />
      )}
    </svg>
  );
}
