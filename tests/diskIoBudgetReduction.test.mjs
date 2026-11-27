// Supabase Disk IO budget reduction guards (2026-11-27):
//   * sheet-sync-sweep pg_cron cadence reduced from every 1 min to every 5 min (80% less 24/7 cron + pg_net IO);
//   * missing sweep scan-path indexes added with IF NOT EXISTS (partial active links + provider/updated_at connections);
//   * annotation_snapshots TOAST storage set EXTERNAL (already gzipped) and fillfactor = 80 for HOT updates;
//   * document_presence client writes skip hidden browser tabs, deduplicate open-time double writes, and debounce rapid page scrolling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createPresenceActivityBump,
  isPresenceDocumentVisible,
  PRESENCE_ACTIVITY_REFRESH_MS,
  PRESENCE_PAGE_CHANGE_DEBOUNCE_MS,
  shouldSkipDuplicatePresenceWrite,
} from '../src/utils/presenceActivity.js';

const migrationSql = readFileSync(
  new URL('../supabase/migrations/20261127000000_reduce_disk_io_budget.sql', import.meta.url),
  'utf8',
);

test('disk IO migration reschedules sheet-sync-sweep to every 5 minutes with pg_cron and pg_net guards', () => {
  assert.match(migrationSql, /extname\s*=\s*'pg_cron'/i, 'guards pg_cron extension');
  assert.match(migrationSql, /extname\s*=\s*'pg_net'/i, 'guards pg_net extension');
  assert.match(migrationSql, /cron\.unschedule\('sheet-sync-sweep'\)/i, 'unschedules prior job before rescheduling');
  assert.match(
    migrationSql,
    /cron\.schedule\(\s*'sheet-sync-sweep'\s*,\s*'\*\/5 \* \* \* \*'/i,
    'reschedules sheet-sync-sweep to */5 * * * *',
  );
  assert.doesNotMatch(
    migrationSql,
    /cron\.schedule\(\s*'sheet-sync-sweep'\s*,\s*'\* \* \* \* \*'/i,
    'must not schedule sheet-sync-sweep every minute',
  );
  assert.match(
    migrationSql,
    /s\.function_url is not null[\s\S]*exists\s*\(\s*select 1 from public\.sheet_sync_links l where l\.status = 'active'\s*\)/i,
    'preserves active-link and function_url guards',
  );
});

test('disk IO migration adds targeted sweep indexes and optimizes annotation_snapshots storage', () => {
  assert.match(
    migrationSql,
    /create index if not exists sheet_sync_links_active_last_round_idx\s+on public\.sheet_sync_links\s*\(last_round_at asc nulls first\)\s+where status = 'active'/i,
    'adds partial index for active sheet_sync_links ordered by last_round_at',
  );
  assert.match(
    migrationSql,
    /create index if not exists sheet_sync_connections_provider_updated_idx\s+on public\.sheet_sync_connections\s*\(provider,\s*updated_at\)/i,
    'adds composite index for keepSignInsAlive provider/updated_at scan',
  );
  assert.match(
    migrationSql,
    /alter table public\.annotation_snapshots\s+alter column snapshot set storage external/i,
    'avoids re-compressing already-gzipped snapshot blobs',
  );
  assert.match(
    migrationSql,
    /alter table public\.annotation_snapshots\s+set\s*\(fillfactor\s*=\s*80\)/i,
    'leaves HOT update headroom on annotation_snapshots',
  );
  assert.doesNotMatch(
    migrationSql,
    /create index[\s\S]*analytics_ingestion_daily_counters/i,
    'does not add redundant index on PK-covered tiny analytics counter table',
  );
});

test('presence activity bump never writes while browser tab is hidden', () => {
  let t = 0;
  let bumps = 0;
  let visible = false;
  const bump = createPresenceActivityBump({
    onBump: () => { bumps += 1; },
    now: () => t,
    isActive: () => true,
    isVisible: () => visible,
  });
  bump.noteWrite(0);
  t = PRESENCE_ACTIVITY_REFRESH_MS + 1000;
  assert.equal(bump.onActivity(), false, 'hidden browser tab skips presence write');
  assert.equal(bumps, 0);
  visible = true;
  assert.equal(bump.onActivity(), true, 'resumes once visible');
  assert.equal(bumps, 1);
});

test('isPresenceDocumentVisible reflects document.visibilityState safely', () => {
  assert.equal(isPresenceDocumentVisible(), true, 'true in non-DOM runtimes');
  const prevDoc = globalThis.document;
  try {
    globalThis.document = { visibilityState: 'hidden' };
    assert.equal(isPresenceDocumentVisible(), false);
    globalThis.document = { visibilityState: 'visible' };
    assert.equal(isPresenceDocumentVisible(), true);
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
});

test('shouldSkipDuplicatePresenceWrite deduplicates immediate repeat writes for the same document and page', () => {
  const base = { documentId: 'doc-1', page: 3, at: 10_000 };
  assert.equal(shouldSkipDuplicatePresenceWrite(base, { documentId: 'doc-1', page: 3 }, 10_250), true);
  assert.equal(shouldSkipDuplicatePresenceWrite(base, { documentId: 'doc-1', page: 4 }, 10_250), false, 'page change is not skipped');
  assert.equal(shouldSkipDuplicatePresenceWrite(base, { documentId: 'doc-2', page: 3 }, 10_250), false, 'different doc is not skipped');
  assert.equal(
    shouldSkipDuplicatePresenceWrite(base, { documentId: 'doc-1', page: 3 }, 10_000 + PRESENCE_ACTIVITY_REFRESH_MS),
    false,
    'expired window is not skipped',
  );
  assert.equal(shouldSkipDuplicatePresenceWrite(null, { documentId: 'doc-1', page: 3 }, 10_250), false);
  assert.ok(PRESENCE_PAGE_CHANGE_DEBOUNCE_MS >= 500 && PRESENCE_PAGE_CHANGE_DEBOUNCE_MS <= 5000);
});

test('PDFViewer wires visibility gating, duplicate-write skip, and page-change debounce for document_presence', () => {
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const start = viewer.indexOf('// Update presence when page changes');
  const end = viewer.indexOf('const handleExportSpaceToCSV', start);
  assert.ok(start > 0 && end > start, 'located page-change presence effect in PDFViewer.jsx');
  const block = viewer.slice(start, end);
  assert.match(block, /if \(!isPresenceDocumentVisible\(\)\) return;/, 'gates presence writes on tab visibility');
  assert.match(block, /shouldSkipDuplicatePresenceWrite\(lastPresenceWriteRef\.current/, 'deduplicates immediate post-open write');
  assert.match(block, /PRESENCE_PAGE_CHANGE_DEBOUNCE_MS/, 'debounces rapid page scrolling presence writes');
  assert.match(block, /clearTimeout\(pageDebounceTimer\)/, 'clears pending page debounce timer on cleanup');
});
