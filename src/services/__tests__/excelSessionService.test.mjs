import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getFileIdFromPath,
  createWorkbookSession,
  closeWorkbookSession,
  updateCellRange,
  getWorksheets,
  getUsedRange,
  checkSessionSupport
} from '../excelSessionService.js';

// A fake Microsoft Graph client that records every .api(path) it is handed and returns a
// chainable stub. This lets us assert that SharePoint/Teams files (driveId present) target
// /drives/{driveId}/items/... while OneDrive files (no driveId) keep /me/drive/items/...
function makeFakeGraph(responseById = {}) {
  const calls = [];
  const makeBuilder = (path) => {
    calls.push(path);
    const builder = {
      _path: path,
      select() { return builder; },
      header() { return builder; },
      async get() { return responseById[path] || { id: 'FILE123', value: [] }; },
      async post() { return responseById[path] || { id: 'SESSION1' }; },
      async patch() { return { ok: true }; }
    };
    return builder;
  };
  return { client: { api: (p) => makeBuilder(p) }, calls };
}

test('OneDrive (no driveId) → /me/drive/items paths', async () => {
  const { client, calls } = makeFakeGraph();
  await createWorkbookSession(client, 'F1', true);
  assert.ok(calls.includes('/me/drive/items/F1/workbook/createSession'));
});

test('SharePoint/Teams (driveId) → /drives/{driveId}/items paths', async () => {
  const { client, calls } = makeFakeGraph();
  await createWorkbookSession(client, 'F1', true, 'DRV9');
  assert.ok(calls.includes('/drives/DRV9/items/F1/workbook/createSession'));
  assert.ok(!calls.some(c => c.startsWith('/me/drive')));
});

test('getFileIdFromPath scopes root: to the SharePoint drive', async () => {
  const onedrive = makeFakeGraph({ '/me/drive/root:/Docs/s.xlsx': { id: 'ID_A' } });
  const idA = await getFileIdFromPath(onedrive.client, '/Docs/s.xlsx');
  assert.equal(idA, 'ID_A');
  assert.ok(onedrive.calls.includes('/me/drive/root:/Docs/s.xlsx'));

  const sp = makeFakeGraph({ '/drives/DRV9/root:/Docs/s.xlsx': { id: 'ID_B' } });
  const idB = await getFileIdFromPath(sp.client, '/Docs/s.xlsx', 'DRV9');
  assert.equal(idB, 'ID_B');
  assert.ok(sp.calls.includes('/drives/DRV9/root:/Docs/s.xlsx'));
});

test('every session call is drive-scoped when driveId is given', async () => {
  const { client, calls } = makeFakeGraph();
  await closeWorkbookSession(client, 'F1', 'S1', 'DRV9');
  await updateCellRange(client, 'F1', 'S1', 'Sheet1', 'A1:B2', [[1, 2]], 'DRV9');
  await getWorksheets(client, 'F1', 'S1', 'DRV9');
  await getUsedRange(client, 'F1', 'S1', 'Sheet1', 'DRV9');
  await checkSessionSupport(client, 'F1', 'DRV9');

  // None of these may touch /me/drive when a SharePoint drive id is supplied.
  assert.ok(!calls.some(c => c.startsWith('/me/drive')), `unexpected /me/drive call: ${calls}`);
  assert.ok(calls.includes('/drives/DRV9/items/F1/workbook/closeSession'));
  assert.ok(calls.some(c => c.startsWith("/drives/DRV9/items/F1/workbook/worksheets('Sheet1')/range")));
  assert.ok(calls.includes('/drives/DRV9/items/F1/workbook/worksheets'));
  assert.ok(calls.some(c => c.startsWith("/drives/DRV9/items/F1/workbook/worksheets('Sheet1')/usedRange")));
});

test('checkSessionSupport reports unsupported on 403 (personal account)', async () => {
  const client = {
    api() {
      return {
        post() { const e = new Error('denied'); e.statusCode = 403; throw e; }
      };
    }
  };
  const result = await checkSessionSupport(client, 'F1');
  assert.equal(result.supported, false);
});
