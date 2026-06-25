/**
 * AnnotatablePdf — PRODUCTION FOUNDATION (Approach B: own-the-transform).
 *
 * The PDF render layer (<Pdf/>, touches disabled) and the Skia ink layer live
 * inside ONE transformed container, so ink stays glued to the page under any
 * zoom/pan — the alignment the Spike-2 prototype lacked. We own pan/zoom via
 * react-native-gesture-handler (CORE LAW: 1 finger = the tool's action,
 * 2 fingers always pan+pinch). Strokes are stored NORMALIZED (zoom-independent,
 * @survey/shared-ready). Zoom +/− buttons exist for deterministic testing.
 *
 * KNOWN v0 LIMITATIONS (the overlay-alignment research will refine these):
 *  - The PDF (and the ink) bitmap-scale with the container, so both soften when
 *    zoomed in. Production crispness = re-render the PDF at the zoom DPI and draw
 *    ink in a viewport Skia canvas at the live transform (Reanimated worklet).
 *  - Single page only; multi-page paging is a later step.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Animated, LayoutRectangle, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Canvas, Path } from '@shopify/react-native-skia';
import {
  clampNorm,
  localToNorm,
  newStrokeId,
  normToLocal,
  screenToLocal,
  strokeToLocalSvg,
  type Stroke,
  type Transform,
} from './pdfAnnotation';

const PDF_URL =
  'https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf';
const MIN_S = 0.5;
const MAX_S = 6;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function detectExpoGo(): boolean {
  try {
    return require('expo-constants').default?.executionEnvironment === 'storeClient';
  } catch {
    return false;
  }
}

export default function AnnotatablePdf({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'draw' | 'pan'>('draw');
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const [viewport, setViewport] = useState<LayoutRectangle | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [, force] = useState(0);
  const repaint = () => force((n) => n + 1);
  const cur = useRef<Stroke | null>(null);
  const [zoomLabel, setZoomLabel] = useState(100);

  // base page size (local space, scale 1) = fit page width to viewport
  const base = useMemo(() => {
    if (!viewport || !nat) return null;
    const w = viewport.width;
    const h = w * (nat.h / nat.w);
    return { w, h };
  }, [viewport, nat]);
  const baseRef = useRef(base);
  baseRef.current = base;

  // transform: committed numeric (for hit-testing/draw) + Animated (for render)
  const committed = useRef<Transform>({ scale: 1, tx: 0, ty: 0 });
  const start = useRef<Transform>({ scale: 1, tx: 0, ty: 0 });
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const sc = useRef(new Animated.Value(1)).current;
  const applyT = (t: Transform) => { tx.setValue(t.tx); ty.setValue(t.ty); sc.setValue(t.scale); setZoomLabel(Math.round(t.scale * 100)); };

  const Pdf = detectExpoGo() ? null : require('react-native-pdf').default;

  // ---- gestures (CORE LAW) ----
  const oneFinger = useMemo(() =>
    Gesture.Pan()
      .maxPointers(1)
      .runOnJS(true)
      .onBegin((e) => {
        if (modeRef.current === 'draw') {
          const b = baseRef.current;
          if (!b) return;
          const l = screenToLocal(e.x, e.y, committed.current);
          cur.current = { id: newStrokeId(), color: '#2B6FB6', width: 3, pts: [clampNorm(localToNorm(l.x, l.y, b.w, b.h))] };
          repaint();
        } else {
          start.current = { ...committed.current };
        }
      })
      .onUpdate((e) => {
        if (modeRef.current === 'draw') {
          const b = baseRef.current;
          if (!b || !cur.current) return;
          const l = screenToLocal(e.x, e.y, committed.current);
          cur.current.pts.push(clampNorm(localToNorm(l.x, l.y, b.w, b.h)));
          repaint();
        } else {
          tx.setValue(start.current.tx + e.translationX);
          ty.setValue(start.current.ty + e.translationY);
        }
      })
      .onEnd((e) => {
        if (modeRef.current === 'draw') {
          if (cur.current && cur.current.pts.length > 1) {
            const done = cur.current;
            setStrokes((s) => [...s, done]);
          }
          cur.current = null;
          repaint();
        } else {
          committed.current.tx = start.current.tx + e.translationX;
          committed.current.ty = start.current.ty + e.translationY;
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const twoPan = useMemo(() =>
    Gesture.Pan()
      .minPointers(2)
      .maxPointers(2)
      .runOnJS(true)
      .onBegin(() => { start.current = { ...committed.current }; })
      .onUpdate((e) => {
        tx.setValue(start.current.tx + e.translationX);
        ty.setValue(start.current.ty + e.translationY);
      })
      .onEnd((e) => {
        committed.current.tx = start.current.tx + e.translationX;
        committed.current.ty = start.current.ty + e.translationY;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const pinch = useMemo(() =>
    Gesture.Pinch()
      .runOnJS(true)
      .onBegin(() => { start.current = { ...committed.current }; })
      .onUpdate((e) => {
        const ns = clamp(start.current.scale * e.scale, MIN_S, MAX_S);
        const lx = (e.focalX - start.current.tx) / start.current.scale;
        const ly = (e.focalY - start.current.ty) / start.current.scale;
        const nt = { scale: ns, tx: e.focalX - lx * ns, ty: e.focalY - ly * ns };
        applyT(nt);
        committed.current = nt;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const gesture = useMemo(
    () => Gesture.Simultaneous(Gesture.Race(oneFinger, Gesture.Simultaneous(twoPan, pinch))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // zoom buttons (anchor at viewport center) — deterministic for testing
  const zoomBy = (factor: number) => {
    const vp = viewport;
    if (!vp) return;
    const cx = vp.width / 2;
    const cy = vp.height / 2;
    const c = committed.current;
    const ns = clamp(c.scale * factor, MIN_S, MAX_S);
    const lx = (cx - c.tx) / c.scale;
    const ly = (cy - c.ty) / c.scale;
    const nt = { scale: ns, tx: cx - lx * ns, ty: cy - ly * ns };
    committed.current = nt;
    Animated.parallel([
      Animated.timing(tx, { toValue: nt.tx, duration: 140, useNativeDriver: true }),
      Animated.timing(ty, { toValue: nt.ty, duration: 140, useNativeDriver: true }),
      Animated.timing(sc, { toValue: nt.scale, duration: 140, useNativeDriver: true }),
    ]).start();
    setZoomLabel(Math.round(ns * 100));
  };
  const resetZoom = () => { const nt = { scale: 1, tx: 0, ty: 0 }; committed.current = nt; applyT(nt); };

  if (!Pdf) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Header onClose={onClose} />
        <View style={styles.notice}><Text style={styles.noticeBody}>react-native-pdf needs the dev build (npx expo run:ios).</Text></View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Header onClose={onClose} />
      <View style={styles.bar}>
        <Pressable style={[styles.btn, mode === 'draw' && styles.on]} onPress={() => setMode('draw')}>
          <Text style={[styles.btnT, mode === 'draw' && styles.onT]}>✏️ Draw</Text>
        </Pressable>
        <Pressable style={[styles.btn, mode === 'pan' && styles.on]} onPress={() => setMode('pan')}>
          <Text style={[styles.btnT, mode === 'pan' && styles.onT]}>✋ Pan</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => zoomBy(1 / 1.4)}><Text style={styles.btnT}>－</Text></Pressable>
        <Pressable style={styles.btn} onPress={() => zoomBy(1.4)}><Text style={styles.btnT}>＋</Text></Pressable>
        <Pressable style={styles.btn} onPress={resetZoom}><Text style={styles.btnT}>⤢</Text></Pressable>
        <Pressable style={styles.clear} onPress={() => { setStrokes([]); cur.current = null; repaint(); }}><Text style={styles.clearT}>Clear</Text></Pressable>
      </View>
      <Text style={styles.hud}>zoom {zoomLabel}% · {strokes.length} strokes · {mode === 'draw' ? '1-finger draws, 2-finger pans/zooms' : '1-finger pans'} · ink stays glued to the page</Text>

      <View style={styles.stage} onLayout={(e) => setViewport(e.nativeEvent.layout)}>
        <GestureDetector gesture={gesture}>
          <View style={StyleSheet.absoluteFill} collapsable={false}>
            <Animated.View
              style={[
                base ? { width: base.w, height: base.h } : StyleSheet.absoluteFillObject,
                styles.page,
                { transform: [{ translateX: tx }, { translateY: ty }, { scale: sc }] },
              ]}
            >
              {/* render layer — touches disabled so RNGH owns all gestures */}
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <Pdf
                  source={{ uri: PDF_URL, cache: true }}
                  singlePage
                  scale={1}
                  onLoadComplete={(_n: number, _p: string, size: { width: number; height: number }) =>
                    setNat({ w: size.width, h: size.height })
                  }
                  style={StyleSheet.absoluteFill}
                />
              </View>
              {/* ink layer (same container → aligned). bitmap-scales with zoom (v0). */}
              {base && (
                <Canvas style={StyleSheet.absoluteFill}>
                  {strokes.map((s) => (
                    <Path key={s.id} path={strokeToLocalSvg(s, base.w, base.h)} style="stroke" strokeWidth={s.width} color={s.color} strokeJoin="round" strokeCap="round" />
                  ))}
                  {cur.current && cur.current.pts.length > 1 && (
                    <Path path={strokeToLocalSvg(cur.current, base.w, base.h)} style="stroke" strokeWidth={3} color="#D9534F" strokeJoin="round" strokeCap="round" />
                  )}
                </Canvas>
              )}
            </Animated.View>
          </View>
        </GestureDetector>
      </View>
    </View>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>🏗️ AnnotatablePdf (production foundation)</Text>
      <Pressable onPress={onClose} style={styles.close} hitSlop={8}><Text style={styles.closeT}>Close ✕</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: '#15171C', zIndex: 1000 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#202126', borderBottomWidth: 1, borderBottomColor: '#090A0D' },
  title: { color: '#F2F2F2', fontWeight: '700', fontSize: 14 },
  close: { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#2A2D34', borderRadius: 6 },
  closeT: { color: '#F2F2F2', fontSize: 12, fontWeight: '600' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#202126' },
  btn: { paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#2A2D34', borderRadius: 7, borderWidth: 1, borderColor: '#323844' },
  on: { backgroundColor: '#132235', borderColor: '#2B6FB6' },
  btnT: { color: '#A8B0BF', fontSize: 13, fontWeight: '600' },
  onT: { color: '#F2F2F2' },
  clear: { paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#3a2226', borderRadius: 7, marginLeft: 'auto' },
  clearT: { color: '#D9534F', fontSize: 12, fontWeight: '700' },
  hud: { color: '#A8B0BF', fontSize: 11, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#1A1E25' },
  stage: { flex: 1, backgroundColor: '#0E1116', overflow: 'hidden' },
  page: { position: 'absolute', left: 0, top: 0, transformOrigin: 'top left', backgroundColor: '#fff' },
  notice: { margin: 16, padding: 16, backgroundColor: '#24272D', borderRadius: 10 },
  noticeBody: { color: '#D6DBE3', fontSize: 13, lineHeight: 20 },
});
