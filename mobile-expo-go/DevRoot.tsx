/**
 * DevRoot — wraps the real App with throwaway dev overlays:
 *   🧪  Gesture Sandbox (works in Expo Go AND the dev build)
 *   📄  Spike 1: react-native-pdf renderer test (dev build only)
 * App.tsx is NOT modified; point index.ts back at App to drop all of this.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import App from './App';
import GestureSandbox from './GestureSandbox';
import SpikeRenderer from './SpikeRenderer';
import SpikeSkia from './SpikeSkia';
import AnnotatablePdf from './annotation/AnnotatablePdf';

type Overlay = 'none' | 'sandbox' | 'spike' | 'skia' | 'build';

export default function DevRoot() {
  const [overlay, setOverlay] = useState<Overlay>('none');
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <App />
        {overlay === 'none' && (
          <View style={styles.fabStack} pointerEvents="box-none">
            <Pressable style={styles.fab} onPress={() => setOverlay('sandbox')} hitSlop={8}>
              <Text style={styles.fabText}>🧪</Text>
            </Pressable>
            <Pressable style={[styles.fab, styles.fabSpike]} onPress={() => setOverlay('spike')} hitSlop={8}>
              <Text style={styles.fabText}>📄</Text>
            </Pressable>
            <Pressable style={[styles.fab, styles.fabSkia]} onPress={() => setOverlay('skia')} hitSlop={8}>
              <Text style={styles.fabText}>🎨</Text>
            </Pressable>
            <Pressable style={[styles.fab, styles.fabBuild]} onPress={() => setOverlay('build')} hitSlop={8}>
              <Text style={styles.fabText}>🏗️</Text>
            </Pressable>
          </View>
        )}
        {overlay === 'sandbox' && <GestureSandbox onClose={() => setOverlay('none')} />}
        {overlay === 'spike' && <SpikeRenderer onClose={() => setOverlay('none')} />}
        {overlay === 'skia' && <SpikeSkia onClose={() => setOverlay('none')} />}
        {overlay === 'build' && <AnnotatablePdf onClose={() => setOverlay('none')} />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fabStack: { position: 'absolute', right: 14, top: 130, gap: 12, alignItems: 'flex-end', zIndex: 99999 },
  fabSpike: { backgroundColor: '#E0A22B' },
  fabSkia: { backgroundColor: '#46B26B' },
  fabBuild: { backgroundColor: '#8E6FD0' },
  fab: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#2B6FB6',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 8,
  },
  fabText: { fontSize: 22 },
});
