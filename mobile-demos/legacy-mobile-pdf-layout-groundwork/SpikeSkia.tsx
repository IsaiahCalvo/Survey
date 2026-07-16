/**
 * SPIKE 2 — react-native-skia ink layer over a react-native-pdf page (THROWAWAY).
 * Goal: prove the layered architecture from the renderer research —
 *   [ Skia <Canvas> ink overlay ]  on top of  [ <Pdf/> native render ]
 * and that draw (1-finger, RNGH) vs PDF pan/zoom coexist via an explicit mode.
 * Dev-build only (react-native-pdf native module; lazy-required + Expo Go guard).
 *
 * SCOPE (simulator): proves Skia renders ink over the PDF + clean Draw/Pan mode
 * switch. NOT proven here (needs a real device / next step): true pen *latency*
 * (would use Reanimated worklets), and ink staying aligned to the PDF under
 * pan/zoom (overlay transform must be synced to the page host — real-app work).
 */
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Canvas, Path } from '@shopify/react-native-skia';

const PDF_URL =
  'https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf';

function detectExpoGo(): boolean {
  try {
    return require('expo-constants').default?.executionEnvironment === 'storeClient';
  } catch {
    return false;
  }
}
const toSvg = (pts: { x: number; y: number }[]) =>
  pts.length ? 'M' + pts.map((p, i) => `${i ? 'L' : ''}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') : '';

export default function SpikeSkia({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'draw' | 'pan'>('draw');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [strokes, setStrokes] = useState<string[]>([]);
  const [live, setLive] = useState<string | null>(null);
  const cur = useRef<{ x: number; y: number }[]>([]);

  const Header = (
    <View style={styles.header}>
      <Text style={styles.title}>🎨 Spike 2 · Skia ink over PDF</Text>
      <Pressable onPress={onClose} style={styles.close} hitSlop={8}>
        <Text style={styles.closeText}>Close ✕</Text>
      </Pressable>
    </View>
  );

  if (detectExpoGo()) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {Header}
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Needs the custom dev build</Text>
          <Text style={styles.noticeBody}>react-native-pdf isn’t in Expo Go. Build with{'\n'}npx expo run:ios</Text>
        </View>
      </View>
    );
  }

  const Pdf = require('react-native-pdf').default;

  const draw = Gesture.Pan()
    .maxPointers(1)
    .enabled(mode === 'draw')
    .runOnJS(true)
    .onBegin((e) => {
      cur.current = [{ x: e.x, y: e.y }];
      setLive(toSvg(cur.current));
    })
    .onUpdate((e) => {
      cur.current.push({ x: e.x, y: e.y });
      setLive(toSvg(cur.current));
    })
    .onEnd(() => {
      if (cur.current.length > 1) {
        const path = toSvg(cur.current);
        setStrokes((s) => [...s, path]);
      }
      cur.current = [];
      setLive(null);
    });

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {Header}
      <View style={styles.bar}>
        <Pressable
          style={[styles.modeBtn, mode === 'draw' && styles.modeOn]}
          onPress={() => setMode('draw')}
        >
          <Text style={[styles.modeText, mode === 'draw' && styles.modeTextOn]}>✏️ Draw (1-finger)</Text>
        </Pressable>
        <Pressable
          style={[styles.modeBtn, mode === 'pan' && styles.modeOn]}
          onPress={() => setMode('pan')}
        >
          <Text style={[styles.modeText, mode === 'pan' && styles.modeTextOn]}>✋ Pan PDF</Text>
        </Pressable>
        <Pressable style={styles.clear} onPress={() => { setStrokes([]); setLive(null); }}>
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>
        <Text style={styles.count}>{strokes.length} strokes</Text>
      </View>
      <Text style={styles.hint}>
        Draw mode: 1-finger draws Skia ink over the PDF. Pan mode: touches pass through to the PDF (scroll/pinch).
      </Text>

      <View style={styles.stage}>
        {/* render layer */}
        <Pdf source={{ uri: PDF_URL, cache: true }} style={StyleSheet.absoluteFill} />
        {/* ink overlay — pass-through in pan mode so the PDF gets the touches */}
        <View style={StyleSheet.absoluteFill} pointerEvents={mode === 'draw' ? 'auto' : 'none'}>
          <GestureDetector gesture={draw}>
            <Canvas style={StyleSheet.absoluteFill}>
              {strokes.map((p, i) => (
                <Path key={i} path={p} style="stroke" strokeWidth={3} color="#2B6FB6" strokeJoin="round" strokeCap="round" />
              ))}
              {live && <Path path={live} style="stroke" strokeWidth={3} color="#D9534F" strokeJoin="round" strokeCap="round" />}
            </Canvas>
          </GestureDetector>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: '#15171C', zIndex: 1000 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#202126',
    borderBottomWidth: 1, borderBottomColor: '#090A0D',
  },
  title: { color: '#F2F2F2', fontWeight: '700', fontSize: 15 },
  close: { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#2A2D34', borderRadius: 6 },
  closeText: { color: '#F2F2F2', fontSize: 12, fontWeight: '600' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#202126' },
  modeBtn: { paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#2A2D34', borderRadius: 7, borderWidth: 1, borderColor: '#323844' },
  modeOn: { backgroundColor: '#132235', borderColor: '#2B6FB6' },
  modeText: { color: '#A8B0BF', fontSize: 12, fontWeight: '600' },
  modeTextOn: { color: '#F2F2F2' },
  clear: { paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#3a2226', borderRadius: 7 },
  clearText: { color: '#D9534F', fontSize: 12, fontWeight: '700' },
  count: { color: '#A8B0BF', fontSize: 12, marginLeft: 'auto' },
  hint: { color: '#A8B0BF', fontSize: 11, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#1A1E25' },
  stage: { flex: 1, backgroundColor: '#0E1116' },
  notice: { margin: 16, padding: 16, backgroundColor: '#24272D', borderRadius: 10, borderWidth: 1, borderColor: '#323844' },
  noticeTitle: { color: '#E0A22B', fontSize: 15, fontWeight: '700', marginBottom: 8 },
  noticeBody: { color: '#D6DBE3', fontSize: 13, lineHeight: 20 },
});
