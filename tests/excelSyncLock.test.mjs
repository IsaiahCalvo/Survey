import test from 'node:test';
import assert from 'node:assert/strict';
import { withExcelSyncLock } from '../src/services/excelSyncLock.js';

test('native Web Locks serialize this workbook and release the lock after rejection', {
  skip: typeof globalThis.navigator?.locks?.request !== 'function' ? 'This Node version does not expose native Web Locks' : false,
}, async () => {
  const scope = { documentId: `test-${crypto.randomUUID()}`, templateId: 'template', workbookId: 'workbook' };
  const events = [];
  let release;
  const first = withExcelSyncLock(scope, async () => {
    events.push('first-start');
    await new Promise(resolve => { release = resolve; });
    events.push('first-end');
    throw new Error('request failed');
  });
  const firstRejected = assert.rejects(first, /request failed/);
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  const second = withExcelSyncLock(scope, async () => { events.push('second'); return 2; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(events, ['first-start']);
  release();
  await firstRejected;
  assert.equal(await second, 2);
  assert.deepEqual(events, ['first-start', 'first-end', 'second']);
});

test('Web Lock name includes the complete scope and requests exclusive mode', async () => {
  const calls = [];
  await withExcelSyncLock({ documentId: 'doc', templateId: 'template', workbookId: 'workbook' }, () => 1, {
    locks: { request: async (...args) => { calls.push(args); return args[2](); } },
  });
  assert.equal(calls[0][0], 'survey:excel-sync:["doc","template","workbook"]');
  assert.deepEqual(calls[0][1], { mode: 'exclusive' });
});
