/**
 * AnnotatablePdf — PRODUCTION FOUNDATION (Approach B).
 *
 * The <Pdf/> render layer (touches disabled) AND the Skia ink layer live in ONE
 * Reanimated-transformed container, so they move as a single unit = zero lag,
 * perfectly glued under zoom/pan. (Ink softens slightly at deep zoom because the
 * layer is bitmap-scaled; crisp-AND-synced would require rendering the PDF into
 * Skia too — a later step. Synced+smooth was the right call over crisp.)
 *
 * Transform + live ink run on the UI thread (Reanimated worklets + react-native-
 * skia). CORE LAW: 1 finger = tool action, 2 fingers always pan+pinch; a stroke
 * interrupted by a 2nd finger is discarded. Strokes stored NORMALIZED. Tap-select
 * + Delete. No-flicker commit + focal-jump guard kept.
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
const MAX_S = 8; // capped — 14x was crashing on the bitmap-scaled page
const HIT_PX = 22;
const FOCAL_JUMP = 60; // one-frame focal lurch (finger lift) guard, screen px

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

  // UI-thread state
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sc = useSharedValue(1);
  const stx = useSharedValue(0);
  const sty = useSharedValue(0);
  const ssc = useSharedValue(1);
  const oLocalX = useSharedValue(0);
  const oLocalY = useSharedValue(0);
  const lastFx = useSharedValue(0);
  const lastFy = useSharedValue(0);
  const live = useSharedValue<{ x: number; y: number }[]>([]);
  const committed = useSharedValue(false);
  const drawGen = useSharedValue(0);
  const modeSV = useSharedValue(0); // 0 draw, 1 select, 2 pan
  useEffect(() => {
    modeSV.value = mode === 'draw' ? 0 : mode === 'select' ? 1 : 2;
  }, [mode, modeSV]);

  const commitLocalStroke = (pts: { x: number; y: number }[], gen: number) => {
    const b = baseRef.current;
    if (b && pts.length >= 2) {
      const norm = pts.map((p) => clampNorm(localToNorm(p.x, p.y, b.w, b.h)));
      setStrokes((s) => [...s, { id: newStrokeId(), color: '#2B6FB6', width: 3, pts: norm }]);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => { if (drawGen.value === gen) live.value = []; }));
  };
  const handleTap = (sx: number, sy: number) => {
    if (modeSV.value !== 1) return;
    const b = baseRef.current;
    if (!b) return;
    setSelectedId(pickStroke(strokesRef.current, sx, sy, b.w, b.h, { scale: sc.value, tx: tx.value, ty: ty.value }, HIT_PX));
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
          committed.value = false;
          drawGen.value = drawGen.value + 1;
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
          committed.value = true;
          runOnJS(commitLocalStroke)(live.value, drawGen.value);
        }
      })
      .onFinalize(() => {
        'worklet';
        if (modeSV.value === 0 && !committed.value) live.value = []; // interrupted by 2nd finger → discard
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const pinch = useMemo(() =>
    Gesture.Pinch()
      .onBegin((e) => {
        'worklet';
        ssc.value = sc.value;
        oLocalX.value = (e.focalX - tx.value) / sc.value;
        oLocalY.value = (e.focalY - ty.value) / sc.value;
        lastFx.value = e.focalX;
        lastFy.value = e.focalY;
      })
      .onUpdate((e) => {
        'worklet';
        const dfx = e.focalX - lastFx.value;
        const dfy = e.focalY - lastFy.value;
        lastFx.value = e.focalX;
        lastFy.value = e.focalY;
        if (Math.abs(dfx) > FOCAL_JUMP || Math.abs(dfy) > FOCAL_JUMP) return;
        const ns = Math.max(MIN_S, Math.min(MAX_S, ssc.value * e.scale));
        sc.value = ns;
        tx.value = e.focalX - oLocalX.value * ns;
        ty.value = e.focalY - oLocalY.value * ns;
      })
      .onEnd(() => { 'worklet'; runOnJS(setZoomLabel)(Math.round(sc.value * 100)); }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const selectTap = useMemo(() =>
    Gesture.Tap().maxDistance(12).onEnd((e) => { 'worklet'; runOnJS(handleTap)(e.x, e.y); }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const gesture = useMemo(
    () => Gesture.Simultaneous(selectTap, oneFinger, pinch),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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
    const ns = Math.max(MIN_S, Math.min(MAX_S, sc.value * factor));
    const lx = (cx - tx.value) / sc.value;
    const ly = (cy - ty.value) / sc.value;
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
      <Text style={styles.hud}>zoom {zoomLabel}% · {strokes.length} strokes{selectedId ? ' · 1 selected' : ''} · {mode === 'draw' ? '1-finger draws' : mode === 'select' ? 'tap a stroke' : '1-finger pans'} · 2-finger pans/zooms</Text>

      <View style={styles.stage} onLayout={(e) => setViewport(e.nativeEvent.layout)}>
        <GestureDetector gesture={gesture}>
          <View style={StyleSheet.absoluteFill} collapsable={false}>
            {/* PDF + ink in ONE transformed container → move as a single unit (no desync) */}
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
                <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
                  {strokes.map((s) => (
                    <React.Fragment key={s.id}>
                      {s.id === selectedId && (
                        <Path path={strokeToLocalSvg(s, base.w, base.h)} style="stroke" strokeWidth={s.width + 7} color="#E0A22B" opacity={0.45} strokeJoin="round" strokeCap="round" />
                      )}
                      <Path path={strokeToLocalSvg(s, base.w, base.h)} style="stroke" strokeWidth={s.width} color={s.color} strokeJoin="round" strokeCap="round" />
                    </React.Fragment>
                  ))}
                  <Path path={livePath} style="stroke" strokeWidth={3} color="#2B6FB6" strokeJoin="round" strokeCap="round" />
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
