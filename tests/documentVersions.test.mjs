import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  isMissingFunctionError,
  listDocumentVersions,
  previousVersion,
  supersedeDocument,
} from '../src/services/documentVersionService.js';
import {
  COMPARE_MAX_ZOOM,
  COMPARE_MIN_ZOOM,
  clampZoom,
  comparePageCount,
  composeOverlay,
  fitZoom,
  inkCanvas,
  nudgeOffset,
} from '../src/utils/versionCompare.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const rpcClient = (answer) => {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return typeof answer === 'function' ? answer(name, args) : answer;
    },
  };
};

test('supersedeDocument names both documents and reports the outcome', async () => {
  const ok = rpcClient({ data: {}, error: null });
  assert.equal(await supersedeDocument(ok, 'old', 'new'), 'superseded');
  assert.deepEqual(ok.calls, [{ name: 'supersede_document', args: { p_old_document_id: 'old', p_new_document_id: 'new' } }]);

  assert.equal(await supersedeDocument(rpcClient({ error: { code: 'PGRST202' } }), 'old', 'new'), 'unsupported');
  assert.equal(await supersedeDocument(rpcClient({ error: { code: '42883' } }), 'old', 'new'), 'unsupported');
  await assert.rejects(supersedeDocument(rpcClient({ error: { code: '42501', message: 'Document not found' } }), 'old', 'new'), /Document not found/);
});

test('listDocumentVersions maps rows and treats an old server as no versions', async () => {
  const client = rpcClient({
    data: [
      { id: 'a', name: 'Plan.pdf', created_at: '2026-10-01T00:00:00Z', page_count: 3, version_number: 1, is_current: false },
      { id: 'b', name: 'Plan rev 2.pdf', created_at: '2026-10-20T00:00:00Z', page_count: 4, version_number: 2, is_current: true },
    ],
    error: null,
  });
  const versions = await listDocumentVersions(client, 'a');
  assert.deepEqual(client.calls[0], { name: 'document_versions', args: { p_document_id: 'a' } });
  assert.deepEqual(versions[1], { id: 'b', name: 'Plan rev 2.pdf', createdAt: '2026-10-20T00:00:00Z', pageCount: 4, versionNumber: 2, isCurrent: true });
  assert.equal(versions[0].isCurrent, false);
  assert.equal(previousVersion(versions, 'b').id, 'a');
  assert.equal(previousVersion(versions, 'a'), null);

  assert.deepEqual(await listDocumentVersions(rpcClient({ error: { code: 'PGRST202' } }), 'a'), []);
  assert.deepEqual(await listDocumentVersions(rpcClient({ data: [], error: null }), null), []);
  await assert.rejects(listDocumentVersions(rpcClient({ error: { code: '42501', message: 'nope' } }), 'a'), /nope/);
  assert.equal(isMissingFunctionError(null), false);
});

test('compare helpers: page count, fit, zoom limits and nudges', () => {
  assert.equal(comparePageCount(3, 5), 5);
  assert.equal(comparePageCount(undefined, 2), 2);
  assert.equal(fitZoom(612, 792, 1224, 792), 1);
  assert.equal(fitZoom(612, 792, 306, 2000), 0.5);
  assert.equal(fitZoom(0, 792, 300, 300), 1);
  assert.equal(clampZoom(100), COMPARE_MAX_ZOOM);
  assert.equal(clampZoom(0.001), COMPARE_MIN_ZOOM);
  assert.equal(clampZoom('x'), 1);
  assert.deepEqual(nudgeOffset({ x: 0, y: 0 }, 'ArrowRight'), { x: 1, y: 0 });
  assert.deepEqual(nudgeOffset({ x: 0, y: 0 }, 'ArrowUp', true), { x: 0, y: -10 });
  assert.deepEqual(nudgeOffset({ x: 2, y: 3 }, 'ArrowLeft'), { x: 1, y: 3 });
  assert.deepEqual(nudgeOffset(null, 'ArrowDown', true), { x: 0, y: 10 });
  assert.deepEqual(nudgeOffset({ x: 4, y: 5 }, 'Enter'), { x: 4, y: 5 });
});

test('composeOverlay draws new, then old multiplied at the nudge in pixels', () => {
  const ops = [];
  const ctx = {
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    save: () => ops.push('save'),
    restore: () => ops.push('restore'),
    fillRect: (...a) => ops.push(['fill', ctx.globalCompositeOperation, ctx.fillStyle, ...a]),
    drawImage: (img, x, y) => ops.push(['draw', img, ctx.globalCompositeOperation, x, y]),
  };
  composeOverlay(ctx, { width: 100, height: 50, newLayer: 'NEW', oldLayer: 'OLD', offset: { x: 2, y: -1 }, pixelsPerPoint: 3 });
  assert.deepEqual(ops, [
    'save',
    ['fill', 'source-over', 'rgb(255, 255, 255)', 0, 0, 100, 50],
    ['draw', 'NEW', 'source-over', 0, 0],
    ['draw', 'OLD', 'multiply', 6, -3],
    'restore',
  ]);

  ops.length = 0;
  inkCanvas(ctx, 10, 10, 'rgb(255, 0, 0)');
  assert.deepEqual(ops, ['save', ['fill', 'lighten', 'rgb(255, 0, 0)', 0, 0, 10, 10], 'restore']);
});

test('version history is a beta flag with a matching server row', () => {
  const flag = FEATURE_FLAGS['document-versions'];
  assert.ok(flag, 'flag declared');
  assert.equal(flag.stage, 'beta');
  const sql = readFileSync(new URL('../supabase/migrations/20261028010000_document_versions.sql', import.meta.url), 'utf8');
  assert.match(sql, /\('document-versions', 'off'/);
});

test('every document list leaves replaced versions out', () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  assert.equal((read('src/hooks/useDatabase.js').match(/\.is\('superseded_by', null\)/g) || []).length >= 2, true);
  assert.match(read('src/agent/webmcp.js'), /\.is\('superseded_by', null\)/);
  assert.match(read('supabase/functions/survey-mcp/index.ts'), /\.is\("superseded_by", null\)|\.is\('superseded_by', null\)/);
  assert.match(read('src/Dashboard.jsx'), /\.is\('superseded_by', null\)/);
});
