// Signature tool (Nightly 'signature-tool'): the saved list and the ink trim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIGNATURE_LIMIT, cleanSignatures, createSignatureStore } from '../src/signature/signatureStore.js';
import { inkBounds } from '../src/signature/signaturePicture.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const memory = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), map };
};

test('the store keeps signatures newest first, survives a reload, deletes', () => {
  const storage = memory();
  const store = createSignatureStore({ storage });
  let calls = 0;
  store.subscribe(() => { calls += 1; });
  const a = store.add({ title: 'A', src: PNG, width: 100, height: 40 });
  const b = store.add({ title: '', src: PNG, width: 80, height: 30 });
  assert.deepEqual(store.get().map((r) => r.title), ['Signature', 'A']);
  assert.equal(calls, 2);
  const again = createSignatureStore({ storage });
  assert.deepEqual(again.get().map((r) => r.id), [b.id, a.id]);
  again.remove(a.id);
  assert.deepEqual(again.get().map((r) => r.id), [b.id]);
});

test('bad rows and non-PNG pictures never load; the list is capped', () => {
  assert.equal(createSignatureStore({ storage: memory() }).add({ title: 'x', src: 'data:image/jpeg;base64,AA', width: 1, height: 1 }), null);
  const rows = Array.from({ length: SIGNATURE_LIMIT + 3 }, (_, i) => ({ id: `s${i}`, title: `S${i}`, src: PNG, width: 10, height: 10 }));
  assert.equal(cleanSignatures([...rows, null, { id: 'z', src: PNG, width: 0, height: 1 }]).length, SIGNATURE_LIMIT);
  const storage = memory();
  storage.setItem('survey.signatures.v1', '{broken');
  assert.deepEqual(createSignatureStore({ storage }).get(), []);
});

test('ink bounds find the inked pixels, or none', () => {
  const w = 5;
  const h = 4;
  const data = new Uint8ClampedArray(w * h * 4);
  assert.equal(inkBounds(data, w, h), null);
  data[(1 * w + 2) * 4 + 3] = 255;
  data[(3 * w + 4) * 4 + 3] = 200;
  assert.deepEqual(inkBounds(data, w, h), { x: 2, y: 1, w: 3, h: 3 });
});

test('flag, button, placement and migration', () => {
  assert.equal(FEATURE_FLAGS['signature-tool'].stage, 'beta');
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /signatureToolEnabled \? \[\{ id: 'signature'/);
  assert.match(viewer, /\|\| signatureToolEnabled\) && \(\s*<MarkLibraryPlacementLayer/);
  const phone = readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');
  assert.match(phone, /flag: 'signature-tool', picker: 'signature'/);
  const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /<SignatureCard enabled=\{Boolean\(isViewerVisible && isFeatureOn\('signature-tool'\)\)\}/);
  const migration = readFileSync(new URL('../supabase/migrations/20261112092000_signature_tool_flag.sql', import.meta.url), 'utf8');
  assert.match(migration, /'signature-tool', 'off'/);
});
