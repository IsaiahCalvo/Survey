import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Execute the actual viewer effect, with only its external ports replaced.
// This is effect behavior proof, not a mounted full-viewer/browser test.
const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const marker = source.indexOf('// Embedded import — exactly once per document, durably.');
const start = source.indexOf('useEffect(() => {', marker) + 'useEffect(() => {'.length;
const end = source.indexOf('  }, [normalAnnotationHydration, pdfFile, pdfDoc, handleSaveAnnotations]);', start);
assert.ok(marker > 0 && end > start);
const names = ['normalAnnotationHydration', 'pdfFile', 'pdfDoc', 'embeddedImportFallbackDoneRef',
  'supabase', 'importAnnotationsFromPdf', 'setPdfNativeAnnotationLayerPolicyByPage',
  'annotationsByPageRef', 'handleSaveAnnotations', 'appDebug'];
const run = new Function(...names, source.slice(start, end));
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const calls = [], done = { current: null };
  const ports = {
    normalAnnotationHydration: { ready: true, documentId: 'document-a' },
    pdfFile: { id: 'document-a', async arrayBuffer() { calls.push('bytes'); return new ArrayBuffer(0); } },
    pdfDoc: {}, embeddedImportFallbackDoneRef: done,
    supabase: { from(table) {
      assert.equal(table, 'documents'); calls.push('metadata');
      const q = { select() { return q; }, eq() { return q; },
        async maybeSingle() { return { data: null }; },
        update(value) { assert.ok(value.embedded_import_completed_at); calls.push('stamp'); return q; } };
      return q;
    } },
    async importAnnotationsFromPdf() { calls.push('parse'); return {
      annotationsByPage: { 1: { objects: [{ id: 'embedded', type: 'rect' }] } }, nativeLayerPolicyByPage: {},
    }; },
    setPdfNativeAnnotationLayerPolicyByPage() { calls.push('layer'); },
    annotationsByPageRef: { current: { 1: { objects: [{ id: 'existing' }] } } },
    handleSaveAnnotations(page, value) { calls.push(['save', page, value.objects.map(o => o.id)]); },
    appDebug() {},
  };
  return { ports, calls, done, run() { return run(...names.map(name => ports[name])); } };
}

test('checked generation cannot query, import or stamp the legacy embedded-import marker', async () => {
  const f = fixture();
  f.ports.normalAnnotationHydration = { ready: true, documentId: 'document-a', count: 0,
    source: 'checked-generation', pdfGenerationId: 'generation-a', embeddedImportAllowed: false };
  assert.equal(f.run(), undefined); await tick();
  assert.deepEqual(f.calls, []); assert.equal(f.done.current, null);
  // The refused checked path did not consume the old once-per-mount guard.
  delete f.ports.normalAnnotationHydration.embeddedImportAllowed;
  const cleanup = f.run(); await tick();
  assert.deepEqual(f.calls.find(c => Array.isArray(c)), ['save', 1, ['existing', 'embedded']]);
  assert.ok(f.calls.includes('stamp')); cleanup();
});

test('legacy embedded import remains once-only and retains existing annotations', async () => {
  const f = fixture(), cleanup = f.run(); await tick();
  assert.deepEqual(f.calls, ['metadata', 'bytes', 'parse', 'layer', ['save', 1, ['existing', 'embedded']], 'metadata', 'stamp']);
  const count = f.calls.length; assert.equal(f.run(), undefined); await tick();
  assert.equal(f.calls.length, count); cleanup();
});

test('pending or wrong-document hydration never reaches the embedded importer', async () => {
  for (const hydration of [{ ready: false, documentId: 'document-a' }, { ready: true, documentId: 'other' }]) {
    const f = fixture(); f.ports.normalAnnotationHydration = hydration;
    assert.equal(f.run(), undefined); await tick(); assert.deepEqual(f.calls, []);
  }
});
