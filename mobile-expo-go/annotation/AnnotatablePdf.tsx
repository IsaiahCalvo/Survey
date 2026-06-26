/**
 * AnnotatablePdf — APPROACH C (PDF rendered INTO Skia, re-raster on settle).
 *
 * The native <Pdf> view is GONE. A custom Swift module (modules/pdf-rasterizer)
 * rasterizes the page to PNG bytes; JS uploads them as an SkImage and draws the
 * page image AND the vector ink as children of ONE Skia <Canvas> under ONE shared
 * <Group transform>. The page and ink are composited in a single draw call under
 * one matrix, so spatial desync is physically impossible (the desktop pdf.js model
 * on mobile). During a pinch only the Reanimated shared values change (GPU-cheap,
 * slightly soft); on pinch.onEnd we re-rasterize at the new scale and swap in a
 * crisp SkImage. Raster scale is CAPPED at SAFE px/side so deep zoom softens
 * gracefully instead of crashing the old bitmap-scaled GPU texture.
 *
 * Requires the dev build (custom native module — NOT Expo Go). Coordinate model,
 * NORMALIZED strokes, tap-select + delete, and the "1 finger = tool / 2 fingers =
 * pan+pinch" core law are unchanged (see pdfAnnotation.ts).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutRectangle, PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  runOnJS,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  Canvas,
  FilterMode,
  Group,
  Image as SkiaImage,
  MipmapMode,
  Path,
  Rect,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';
import {
  clampNorm,
  localToNorm,
  newStrokeId,
  pickStroke,
  rasterScaleFor,
  strokeToLocalSvg,
  type Stroke,
} from './pdfAnnotation';

const PDF_URL =
  'https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf';
const MIN_S = 0.5;
const MAX_S = 8; // display zoom; raster is capped separately (SAFE) so this no longer crashes
const HIT_PX = 22;
const FOCAL_JUMP = 80; // one-frame focal lurch guard (px); a fast pan moves ~40-50px/frame
const SAFE = 4096; // max raster px/side — ~67 MB RGBA, comfortable on A14+; beyond this, soften
const DPR = PixelRatio.get();
const RASTER_DEBOUNCE_MS = 90;

// Load the native module lazily so Expo Go (no module) shows the notice instead of crashing.
let PdfRasterizer: typeof import('../modules/pdf-rasterizer').default | null = null;
try {
  PdfRasterizer = require('../modules/pdf-rasterizer').default;
} catch {
  PdfRasterizer = null;
}

let ReactNativeBlobUtil: typeof import('react-native-blob-util').default | null = null;
try {
  ReactNativeBlobUtil = require('react-native-blob-util').default;
} catch {
  ReactNativeBlobUtil = null;
}

/** Download the PDF once to a local file and return a file:// URI the module can open. */
async function downloadPdf(url: string): Promise<string> {
  if (!ReactNativeBlobUtil) throw new Error('react-native-blob-util unavailable (need dev build)');
  // ponytail: blob-util cache filenames are space-free, so no URL-encoding needed for the spike.
  const res = await ReactNativeBlobUtil.config({ fileCache: true, appendExt: 'pdf' }).fetch('GET', url);
  return 'file://' + res.path();
}

export default function AnnotatablePdf({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'draw' | 'select' | 'pan'>('draw');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<LayoutRectangle | null>(null);
  const [pagePts, setPagePts] = useState<{ w: number; h: number } | null>(null); // page size in points
  const [pageImage, setPageImage] = useState<SkImage | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const [zoomLabel, setZoomLabel] = useState(100);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // ponytail: throwaway diagnostics for the "ink blurry at zoom" investigation. JS-only
  // (Fast-Refreshes, no native rebuild). showPdf=off isolates whether the 87MB texture's
  // memory pressure is what softens everything; thinInk shrinks the stroke to tell a real
  // blur apart from a fat-stroke-reads-as-soft perception. Delete once root cause is known.
  const [showPdf, setShowPdf] = useState(true);
  const [thinInk, setThinInk] = useState(false);
  const inkW = thinInk ? 0.6 : 3;
  const [rasterMs, setRasterMs] = useState(0);
  const [fpsLabel, setFpsLabel] = useState(0);
  const fps = useSharedValue(0);
  // EMA of the live frame rate (UI thread) — drops visibly when a zoom janks.
  useFrameCallback((fi) => {
    'worklet';
    const dt = fi.timeSincePreviousFrame;
    if (dt && dt > 0) fps.value = fps.value ? fps.value * 0.9 + (1000 / dt) * 0.1 : 1000 / dt;
  });
  useEffect(() => {
    const id = setInterval(() => setFpsLabel(Math.round(fps.value)), 500);
    return () => clearInterval(id);
  }, [fps]);

  // base = the page laid out fit-to-width at zoom 1 (LOCAL/page space, screen px).
  const base = useMemo(() => {
    if (!viewport || !pagePts) return null;
    const w = viewport.width;
    return { w, h: w * (pagePts.h / pagePts.w) };
  }, [viewport, pagePts]);
  const baseRef = useRef(base);
  baseRef.current = base;
  const pagePtsRef = useRef(pagePts);
  pagePtsRef.current = pagePts;
  const localUriRef = useRef<string | null>(null);

  // UI-thread state (screen = (tx,ty) + sc * local; see pdfAnnotation.ts)
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

  // ---- rasterize (JS thread): re-render the page crisply at the settled zoom ----
  const rasterSeq = useRef(0);
  const lastRasterScale = useRef(0);
  const rasterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doRasterize = useCallback(async (displayScale: number) => {
    const b = baseRef.current;
    const pts = pagePtsRef.current;
    const uri = localUriRef.current;
    if (!b || !pts || !uri || !PdfRasterizer) return;
    const rScale = rasterScaleFor(displayScale, b.w, pts.w, pts.h, DPR, SAFE);
    // Skip re-raster when the scale barely moved (e.g. a pan that didn't change zoom).
    if (lastRasterScale.current && Math.abs(rScale - lastRasterScale.current) / lastRasterScale.current < 0.04) return;
    const seq = ++rasterSeq.current;
    try {
      const t0 = Date.now();
      const bytes = await PdfRasterizer.rasterizePage(uri, 0, rScale);
      // Instrumentation for the device investigation — shows in the Metro console.
      console.log(
        `[raster] sc=${displayScale.toFixed(2)} rScale=${rScale.toFixed(2)} ` +
        `px=${Math.round(pts.w * rScale)}x${Math.round(pts.h * rScale)} ` +
        `bytes=${(bytes.length / 1e6).toFixed(1)}MB took=${Date.now() - t0}ms`,
      );
      setRasterMs(Date.now() - t0);
      if (seq !== rasterSeq.current) return; // superseded by a newer raster
      // PNG decode is lazy (deferred to first GPU draw), so do NOT dispose `data` here —
      // let GC reclaim it and the previous SkImage. Manual dispose is a Phase-4 memory
      // opt (two-slot cap, §3.5) once a device shows real growth; premature dispose risks
      // a use-after-free.
      const data = Skia.Data.fromBytes(bytes);
      const img = Skia.Image.MakeImageFromEncoded(data);
      if (img) {
        lastRasterScale.current = rScale;
        setPageImage(img); // React swaps cleanly on the next render
      }
    } catch (e) {
      console.warn('[AnnotatablePdf] rasterizePage failed', e);
    }
  }, []);

  const triggerRasterize = useCallback((displayScale: number) => {
    if (rasterTimer.current) clearTimeout(rasterTimer.current);
    rasterTimer.current = setTimeout(() => { void doRasterize(displayScale); }, RASTER_DEBOUNCE_MS);
  }, [doRasterize]);

  // Open the PDF (download -> native open -> page size) once.
  useEffect(() => {
    if (!PdfRasterizer) return;
    let alive = true;
    (async () => {
      try {
        const path = await downloadPdf(PDF_URL);
        if (!alive) return;
        await PdfRasterizer!.openDocument(path);
        const size = await PdfRasterizer!.getPageSize(path, 0);
        if (!alive) return;
        localUriRef.current = path;
        setPagePts({ w: size.width, h: size.height });
      } catch (e) {
        if (alive) setLoadErr(String(e));
      }
    })();
    return () => { alive = false; };
  }, []);

  // First crisp raster once the page is laid out (base known) at the current zoom.
  useEffect(() => {
    if (base && pagePts && localUriRef.current) void doRasterize(sc.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, pagePts]);

  useEffect(() => () => { if (rasterTimer.current) clearTimeout(rasterTimer.current); }, []);

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
      .averageTouches(true) // centroid stays stable across a 1<->2 finger transition (§4)
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
        if (modeSV.value === 0 && !committed.value) live.value = []; // interrupted by 2nd finger -> discard
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  // §4 pinch-jump fix: on a focal teleport, RE-PIN the local origin at the new focal
  // (page doesn't move that frame) instead of returning with a stale origin.
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
        if (Math.abs(dfx) > FOCAL_JUMP || Math.abs(dfy) > FOCAL_JUMP) {
          oLocalX.value = (e.focalX - tx.value) / sc.value;
          oLocalY.value = (e.focalY - ty.value) / sc.value;
          ssc.value = sc.value;
          lastFx.value = e.focalX;
          lastFy.value = e.focalY;
          return;
        }
        lastFx.value = e.focalX;
        lastFy.value = e.focalY;
        const ns = Math.max(MIN_S, Math.min(MAX_S, ssc.value * e.scale));
        sc.value = ns;
        tx.value = e.focalX - oLocalX.value * ns;
        ty.value = e.focalY - oLocalY.value * ns;
      })
      .onEnd(() => {
        'worklet';
        runOnJS(setZoomLabel)(Math.round(sc.value * 100));
        runOnJS(triggerRasterize)(sc.value);
      })
      .onFinalize(() => { 'worklet'; ssc.value = sc.value; }), // clean base for the next pinch
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

  // ---- Skia draw tree: ONE transform shared by the page image AND the ink ----
  const transform = useDerivedValue(() => [
    { translateX: tx.value },
    { translateY: ty.value },
    { scale: sc.value },
  ]);

  const livePath = useDerivedValue(() => {
    const p = Skia.Path.Make();
    const pts = live.value;
    if (pts.length > 0) {
      p.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    }
    return p;
  });

  const zoomBy = (factor: number) => {
    const vp = viewport;
    if (!vp) return;
    const cx = vp.width / 2;
    const cy = vp.height / 2;
    const ns = Math.max(MIN_S, Math.min(MAX_S, sc.value * factor));
    const lx = (cx - tx.value) / sc.value;
    const ly = (cy - ty.value) / sc.value;
    sc.value = withTiming(ns, { duration: 140 }, (fin) => { 'worklet'; if (fin) runOnJS(triggerRasterize)(ns); });
    tx.value = withTiming(cx - lx * ns, { duration: 140 });
    ty.value = withTiming(cy - ly * ns, { duration: 140 });
    setZoomLabel(Math.round(ns * 100));
  };
  const resetZoom = () => {
    sc.value = withTiming(1, undefined, (fin) => { 'worklet'; if (fin) runOnJS(triggerRasterize)(1); });
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    setZoomLabel(100);
  };

  if (!PdfRasterizer) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Header onClose={onClose} />
        <View style={styles.notice}>
          <Text style={styles.noticeBody}>
            Approach C needs the custom native PdfRasterizer module — rebuild the dev build with
            {'\n'}`npx expo run:ios --device`. (Not available in Expo Go.)
          </Text>
        </View>
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
        <Pressable style={[styles.btn, !showPdf && styles.on]} onPress={() => setShowPdf((v) => !v)}><Text style={[styles.btnT, !showPdf && styles.onT]}>PDF</Text></Pressable>
        <Pressable style={[styles.btn, thinInk && styles.on]} onPress={() => setThinInk((v) => !v)}><Text style={[styles.btnT, thinInk && styles.onT]}>thin</Text></Pressable>
        {selectedId ? (
          <Pressable style={styles.del} onPress={() => { setStrokes((s) => s.filter((x) => x.id !== selectedId)); setSelectedId(null); }}><Text style={styles.clearT}>Delete</Text></Pressable>
        ) : (
          <Pressable style={styles.del} onPress={() => { setStrokes([]); live.value = []; setSelectedId(null); }}><Text style={styles.clearT}>Clear</Text></Pressable>
        )}
      </View>
      <Text style={styles.hud}>{fpsLabel}fps · raster {rasterMs}ms · zoom {zoomLabel}% · ink ≈{Math.round(inkW * zoomLabel / 100)}px · {strokes.length} strokes{showPdf ? '' : ' · PDF off'} · {mode === 'draw' ? 'draw' : mode === 'select' ? 'select' : 'pan'}</Text>

      <View style={styles.stage} onLayout={(e) => setViewport(e.nativeEvent.layout)}>
        <GestureDetector gesture={gesture}>
          <View style={StyleSheet.absoluteFill} collapsable={false}>
            {base ? (
              <Canvas style={StyleSheet.absoluteFill}>
                {/* ONE transform → page image and ink composited under the same matrix (sync is structural) */}
                <Group transform={transform}>
                  <Rect x={0} y={0} width={base.w} height={base.h} color="#FFFFFF" />
                  {showPdf && pageImage && (
                    <SkiaImage
                      image={pageImage}
                      x={0}
                      y={0}
                      width={base.w}
                      height={base.h}
                      fit="fill"
                      sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.None }}
                    />
                  )}
                  {strokes.map((s) => (
                    <React.Fragment key={s.id}>
                      {s.id === selectedId && (
                        <Path path={strokeToLocalSvg(s, base.w, base.h)} style="stroke" strokeWidth={inkW + 7} color="#E0A22B" opacity={0.45} strokeJoin="round" strokeCap="round" />
                      )}
                      <Path path={strokeToLocalSvg(s, base.w, base.h)} style="stroke" strokeWidth={inkW} color={s.color} strokeJoin="round" strokeCap="round" />
                    </React.Fragment>
                  ))}
                  <Path path={livePath} style="stroke" strokeWidth={inkW} color="#2B6FB6" strokeJoin="round" strokeCap="round" />
                </Group>
              </Canvas>
            ) : (
              <View style={styles.center}><Text style={styles.noticeBody}>{loadErr ? `Load failed: ${loadErr}` : 'Loading page…'}</Text></View>
            )}
          </View>
        </GestureDetector>
      </View>
    </View>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>🏗️ AnnotatablePdf · Approach C</Text>
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
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  notice: { margin: 16, padding: 16, backgroundColor: '#24272D', borderRadius: 10 },
  noticeBody: { color: '#D6DBE3', fontSize: 13, lineHeight: 20 },
});
