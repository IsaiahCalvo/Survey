/**
 * AnnotatablePdf — PRODUCTION FOUNDATION (Approach B, UI-thread feel pass).
 *
 * PDF render layer (<Pdf/>, touches disabled) + Skia ink layer in ONE container.
 * The transform (pan/zoom) and the LIVE ink stroke run on the UI THREAD via
 * Reanimated worklets + react-native-skia, so the pen and the zoom keep up with
 * the finger (the fix for the JS-thread v0 jank). CORE LAW: 1 finger = the tool's
 * action, 2 fingers always pan+pinch. Strokes stored NORMALIZED (zoom-independent,
 * @survey/shared-ready). Tap-to-select + Delete.
 *
 * Still v0: PDF bitmap-scales (softens at high zoom) — crispness = re-render the
 * PDF via its `scale` prop on zoom-settle (next). Single page only.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutRectangle, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import {
  clampNorm,
  localToNorm,
  newStrokeId,
  pickStroke,
  strokeToLocalSvg,
  type Stroke,
} from './pdfAnnotation';

const PDF_URL =
  'https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf';
const MIN_S = 0.5;
const MAX_S = 6;
const HIT_PX = 22;

function detectExpoGo(): boolean {
  try {
    return require('expo-constants').default?.executionEnvironment === 'storeClient';
  } catch {
    return false;
  }
}

export default function AnnotatablePdf({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'draw' | 'select' | 'pan'>('draw');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<LayoutRectangle | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const [zoomLabel, setZoomLabel] = useState(100);

  const base = useMemo(() => {
    if (!viewport || !nat) return null;
    const w = viewport.width;
    return { w, h: w * (nat.h / nat.w) };
  }, [viewport, nat]);
  const baseRef = useRef(base);
  baseRef.current = base;

  // UI-thread state (shared values)
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sc = useSharedValue(1);
  const stx = useSharedValue(0); // gesture-start snapshots
  const sty = useSharedValue(0);
  const ssc = useSharedValue(1);
  const live = useSharedValue<{ x: number; y: number }[]>([]); // live stroke, page-local px
  const modeSV = useSharedValue(0); // 0 draw, 1 select, 2 pan
  useEffect(() => {
    modeSV.value = mode === 'draw' ? 0 : mode === 'select' ? 1 : 2;
  }, [mode, modeSV]);

  // JS-thread commit + select (called from worklets via runOnJS)
  const commitLocalStroke = (pts: { x: number; y: number }[]) => {
    const b = baseRef.current;
    if (!b || pts.length < 2) return;
    const norm = pts.map((p) => clampNorm(localToNorm(p.x, p.y, b.w, b.h)));
    setStrokes((s) => [...s, { id: newStrokeId(), color: '#2B6FB6', width: 3, pts: norm }]);
  };
  const handleTap = (sx: number, sy: number) => {
    if (modeSV.value !== 1) return;
    const b = baseRef.current;
    if (!b) return;
    const t = { scale: sc.value, tx: tx.value, ty: ty.value };
    setSelectedId(pickStroke(strokesRef.current, sx, sy, b.w, b.h, t, HIT_PX));
  };

  // ---- gestures (UI thread) ----
  const oneFinger = useMemo(() =>
    Gesture.Pan()
      .maxPointers(1)
      .onBegin((e) => {
        'worklet';
        stx.value = tx.value;
        sty.value = ty.value;
        if (modeSV.value === 0) {
          live.value = [{ x: (e.x - tx.value) / sc.value, y: (e.y - ty.value) / sc.value }];
        }
      })
      .onUpdate((e) => {
        'worklet';
        if (modeSV.value === 0) {
          live.value = [...live.value, { x: (e.x - tx.value) / sc.value, y: (e.y - ty.value) / sc.value }];
        } else {
          tx.value = stx.value + e.translationX;
          ty.value = sty.value + e.translationY;
        }
      })
      .onEnd(() => {
        'worklet';
        if (modeSV.value === 0) {
          const pts = live.value;
          live.value = [];
          runOnJS(commitLocalStroke)(pts);
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const twoPan = useMemo(() =>
    Gesture.Pan()
      .minPointers(2)
      .maxPointers(2)
      .onBegin(() => { 'worklet'; stx.value = tx.value; sty.value = ty.value; })
      .onUpdate((e) => { 'worklet'; tx.value = stx.value + e.translationX; ty.value = sty.value + e.translationY; }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const pinch = useMemo(() =>
    Gesture.Pinch()
      .onBegin(() => { 'worklet'; ssc.value = sc.value; stx.value = tx.value; sty.value = ty.value; })
      .onUpdate((e) => {
        'worklet';
        const ns = Math.max(MIN_S, Math.min(MAX_S, ssc.value * e.scale));
        const lx = (e.focalX - stx.value) / ssc.value;
        const ly = (e.focalY - sty.value) / ssc.value;
        sc.value = ns;
        tx.value = e.focalX - lx * ns;
        ty.value = e.focalY - ly * ns;
      })
      .onEnd(() => { 'worklet'; runOnJS(setZoomLabel)(Math.round(sc.value * 100)); }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const selectTap = useMemo(() =>
    Gesture.Tap().maxDistance(12).onEnd((e) => { 'worklet'; runOnJS(handleTap)(e.x, e.y); }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const gesture = useMemo(
    () => Gesture.Simultaneous(selectTap, Gesture.Race(oneFinger, Gesture.Simultaneous(twoPan, pinch))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // live stroke path, rebuilt on the UI thread
  const livePath = useDerivedValue(() => {
    const p = Skia.Path.Make();
    const pts = live.value;
    if (pts.length > 0) {
      p.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    }
    return p;
  });

  const pageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: sc.value }],
  }));

  const zoomBy = (factor: number) => {
    const vp = viewport;
    if (!vp) return;
    const cx = vp.width / 2;
    const cy = vp.height / 2;
    const c = { scale: sc.value, tx: tx.value, ty: ty.value };
    const ns = Math.max(MIN_S, Math.min(MAX_S, c.scale * factor));
    const lx = (cx - c.tx) / c.scale;
    const ly = (cy - c.ty) / c.scale;
    sc.value = withTiming(ns, { duration: 140 });
    tx.value = withTiming(cx - lx * ns, { duration: 140 });
    ty.value = withTiming(cy - ly * ns, { duration: 140 });
    setZoomLabel(Math.round(ns * 100));
  };
  const resetZoom = () => { sc.value = withTiming(1); tx.value = withTiming(0); ty.value = withTiming(0); setZoomLabel(100); };

  const Pdf = detectExpoGo() ? null : require('react-native-pdf').default;

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
        <Pressable style={[styles.btn, mode === 'draw' && styles.on]} onPress={() => { setMode('draw'); setSelectedId(null); }}><Text style={[styles.btnT, mode === 'draw' && styles.onT]}>✏️</Text></Pressable>
        <Pressable style={[styles.btn, mode === 'select' && styles.on]} onPress={() => setMode('select')}><Text style={[styles.btnT, mode === 'select' && styles.onT]}>☞</Text></Pressable>
        <Pressable style={[styles.btn, mode === 'pan' && styles.on]} onPress={() => { setMode('pan'); setSelectedId(null); }}><Text style={[styles.btnT, mode === 'pan' && styles.onT]}>✋</Text></Pressable>
        <Pressable style={styles.btn} onPress={() => zoomBy(1 / 1.4)}><Text style={styles.btnT}>－</Text></Pressable>
        <Pressable style={styles.btn} onPress={() => zoomBy(1.4)}><Text style={styles.btnT}>＋</Text></Pressable>
        <Pressable style={styles.btn} onPress={resetZoom}><Text style={styles.btnT}>⤢</Text></Pressable>
        {selectedId ? (
          <Pressable style={styles.del} onPress={() => { setStrokes((s) => s.filter((x) => x.id !== selectedId)); setSelectedId(null); }}><Text style={styles.clearT}>Delete</Text></Pressable>
        ) : (
          <Pressable style={styles.del} onPress={() => { setStrokes([]); live.value = []; setSelectedId(null); }}><Text style={styles.clearT}>Clear</Text></Pressable>
        )}
      </View>
      <Text style={styles.hud}>zoom {zoomLabel}% · {strokes.length} strokes{selectedId ? ' · 1 selected' : ''} · {mode === 'draw' ? '1-finger draws' : mode === 'select' ? 'tap a stroke' : '1-finger pans'} · 2-finger pans/zooms · UI-thread</Text>

      <View style={styles.stage} onLayout={(e) => setViewport(e.nativeEvent.layout)}>
        <GestureDetector gesture={gesture}>
          <View style={StyleSheet.absoluteFill} collapsable={false}>
            <Animated.View style={[base ? { width: base.w, height: base.h } : StyleSheet.absoluteFillObject, styles.page, pageStyle]}>
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <Pdf
                  source={{ uri: PDF_URL, cache: true }}
                  singlePage
                  scale={1}
                  onLoadComplete={(_n: number, _p: string, size: { width: number; height: number }) => setNat({ w: size.width, h: size.height })}
                  style={StyleSheet.absoluteFill}
                />
              </View>
              {base && (
                <Canvas style={StyleSheet.absoluteFill}>
                  {strokes.map((s) => (
                    <React.Fragment key={s.id}>
                      {s.id === selectedId && (
                        <Path path={strokeToLocalSvg(s, base.w, base.h)} style="stroke" strokeWidth={s.width + 7} color="#E0A22B" opacity={0.45} strokeJoin="round" strokeCap="round" />
                      )}
                      <Path path={strokeToLocalSvg(s, base.w, base.h)} style="stroke" strokeWidth={s.width} color={s.color} strokeJoin="round" strokeCap="round" />
                    </React.Fragment>
                  ))}
                  <Path path={livePath} style="stroke" strokeWidth={3} color="#D9534F" strokeJoin="round" strokeCap="round" />
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
      <Text style={styles.title}>🏗️ AnnotatablePdf</Text>
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
  del: { paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#3a2226', borderRadius: 7, marginLeft: 'auto' },
  clearT: { color: '#D9534F', fontSize: 12, fontWeight: '700' },
  hud: { color: '#A8B0BF', fontSize: 11, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#1A1E25' },
  stage: { flex: 1, backgroundColor: '#0E1116', overflow: 'hidden' },
  page: { position: 'absolute', left: 0, top: 0, transformOrigin: 'top left', backgroundColor: '#fff' },
  notice: { margin: 16, padding: 16, backgroundColor: '#24272D', borderRadius: 10 },
  noticeBody: { color: '#D6DBE3', fontSize: 13, lineHeight: 20 },
});
