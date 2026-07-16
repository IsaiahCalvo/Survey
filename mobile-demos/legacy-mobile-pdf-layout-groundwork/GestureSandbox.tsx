/**
 * ============================================================================
 *  GESTURE SANDBOX  —  THROWAWAY PROTOTYPE (delete or absorb when decisions land)
 * ============================================================================
 *  Question this answers: how should desktop mouse/keyboard gestures feel as
 *  finger gestures on a phone?  Three labs you switch between with the bottom bar:
 *
 *   A. CORE GRAMMAR   one finger = the tool's action, two fingers = pan/zoom,
 *                     2-finger tap = undo, 3-finger tap = redo.  (the bug fix)
 *   B. MULTI-SELECT   V1 lasso+add/subtract · V2 tap-to-add · V3 both (Item Picker)
 *   C. EDIT & CONTEXT resize handles, 15° rotation snap + type-a-degree,
 *                     constrain (hold-to-snap + lock toggle),
 *                     tap→quick-bar  vs  long-press→full context menu
 *
 *  Rules (prototype skill): no persistence, state lives in memory, surfaces the
 *  live state in a HUD, no error handling beyond runnable.  Built on
 *  react-native-gesture-handler (RNGH) so multi-touch actually works.
 * ============================================================================
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  LayoutRectangle,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Ellipse, G, Line, Polyline, Rect } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

// ---------------------------------------------------------------------------
// Theme (matches the real app chrome)
// ---------------------------------------------------------------------------
const C = {
  backdrop: '#15171C',
  chrome: '#202126',
  panel: '#24272D',
  line: '#323844',
  text: '#F2F2F2',
  muted: '#A8B0BF',
  blue: '#2B6FB6',
  blueBright: '#4A90E2',
  page: '#FBFBF8',
  pageLine: '#E7E7DF',
  ink: '#1C2533',
  red: '#D9534F',
  green: '#46B26B',
  amber: '#E0A22B',
};

const PAGE_W = 920;
const PAGE_H = 1240;
const MIN_S = 0.25;
const MAX_S = 6;

type Pt = { x: number; y: number };
type Stroke = { id: string; pts: Pt[]; color: string; width: number };
type ShapeKind = 'rect' | 'ellipse';
type Shape = {
  id: string;
  kind: ShapeKind;
  x: number; // top-left, page-local
  y: number;
  w: number;
  h: number;
  rot: number; // degrees
  color: string;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
let _id = 0;
const uid = () => `s${_id++}`;

const PALETTE = [C.blue, C.red, C.green, C.amber, '#8E6FD0', '#1FA8A8'];

// ---------------------------------------------------------------------------
// Shared pan/zoom transform.  Outer view = pan (translate), inner view = zoom
// (scale about top-left) so page-local <-> viewport math is exact:
//     viewport = committed.t + committed.s * local
//     local    = (viewport - committed.t) / committed.s
// ---------------------------------------------------------------------------
function useTransform() {
  const tx = useRef(new Animated.Value(40)).current;
  const ty = useRef(new Animated.Value(80)).current;
  const sc = useRef(new Animated.Value(0.4)).current;
  const committed = useRef({ tx: 40, ty: 80, s: 0.4 });
  const start = useRef({ tx: 40, ty: 80, s: 0.4 });

  const apply = (t: { tx: number; ty: number; s: number }) => {
    tx.setValue(t.tx);
    ty.setValue(t.ty);
    sc.setValue(t.s);
  };
  const toLocal = (vx: number, vy: number): Pt => ({
    x: (vx - committed.current.tx) / committed.current.s,
    y: (vy - committed.current.ty) / committed.current.s,
  });
  return { tx, ty, sc, committed, start, apply, toLocal };
}
type TransformApi = ReturnType<typeof useTransform>;

// Two-finger pan + pinch + undo/redo taps — shared by every lab.
function useNavGestures(
  T: TransformApi,
  onUndo: () => void,
  onRedo: () => void,
  setHud: (s: Partial<Hud>) => void,
) {
  return useMemo(() => {
    const pan = Gesture.Pan()
      .minPointers(2)
      .maxPointers(2)
      .runOnJS(true)
      .onBegin(() => {
        T.start.current = { ...T.committed.current };
        setHud({ last: '2-finger pan' });
      })
      .onUpdate((e) => {
        T.tx.setValue(T.start.current.tx + e.translationX);
        T.ty.setValue(T.start.current.ty + e.translationY);
      })
      .onEnd((e) => {
        T.committed.current.tx = T.start.current.tx + e.translationX;
        T.committed.current.ty = T.start.current.ty + e.translationY;
      });

    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onBegin(() => {
        T.start.current = { ...T.committed.current };
        setHud({ last: 'pinch zoom' });
      })
      .onUpdate((e) => {
        const ns = clamp(T.start.current.s * e.scale, MIN_S, MAX_S);
        // keep the pinch focal point pinned
        const lx = (e.focalX - T.start.current.tx) / T.start.current.s;
        const ly = (e.focalY - T.start.current.ty) / T.start.current.s;
        const nt = { tx: e.focalX - lx * ns, ty: e.focalY - ly * ns, s: ns };
        T.apply(nt);
        T.committed.current = nt; // commit live so a draw right after is accurate
        setHud({ scale: ns });
      });

    const undo = Gesture.Tap()
      .minPointers(2)
      .runOnJS(true)
      .onEnd(() => {
        onUndo();
        setHud({ last: '2-finger tap → UNDO' });
      });

    const redo = Gesture.Tap()
      .minPointers(3)
      .runOnJS(true)
      .onEnd(() => {
        onRedo();
        setHud({ last: '3-finger tap → REDO' });
      });

    return { pan, pinch, undo, redo };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

type Hud = { last: string; scale: number; extra: string };

// ===========================================================================
//  LAB A — CORE GRAMMAR
// ===========================================================================
function LabCore({ viewport }: { viewport: LayoutRectangle | null }) {
  const T = useTransform();
  const [tool, setTool] = useState<'pan' | 'pen' | 'select'>('pen');
  const toolRef = useRef(tool);
  toolRef.current = tool;

  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const redoBuf = useRef<Stroke[]>([]);
  const cur = useRef<Stroke | null>(null);
  const [, force] = useState(0);
  const repaint = () => force((n) => n + 1);

  const [hud, setHudState] = useState<Hud>({ last: '—', scale: 0.4, extra: '' });
  const setHud = (p: Partial<Hud>) => setHudState((h) => ({ ...h, ...p }));

  const undo = () => {
    setStrokes((s) => {
      if (!s.length) return s;
      redoBuf.current.push(s[s.length - 1]);
      return s.slice(0, -1);
    });
  };
  const redo = () => {
    const r = redoBuf.current.pop();
    if (r) setStrokes((s) => [...s, r]);
  };
  const nav = useNavGestures(T, undo, redo, setHud);

  // one-finger gesture: behaviour depends on the active tool
  const oneFinger = useMemo(() => {
    const start = { tx: 0, ty: 0 };
    return Gesture.Pan()
      .maxPointers(1)
      .runOnJS(true)
      .onBegin((e) => {
        const t = toolRef.current;
        if (t === 'pan') {
          start.tx = T.committed.current.tx;
          start.ty = T.committed.current.ty;
          setHud({ last: '1-finger PAN (pan tool)' });
        } else if (t === 'pen') {
          const p = T.toLocal(e.x, e.y);
          cur.current = { id: uid(), pts: [p], color: C.blue, width: 3 };
          redoBuf.current = [];
          setHud({ last: '1-finger DRAW' });
          repaint();
        } else {
          setHud({ last: '1-finger (select) — drag = marquee' });
        }
      })
      .onUpdate((e) => {
        const t = toolRef.current;
        if (t === 'pan') {
          T.tx.setValue(start.tx + e.translationX);
          T.ty.setValue(start.ty + e.translationY);
        } else if (t === 'pen' && cur.current) {
          cur.current.pts.push(T.toLocal(e.x, e.y));
          repaint();
        }
      })
      .onEnd((e) => {
        const t = toolRef.current;
        if (t === 'pan') {
          T.committed.current.tx = start.tx + e.translationX;
          T.committed.current.ty = start.ty + e.translationY;
        } else if (t === 'pen' && cur.current) {
          if (cur.current.pts.length > 1) {
            const done = cur.current;
            setStrokes((s) => [...s, done]);
          }
          cur.current = null;
          repaint();
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // memoized so per-frame repaints during a draw can't reset the live gesture
  const gesture = useMemo(() => Gesture.Simultaneous(
    Gesture.Exclusive(nav.redo, nav.undo), // redo (3-finger) gets priority over undo (2-finger)
    Gesture.Race(oneFinger, Gesture.Simultaneous(nav.pan, nav.pinch)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), []);

  return (
    <View style={styles.labFill}>
      <Toolbar
        items={[
          { key: 'pan', label: 'Pan' },
          { key: 'pen', label: 'Pen' },
          { key: 'select', label: 'Select' },
        ]}
        value={tool}
        onChange={(k) => setTool(k as typeof tool)}
      />
      <Hint text={
        tool === 'pan'
          ? '1 finger scrolls · 2 fingers also pan/zoom'
          : tool === 'pen'
          ? '1 finger DRAWS · 2 fingers pan · pinch zoom · 2-tap undo · 3-tap redo'
          : '1 finger select/marquee · 2 fingers pan/zoom'
      } />
      <GestureDetector gesture={gesture}>
        <View style={styles.canvas} collapsable={false}>
          <Animated.View style={[styles.panLayer, { transform: [{ translateX: T.tx }, { translateY: T.ty }] }]}>
            <Animated.View style={[styles.zoomLayer, { transform: [{ scale: T.sc }] }]}>
              <Svg width={PAGE_W} height={PAGE_H}>
                <Rect x={0} y={0} width={PAGE_W} height={PAGE_H} fill={C.page} stroke={C.pageLine} strokeWidth={2} />
                {gridLines()}
                {strokes.map((s) => (
                  <Polyline key={s.id} points={ptsStr(s.pts)} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {cur.current && cur.current.pts.length > 1 && (
                  <Polyline points={ptsStr(cur.current.pts)} fill="none" stroke={cur.current.color} strokeWidth={cur.current.width} strokeLinejoin="round" strokeLinecap="round" />
                )}
              </Svg>
            </Animated.View>
          </Animated.View>
        </View>
      </GestureDetector>
      <HudBar hud={hud} extra={`strokes ${strokes.length}`} />
    </View>
  );
}

// ===========================================================================
//  LAB B — MULTI-SELECT  (V1 lasso / V2 tap-to-add / V3 both)
// ===========================================================================
function seedShapes(): Shape[] {
  _id = 0;
  const mk = (kind: ShapeKind, x: number, y: number, w: number, h: number, i: number): Shape => ({
    id: uid(), kind, x, y, w, h, rot: 0, color: PALETTE[i % PALETTE.length],
  });
  return [
    mk('rect', 120, 160, 220, 150, 0),
    mk('ellipse', 460, 150, 200, 200, 1),
    mk('rect', 150, 460, 180, 120, 2),
    mk('ellipse', 470, 470, 230, 150, 3),
    mk('rect', 250, 720, 260, 160, 4),
    mk('ellipse', 600, 760, 170, 170, 5),
  ];
}

function LabMultiSelect({ viewport }: { viewport: LayoutRectangle | null }) {
  const T = useTransform();
  const [variant, setVariant] = useState<'V1' | 'V2' | 'V3'>('V1');
  const variantRef = useRef(variant);
  variantRef.current = variant;
  const [addMode, setAddMode] = useState<'add' | 'subtract'>('add');
  const addModeRef = useRef(addMode);
  addModeRef.current = addMode;

  const [shapes] = useState<Shape[]>(seedShapes());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const selRef = useRef(sel);
  selRef.current = sel;
  const [lasso, setLasso] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const lassoStart = useRef<Pt | null>(null);
  const lassoBox = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const [hud, setHudState] = useState<Hud>({ last: '—', scale: 0.4, extra: '' });
  const setHud = (p: Partial<Hud>) => setHudState((h) => ({ ...h, ...p }));
  const nav = useNavGestures(T, () => setSel(new Set()), () => {}, setHud);

  const hitShape = (p: Pt): Shape | null => {
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) return s;
    }
    return null;
  };

  const tap = useMemo(() =>
    Gesture.Tap()
      .runOnJS(true)
      .onEnd((e) => {
        const p = T.toLocal(e.x, e.y);
        const s = hitShape(p);
        const v = variantRef.current;
        setSel((prev) => {
          const next = new Set(prev);
          if (!s) {
            next.clear();
            setHud({ last: 'tap empty → clear' });
            return next;
          }
          if (v === 'V1') {
            // V1: plain tap selects just one (lasso does the multi part)
            next.clear();
            next.add(s.id);
            setHud({ last: 'tap → select one' });
          } else {
            // V2 + V3: tap toggles membership
            if (next.has(s.id)) next.delete(s.id);
            else next.add(s.id);
            setHud({ last: `tap → toggle (${next.size})` });
          }
          return next;
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const lassoGesture = useMemo(() =>
    Gesture.Pan()
      .maxPointers(1)
      .runOnJS(true)
      .onBegin((e) => {
        if (variantRef.current === 'V2') return; // V2 has no lasso
        lassoStart.current = T.toLocal(e.x, e.y);
        lassoBox.current = null;
      })
      .onUpdate((e) => {
        if (!lassoStart.current) return;
        const p = T.toLocal(e.x, e.y);
        const a = lassoStart.current;
        const box = { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) };
        lassoBox.current = box;
        setLasso(box);
      })
      .onEnd(() => {
        const box = lassoBox.current;
        if (lassoStart.current && box && box.w > 4 && box.h > 4) {
          const hits = shapes.filter((s) => rectsOverlap(box, { x: s.x, y: s.y, w: s.w, h: s.h })).map((s) => s.id);
          setSel((prev) => {
            const next = new Set(prev);
            if (variantRef.current === 'V3' || addModeRef.current === 'add') {
              hits.forEach((h) => next.add(h)); // V3 lasso always adds onto existing
            } else {
              hits.forEach((h) => next.delete(h)); // V1 subtract
            }
            setHud({ last: `lasso → ${hits.length} hit (${next.size} total)` });
            return next;
          });
        }
        lassoStart.current = null;
        lassoBox.current = null;
        setLasso(null);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const gesture = useMemo(() => Gesture.Simultaneous(
    Gesture.Exclusive(tap, Gesture.Race(lassoGesture, Gesture.Simultaneous(nav.pan, nav.pinch))),
    nav.undo,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), []);

  return (
    <View style={styles.labFill}>
      <Toolbar
        items={[
          { key: 'V1', label: 'V1 Lasso' },
          { key: 'V2', label: 'V2 Tap-add' },
          { key: 'V3', label: 'V3 Both' },
        ]}
        value={variant}
        onChange={(k) => { setVariant(k as typeof variant); setSel(new Set()); }}
      />
      {variant === 'V1' && (
        <Toolbar
          small
          items={[{ key: 'add', label: '＋ Add' }, { key: 'subtract', label: '－ Subtract' }]}
          value={addMode}
          onChange={(k) => setAddMode(k as typeof addMode)}
        />
      )}
      <Hint text={
        variant === 'V1'
          ? 'Drag a box to lasso (add/subtract toggle) · tap = select one · 2-finger tap = clear'
          : variant === 'V2'
          ? 'Tap shapes to add/remove from selection · 2 fingers pan/zoom · 2-finger tap = clear'
          : 'Lasso a group, then tap shapes to add/remove (Item-Picker style)'
      } />
      <GestureDetector gesture={gesture}>
        <View style={styles.canvas} collapsable={false}>
          <Animated.View style={[styles.panLayer, { transform: [{ translateX: T.tx }, { translateY: T.ty }] }]}>
            <Animated.View style={[styles.zoomLayer, { transform: [{ scale: T.sc }] }]}>
              <Svg width={PAGE_W} height={PAGE_H}>
                <Rect x={0} y={0} width={PAGE_W} height={PAGE_H} fill={C.page} stroke={C.pageLine} strokeWidth={2} />
                {shapes.map((s) => renderShape(s, sel.has(s.id)))}
                {lasso && (
                  <Rect x={lasso.x} y={lasso.y} width={lasso.w} height={lasso.h} fill={C.blueBright + '22'} stroke={C.blueBright} strokeWidth={2} strokeDasharray="8 6" />
                )}
              </Svg>
            </Animated.View>
          </Animated.View>
        </View>
      </GestureDetector>
      <HudBar hud={hud} extra={`selected ${sel.size}`} />
    </View>
  );
}

// ===========================================================================
//  LAB C — EDIT & CONTEXT  (resize / 15° rotate / constrain / menus)
// ===========================================================================
function LabEdit({ viewport }: { viewport: LayoutRectangle | null }) {
  const T = useTransform();
  const [shapes, setShapes] = useState<Shape[]>(() => {
    _id = 0;
    return [
      { id: uid(), kind: 'rect', x: 200, y: 240, w: 320, h: 220, rot: 0, color: C.blue },
      { id: uid(), kind: 'ellipse', x: 360, y: 640, w: 280, h: 200, rot: 20, color: C.green },
    ];
  });
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const [selId, setSelId] = useState<string | null>(null);
  const selIdRef = useRef(selId);
  selIdRef.current = selId;
  const [lockAspect, setLockAspect] = useState(false);
  const lockRef = useRef(lockAspect);
  lockRef.current = lockAspect;
  const [snap15, setSnap15] = useState(true);
  const snapRef = useRef(snap15);
  snapRef.current = snap15;

  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [degInput, setDegInput] = useState<{ id: string; value: string } | null>(null);

  const [hud, setHudState] = useState<Hud>({ last: '—', scale: 0.4, extra: '' });
  const setHud = (p: Partial<Hud>) => setHudState((h) => ({ ...h, ...p }));
  const nav = useNavGestures(T, () => {}, () => {}, setHud);

  const HANDLE = 26; // page-local hit radius for handles (≈44px @ s=0.6)
  const sel = shapes.find((s) => s.id === selId) || null;

  const update = (id: string, patch: Partial<Shape>) =>
    setShapes((arr) => arr.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const center = (s: Shape): Pt => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });
  // rotate a page point into a shape's un-rotated frame (for handle hit-testing)
  const intoShape = (s: Shape, p: Pt): Pt => {
    const c = center(s);
    const a = (-s.rot * Math.PI) / 180;
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return { x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) };
  };
  const handlePoints = (s: Shape) => ({
    tl: { x: s.x, y: s.y },
    tr: { x: s.x + s.w, y: s.y },
    bl: { x: s.x, y: s.y + s.h },
    br: { x: s.x + s.w, y: s.y + s.h },
    rot: { x: s.x + s.w / 2, y: s.y - 70 },
  });

  type Drag =
    | { kind: 'move'; sx: number; sy: number; ox: number; oy: number }
    | { kind: 'resize'; corner: 'tl' | 'tr' | 'bl' | 'br'; o: Shape; lastMoveAt: number }
    | { kind: 'rotate'; cx: number; cy: number };
  const drag = useRef<Drag | null>(null);

  const pickHandle = (s: Shape, local: Pt): 'tl' | 'tr' | 'bl' | 'br' | 'rot' | null => {
    const hp = handlePoints(s);
    const p = intoShape(s, local);
    for (const k of ['tl', 'tr', 'bl', 'br', 'rot'] as const) {
      const h = hp[k];
      if (Math.hypot(p.x - h.x, p.y - h.y) <= HANDLE) return k;
    }
    return null;
  };
  const hitBody = (s: Shape, local: Pt) => {
    const p = intoShape(s, local);
    return p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
  };

  const oneFinger = useMemo(() =>
    Gesture.Pan()
      .maxPointers(1)
      .runOnJS(true)
      .onBegin((e) => {
        const local = T.toLocal(e.x, e.y);
        const cs = shapesRef.current.find((x) => x.id === selIdRef.current) || null;
        if (cs) {
          const h = pickHandle(cs, local);
          if (h === 'rot') {
            const c = center(cs);
            drag.current = { kind: 'rotate', cx: c.x, cy: c.y };
            setHud({ last: 'rotate' });
            return;
          }
          if (h) {
            drag.current = { kind: 'resize', corner: h, o: { ...cs }, lastMoveAt: Date.now() };
            setHud({ last: `resize ${h}` });
            return;
          }
          if (hitBody(cs, local)) {
            drag.current = { kind: 'move', sx: local.x, sy: local.y, ox: cs.x, oy: cs.y };
            setHud({ last: 'move' });
            return;
          }
        }
        // not dragging selection → select what's under finger (or clear)
        const hit = [...shapesRef.current].reverse().find((x) => hitBody(x, local));
        setSelId(hit ? hit.id : null);
        setMenu(null);
        drag.current = null;
      })
      .onUpdate((e) => {
        const d = drag.current;
        if (!d) return;
        const local = T.toLocal(e.x, e.y);
        const id = selIdRef.current!;
        if (d.kind === 'move') {
          update(id, { x: d.ox + (local.x - d.sx), y: d.oy + (local.y - d.sy) });
        } else if (d.kind === 'rotate') {
          let deg = (Math.atan2(local.y - d.cy, local.x - d.cx) * 180) / Math.PI + 90;
          if (snapRef.current) deg = Math.round(deg / 15) * 15;
          deg = ((deg % 360) + 360) % 360;
          update(id, { rot: deg });
          setHud({ extra: `${Math.round(deg)}°` });
        } else if (d.kind === 'resize') {
          d.lastMoveAt = Date.now();
          const o = d.o;
          const fixed =
            d.corner === 'br' ? { x: o.x, y: o.y } :
            d.corner === 'bl' ? { x: o.x + o.w, y: o.y } :
            d.corner === 'tr' ? { x: o.x, y: o.y + o.h } :
            { x: o.x + o.w, y: o.y + o.h };
          let nx = Math.min(fixed.x, local.x);
          let ny = Math.min(fixed.y, local.y);
          let nw = Math.max(20, Math.abs(local.x - fixed.x));
          let nh = Math.max(20, Math.abs(local.y - fixed.y));
          if (lockRef.current) {
            const m = Math.max(nw, nh);
            nw = m; nh = m;
            nx = local.x < fixed.x ? fixed.x - m : fixed.x;
            ny = local.y < fixed.y ? fixed.y - m : fixed.y;
          }
          update(id, { x: nx, y: ny, w: nw, h: nh });
        }
      })
      .onEnd(() => {
        const d = drag.current;
        if (d && d.kind === 'resize' && !lockRef.current) {
          // hold-to-snap: if the finger was still ≥300ms before lifting → snap to square
          if (Date.now() - d.lastMoveAt >= 300) {
            const s = shapesRef.current.find((x) => x.id === selIdRef.current);
            if (s) {
              const m = Math.max(s.w, s.h);
              update(s.id, { w: m, h: m });
              setHud({ last: 'held → snapped to square' });
            }
          }
        }
        drag.current = null;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const longPress = useMemo(() =>
    Gesture.LongPress()
      .minDuration(350)
      .runOnJS(true)
      .onStart((e) => {
        const local = T.toLocal(e.x, e.y);
        const hit = [...shapesRef.current].reverse().find((x) => hitBody(x, local));
        if (hit) {
          setSelId(hit.id);
          setMenu({ x: e.x, y: e.y, id: hit.id });
          setHud({ last: 'long-press → context menu' });
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const tapEmpty = useMemo(() =>
    Gesture.Tap().runOnJS(true).onEnd((e) => {
      const local = T.toLocal(e.x, e.y);
      const hit = [...shapesRef.current].reverse().find((x) => hitBody(x, local));
      setSelId(hit ? hit.id : null);
      if (!hit) setMenu(null);
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const gesture = useMemo(() => Gesture.Simultaneous(
    Gesture.Exclusive(longPress, oneFinger, tapEmpty),
    Gesture.Simultaneous(nav.pan, nav.pinch, nav.undo),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), []);

  // quick-bar / menu actions
  const del = (id: string) => { setShapes((a) => a.filter((s) => s.id !== id)); setSelId(null); setMenu(null); };
  const dup = (id: string) => {
    const s = shapesRef.current.find((x) => x.id === id);
    if (!s) return;
    const n = { ...s, id: uid(), x: s.x + 40, y: s.y + 40 };
    setShapes((a) => [...a, n]); setSelId(n.id); setMenu(null);
  };
  const recolor = (id: string) => {
    const s = shapesRef.current.find((x) => x.id === id);
    if (!s) return;
    const idx = (PALETTE.indexOf(s.color) + 1) % PALETTE.length;
    update(id, { color: PALETTE[idx] });
  };

  // screen position of the quick-bar (above the selected shape)
  const quickBarPos = sel ? localToView(T, center(sel).x, sel.y) : null;

  return (
    <View style={styles.labFill}>
      <Toolbar
        small
        items={[
          { key: 'lock', label: lockAspect ? '🔒 Lock 1:1 ON' : '🔓 Lock 1:1' },
          { key: 'snap', label: snap15 ? '15° snap ON' : '15° snap off' },
        ]}
        value={''}
        onChange={(k) => { if (k === 'lock') setLockAspect((v) => !v); else setSnap15((v) => !v); }}
      />
      <Hint text="Tap a shape → quick-bar · long-press → full menu · drag corner = resize (hold still to snap □) · drag/tap the top handle = rotate (15°) / type °" />
      <GestureDetector gesture={gesture}>
        <View style={styles.canvas} collapsable={false}>
          <Animated.View style={[styles.panLayer, { transform: [{ translateX: T.tx }, { translateY: T.ty }] }]}>
            <Animated.View style={[styles.zoomLayer, { transform: [{ scale: T.sc }] }]}>
              <Svg width={PAGE_W} height={PAGE_H}>
                <Rect x={0} y={0} width={PAGE_W} height={PAGE_H} fill={C.page} stroke={C.pageLine} strokeWidth={2} />
                {shapes.map((s) => renderShape(s, s.id === selId))}
                {sel && renderHandles(sel)}
              </Svg>
            </Animated.View>
          </Animated.View>

          {/* Quick-bar (tap-select path) */}
          {sel && quickBarPos && !menu && (
            <View style={[styles.quickBar, { left: clamp(quickBarPos.x - 110, 6, (viewport?.width ?? 360) - 226), top: clamp(quickBarPos.y - 54, 6, (viewport?.height ?? 600) - 50) }]}>
              <QuickBtn label="Delete" tone={C.red} onPress={() => del(sel.id)} />
              <QuickBtn label="Dup" onPress={() => dup(sel.id)} />
              <QuickBtn label="Color" onPress={() => recolor(sel.id)} />
              <QuickBtn label={`${Math.round(sel.rot)}°`} onPress={() => setDegInput({ id: sel.id, value: String(Math.round(sel.rot)) })} />
            </View>
          )}

          {/* Full context menu (long-press path) */}
          {menu && (
            <View style={[styles.contextMenu, { left: clamp(menu.x - 80, 6, (viewport?.width ?? 360) - 166), top: clamp(menu.y + 8, 6, (viewport?.height ?? 600) - 260) }]}>
              {['Cut', 'Copy', 'Duplicate', 'Delete', 'Bring to front', 'Lock'].map((m) => (
                <Pressable key={m} style={styles.ctxRow} onPress={() => {
                  if (m === 'Delete' || m === 'Cut') del(menu.id);
                  else if (m === 'Duplicate' || m === 'Copy') dup(menu.id);
                  else setMenu(null);
                }}>
                  <Text style={[styles.ctxText, m === 'Delete' && { color: C.red }]}>{m}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* Type-a-degree popover (Drawboard-style) */}
          {degInput && (
            <View style={styles.degPopover}>
              <Text style={styles.degLabel}>Rotate to°</Text>
              <TextInput
                style={styles.degField}
                value={degInput.value}
                onChangeText={(t) => setDegInput({ ...degInput, value: t.replace(/[^0-9.-]/g, '') })}
                keyboardType="numbers-and-punctuation"
                autoFocus
              />
              <Pressable style={styles.degApply} onPress={() => {
                const v = ((parseFloat(degInput.value) || 0) % 360 + 360) % 360;
                update(degInput.id, { rot: v });
                setDegInput(null);
              }}>
                <Text style={styles.degApplyText}>Set</Text>
              </Pressable>
              <Pressable style={styles.degCancel} onPress={() => setDegInput(null)}>
                <Text style={[styles.degApplyText, { color: C.muted }]}>✕</Text>
              </Pressable>
            </View>
          )}
        </View>
      </GestureDetector>
      <HudBar hud={hud} extra={sel ? `sel ${Math.round(sel.rot)}° ${Math.round(sel.w)}×${Math.round(sel.h)}` : 'no selection'} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// shared renderers / helpers
// ---------------------------------------------------------------------------
function ptsStr(pts: Pt[]) {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}
function gridLines() {
  const lines = [];
  for (let x = 0; x <= PAGE_W; x += 80) lines.push(<Line key={`gx${x}`} x1={x} y1={0} x2={x} y2={PAGE_H} stroke={C.pageLine} strokeWidth={1} />);
  for (let y = 0; y <= PAGE_H; y += 80) lines.push(<Line key={`gy${y}`} x1={0} y1={y} x2={PAGE_W} y2={y} stroke={C.pageLine} strokeWidth={1} />);
  return <G opacity={0.6}>{lines}</G>;
}
function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function renderShape(s: Shape, selected: boolean) {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const stroke = selected ? C.blueBright : C.ink;
  const sw = selected ? 5 : 3;
  const inner = s.kind === 'rect'
    ? <Rect x={s.x} y={s.y} width={s.w} height={s.h} fill={s.color + 'CC'} stroke={stroke} strokeWidth={sw} rx={6} />
    : <Ellipse cx={cx} cy={cy} rx={s.w / 2} ry={s.h / 2} fill={s.color + 'CC'} stroke={stroke} strokeWidth={sw} />;
  return <G key={s.id} transform={`rotate(${s.rot} ${cx} ${cy})`}>{inner}</G>;
}
function renderHandles(s: Shape) {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const r = 12;
  const corners = [
    { x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x, y: s.y + s.h }, { x: s.x + s.w, y: s.y + s.h },
  ];
  return (
    <G transform={`rotate(${s.rot} ${cx} ${cy})`}>
      <Rect x={s.x} y={s.y} width={s.w} height={s.h} fill="none" stroke={C.blueBright} strokeWidth={2} strokeDasharray="6 5" />
      <Line x1={cx} y1={s.y} x2={cx} y2={s.y - 70} stroke={C.blueBright} strokeWidth={2} />
      <Circle cx={cx} cy={s.y - 70} r={16} fill={C.blueBright} />
      {corners.map((c, i) => (
        <Rect key={i} x={c.x - r} y={c.y - r} width={r * 2} height={r * 2} fill="#fff" stroke={C.blueBright} strokeWidth={3} rx={3} />
      ))}
    </G>
  );
}
function localToView(T: TransformApi, lx: number, ly: number): Pt {
  return { x: T.committed.current.tx + lx * T.committed.current.s, y: T.committed.current.ty + ly * T.committed.current.s };
}

// ---------------------------------------------------------------------------
// small UI atoms
// ---------------------------------------------------------------------------
function Toolbar({ items, value, onChange, small }: { items: { key: string; label: string }[]; value: string; onChange: (k: string) => void; small?: boolean }) {
  return (
    <View style={[styles.toolbar, small && { paddingVertical: 4 }]}>
      {items.map((it) => {
        const active = it.key === value;
        return (
          <Pressable key={it.key} onPress={() => onChange(it.key)} style={[styles.toolBtn, small && styles.toolBtnSmall, active && styles.toolBtnActive]}>
            <Text style={[styles.toolText, active && styles.toolTextActive]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function Hint({ text }: { text: string }) {
  return <View style={styles.hint}><Text style={styles.hintText}>{text}</Text></View>;
}
function HudBar({ hud, extra }: { hud: Hud; extra: string }) {
  return (
    <View style={styles.hudBar}>
      <Text style={styles.hudText}>zoom {Math.round(hud.scale * 100)}%</Text>
      <Text style={styles.hudText}>· {hud.last}</Text>
      <Text style={[styles.hudText, { color: C.amber }]}>· {extra}{hud.extra ? ` ${hud.extra}` : ''}</Text>
    </View>
  );
}
function QuickBtn({ label, onPress, tone }: { label: string; onPress: () => void; tone?: string }) {
  return (
    <Pressable onPress={onPress} style={styles.quickBtn}>
      <Text style={[styles.quickBtnText, tone && { color: tone }]}>{label}</Text>
    </Pressable>
  );
}

// ===========================================================================
//  Shell
// ===========================================================================
export default function GestureSandbox({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [lab, setLab] = useState<'A' | 'B' | 'C'>('A');
  const [viewport, setViewport] = useState<LayoutRectangle | null>(null);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>🧪 Gesture Sandbox</Text>
        <Text style={styles.subtitle}>throwaway — for choosing gestures</Text>
        <Pressable onPress={onClose} style={styles.close}><Text style={styles.closeText}>Close ✕</Text></Pressable>
      </View>

      <View style={styles.body} onLayout={(e) => setViewport(e.nativeEvent.layout)}>
        {lab === 'A' && <LabCore viewport={viewport} />}
        {lab === 'B' && <LabMultiSelect viewport={viewport} />}
        {lab === 'C' && <LabEdit viewport={viewport} />}
      </View>

      <View style={[styles.labBar, { paddingBottom: insets.bottom + 8 }]}>
        {([
          { k: 'A', t: 'A · Core' },
          { k: 'B', t: 'B · Multi-select' },
          { k: 'C', t: 'C · Edit & menus' },
        ] as const).map((x) => (
          <Pressable key={x.k} onPress={() => setLab(x.k)} style={[styles.labBtn, lab === x.k && styles.labBtnActive]}>
            <Text style={[styles.labBtnText, lab === x.k && styles.labBtnTextActive]}>{x.t}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const { width: SCREEN_W } = Dimensions.get('window');
const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: C.backdrop, zIndex: 1000 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.chrome, borderBottomWidth: 1, borderBottomColor: '#090A0D' },
  title: { color: C.text, fontWeight: '700', fontSize: 15 },
  subtitle: { color: C.muted, fontSize: 11, marginLeft: 8, flex: 1 },
  close: { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#2A2D34', borderRadius: 6 },
  closeText: { color: C.text, fontSize: 12, fontWeight: '600' },

  body: { flex: 1 },
  labFill: { flex: 1 },
  canvas: { flex: 1, overflow: 'hidden', backgroundColor: C.backdrop },
  panLayer: { position: 'absolute', left: 0, top: 0 },
  // @ts-ignore transformOrigin is supported in RN 0.81
  zoomLayer: { width: PAGE_W, height: PAGE_H, transformOrigin: 'top left' },

  toolbar: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: C.chrome, borderBottomWidth: 1, borderBottomColor: C.line },
  toolBtn: { paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#2A2D34', borderRadius: 7, borderWidth: 1, borderColor: C.line },
  toolBtnSmall: { paddingHorizontal: 10, paddingVertical: 5 },
  toolBtnActive: { backgroundColor: '#132235', borderColor: C.blue },
  toolText: { color: C.muted, fontSize: 13, fontWeight: '600' },
  toolTextActive: { color: C.text },

  hint: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#1A1E25' },
  hintText: { color: C.muted, fontSize: 11, lineHeight: 15 },

  hudBar: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.chrome, borderTopWidth: 1, borderTopColor: C.line, flexWrap: 'wrap' },
  hudText: { color: C.text, fontSize: 12, fontWeight: '500' },

  quickBar: { position: 'absolute', flexDirection: 'row', gap: 4, backgroundColor: '#0E1116EE', padding: 4, borderRadius: 9, borderWidth: 1, borderColor: C.line },
  quickBtn: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#2A2D34', borderRadius: 6 },
  quickBtnText: { color: C.text, fontSize: 12, fontWeight: '600' },

  contextMenu: { position: 'absolute', width: 160, backgroundColor: '#0E1116F2', borderRadius: 10, borderWidth: 1, borderColor: C.line, paddingVertical: 4 },
  ctxRow: { paddingHorizontal: 14, paddingVertical: 11 },
  ctxText: { color: C.text, fontSize: 14 },

  degPopover: { position: 'absolute', left: 20, bottom: 20, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0E1116F2', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: C.blue },
  degLabel: { color: C.muted, fontSize: 12 },
  degField: { width: 70, backgroundColor: '#20242C', color: C.text, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: C.line, fontSize: 14 },
  degApply: { backgroundColor: C.blue, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 },
  degApplyText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  degCancel: { paddingHorizontal: 6, paddingVertical: 6 },

  labBar: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingTop: 8, backgroundColor: C.chrome, borderTopWidth: 1, borderTopColor: '#090A0D' },
  labBtn: { flex: 1, paddingVertical: 11, backgroundColor: '#2A2D34', borderRadius: 8, alignItems: 'center' },
  labBtnActive: { backgroundColor: C.blue },
  labBtnText: { color: C.muted, fontSize: 12, fontWeight: '700' },
  labBtnTextActive: { color: '#fff' },
});
