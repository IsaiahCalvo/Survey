/**
 * SPIKE 1 — react-native-pdf renderer sanity check (THROWAWAY).
 * Goal: confirm react-native-pdf actually RENDERS on a physical iPhone with
 * New Architecture ON (RN 0.81) — the #1 adoption risk flagged in
 * docs/superpowers/specs/2026-06-24-mobile-pdf-renderer-research.md (open
 * blank-view bugs #942/#969). Works ONLY in a CUSTOM DEV BUILD — react-native-pdf
 * is not in Expo Go (we lazy-require it + guard so Expo Go doesn't crash).
 * Delete once the renderer decision is locked.
 *
 * Diagnostic: status reads page count from onLoadComplete. If it says
 * "loaded N pages" but the area below is BLANK → that's the New-Arch blank-view
 * bug → fall back to react-native-pdf-light v3.x or react-native-pdf-renderer.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// 14-page Mozilla pdf.js test doc (stable). Paste your own floor-plan URL to test a real file.
const DEFAULT_URL =
  'https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf';

const fabricOn = !!(global as any)?.nativeFabricUIManager; // true == New Architecture active

// Expo Go has no native PDF module — detect it so we show a notice instead of crashing.
function detectExpoGo(): boolean {
  try {
    const Constants = require('expo-constants').default;
    return Constants?.executionEnvironment === 'storeClient';
  } catch {
    return false; // assume dev build
  }
}

export default function SpikeRenderer({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState(DEFAULT_URL);
  const [src, setSrc] = useState(DEFAULT_URL);
  const [status, setStatus] = useState('loading…');
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const expoGo = detectExpoGo();

  const Header = (
    <View style={styles.header}>
      <Text style={styles.title}>📄 Spike 1 · react-native-pdf</Text>
      <Pressable onPress={onClose} style={styles.close} hitSlop={8}>
        <Text style={styles.closeText}>Close ✕</Text>
      </Pressable>
    </View>
  );

  if (expoGo) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {Header}
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Needs the custom dev build</Text>
          <Text style={styles.noticeBody}>
            react-native-pdf is a native module and isn’t in Expo Go. Build the dev client first:
            {'\n\n'}npx expo run:ios --device{'\n'}(or eas build -p ios --profile development)
            {'\n\n'}then open this Spike from the dev build to test rendering.
          </Text>
        </View>
      </View>
    );
  }

  const Pdf = require('react-native-pdf').default; // lazy — only in the dev build

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {Header}

      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          Fabric / New Arch: <Text style={fabricOn ? styles.ok : styles.err}>{fabricOn ? 'ON ✓' : 'OFF ✗'}</Text>
        </Text>
        <Text style={[styles.bannerText, err ? styles.err : pages > 0 ? styles.ok : styles.muted]}>
          {err ? `ERROR: ${err}` : pages > 0 ? `loaded ✓ ${pages} pages (on page ${page || 1})` : status}
        </Text>
        <Text style={styles.hint}>
          PDF below → ✅ renderer works. BLANK below while status says “loaded N pages” → New-Arch blank-view bug.
        </Text>
      </View>

      <View style={styles.urlRow}>
        <TextInput
          style={styles.urlField}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="PDF url"
          placeholderTextColor="#6B7280"
        />
        <Pressable
          style={styles.go}
          onPress={() => {
            setErr(null);
            setPages(0);
            setPage(0);
            setStatus('loading…');
            setSrc(url.trim());
          }}
        >
          <Text style={styles.goText}>Load</Text>
        </Pressable>
      </View>

      <Pdf
        key={src}
        source={{ uri: src, cache: true }}
        onLoadComplete={(numberOfPages: number) => {
          setPages(numberOfPages);
          setStatus(`loaded ${numberOfPages} pages`);
        }}
        onPageChanged={(p: number, n: number) => {
          setPage(p);
          setPages(n);
        }}
        onError={(e: unknown) => setErr(String((e as any)?.message ?? e))}
        onLoadProgress={(pct: number) => setStatus(`loading ${Math.round(pct * 100)}%`)}
        style={styles.pdf}
      />
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
  banner: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#1A1E25', gap: 3 },
  bannerText: { color: '#F2F2F2', fontSize: 13, fontWeight: '500' },
  hint: { color: '#A8B0BF', fontSize: 11, marginTop: 2 },
  ok: { color: '#46B26B', fontWeight: '700' },
  err: { color: '#D9534F', fontWeight: '700' },
  muted: { color: '#A8B0BF' },
  urlRow: { flexDirection: 'row', gap: 6, padding: 8, backgroundColor: '#202126' },
  urlField: {
    flex: 1, backgroundColor: '#15171C', color: '#F2F2F2', paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 6, borderWidth: 1, borderColor: '#323844', fontSize: 12,
  },
  go: { backgroundColor: '#2B6FB6', paddingHorizontal: 16, justifyContent: 'center', borderRadius: 6 },
  goText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  pdf: { flex: 1, backgroundColor: '#0E1116' },
  notice: { margin: 16, padding: 16, backgroundColor: '#24272D', borderRadius: 10, borderWidth: 1, borderColor: '#323844' },
  noticeTitle: { color: '#E0A22B', fontSize: 15, fontWeight: '700', marginBottom: 8 },
  noticeBody: { color: '#D6DBE3', fontSize: 13, lineHeight: 20 },
});
