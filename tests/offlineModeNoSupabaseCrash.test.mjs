// Offline mode (no VITE_SUPABASE_URL / ANON_KEY: supabaseClient exports
// `supabase = null`, "Running in offline mode") must still open a document.
// Before 2026-10-13 the viewer died on load behind "Oops! Something went
// wrong": two mount effects called `supabase.channel(...)` synchronously
// (YDocProvider's shared-state listener and PDFViewer's KAL-309 Excel-sync
// hint listener), and the presence cleanup called `supabase.from(...)`.
// Seen when a worktree without .env ran the dev fixture route
// (documents-multiselect.spec "crash on load"); present on main too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

test('YDocProvider shared-state effect returns before touching a null supabase', () => {
  const src = read('components/collab/YDocProvider.jsx');
  const start = src.indexOf("if (!docId) { setIsDocShared(false); return undefined; }");
  assert.ok(start > 0, 'shared-state effect found');
  const channelAt = src.indexOf('.channel(`ydoc-shared-state:', start);
  assert.ok(channelAt > start, 'shared-state channel found');
  const body = src.slice(start, channelAt);
  assert.match(body, /if \(!supabase\) \{ setIsDocShared\(false\); return undefined; \}/);
});

test('PDFViewer KAL-309 excel_sync_applied listener skips when supabase is null', () => {
  const src = read('PDFViewer.jsx');
  const channelAt = src.indexOf('.channel(`yjs:${documentId}`)');
  assert.ok(channelAt > 0, 'yjs channel listener found');
  const guard = src.lastIndexOf('return undefined;', channelAt);
  const guardLine = src.slice(src.lastIndexOf('\n', guard), guard);
  assert.match(guardLine, /!supabase\)/, 'the early return before the channel covers !supabase');
});

test('presence upsert / remove are no-ops without supabase', async () => {
  const src = read('services/documentAnnotationService.js');
  for (const fn of ['updateDocumentPresence', 'removeDocumentPresence']) {
    const at = src.indexOf(`export async function ${fn}(`);
    assert.ok(at > 0, fn);
    const head = src.slice(at, src.indexOf('await supabase', at));
    assert.match(head, /if \(!documentId \|\| !userId \|\| !supabase\) return \{ success: false \};/, fn);
  }
});
