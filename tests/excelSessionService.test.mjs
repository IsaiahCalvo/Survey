import test from 'node:test';
import assert from 'node:assert/strict';

import {
  workbookItemBase,
  getFileIdFromPath,
  createWorkbookSession,
  closeWorkbookSession,
  refreshWorkbookSession,
  updateCellRange,
  getWorksheets,
  getUsedRange,
  checkSessionSupport,
} from '../src/services/excelSessionService.js';

function mockGraph({ getResult, postResult, patchResult, getError, postError, patchError } = {}) {
  const calls = [];
  const chain = {
    api(path) {
      calls.push(['api', path]);
      return chain;
    },
    select(fields) {
      calls.push(['select', fields]);
      return chain;
    },
    header(name, value) {
      calls.push(['header', name, value]);
      return chain;
    },
    async get() {
      calls.push(['get']);
      if (getError) throw getError;
      return getResult ?? {};
    },
    async post(body) {
      calls.push(['post', body]);
      if (postError) throw postError;
      return postResult ?? {};
    },
    async patch(body) {
      calls.push(['patch', body]);
      if (patchError) throw patchError;
      return patchResult ?? {};
    },
  };
  return { client: chain, calls };
}

test('workbookItemBase scopes OneDrive vs SharePoint drives', () => {
  assert.equal(workbookItemBase('f1'), '/me/drive/items/f1');
  assert.equal(workbookItemBase('f1', 'd1'), '/drives/d1/items/f1');
});

test('getFileIdFromPath returns id and maps errors', async () => {
  await assert.rejects(() => getFileIdFromPath(null, '/x'), /Not authenticated/);
  const ok = mockGraph({ getResult: { id: 'item-1' } });
  assert.equal(await getFileIdFromPath(ok.client, '/Documents/a.xlsx'), 'item-1');

  const driven = mockGraph({ getResult: { id: 'item-2' } });
  assert.equal(await getFileIdFromPath(driven.client, '/x.xlsx', 'drive-9'), 'item-2');
  assert.ok(driven.calls.some((c) => c[0] === 'api' && String(c[1]).includes('/drives/drive-9/')));

  const fail = mockGraph({ getError: new Error('nope') });
  await assert.rejects(() => getFileIdFromPath(fail.client, '/x'), /Failed to get file ID/);
});

test('createWorkbookSession returns session info and maps status errors', async () => {
  await assert.rejects(() => createWorkbookSession(null, 'f'), /Not authenticated/);
  const ok = mockGraph({ postResult: { id: 'sess-1' } });
  const session = await createWorkbookSession(ok.client, 'file-1', true, 'drive-1');
  assert.equal(session.sessionId, 'sess-1');
  assert.ok(session.expiresAt instanceof Date);

  const denied = mockGraph({ postError: Object.assign(new Error('denied'), { statusCode: 403 }) });
  await assert.rejects(() => createWorkbookSession(denied.client, 'f'), /Business account/);

  const missing = mockGraph({ postError: Object.assign(new Error('missing'), { statusCode: 404 }) });
  await assert.rejects(() => createWorkbookSession(missing.client, 'f'), /not found/);
});

test('close/refresh/update/get helpers exercise session APIs', async () => {
  assert.equal(await closeWorkbookSession(null, 'f', 's'), undefined);
  const closer = mockGraph({ postResult: {} });
  await closeWorkbookSession(closer.client, 'f1', 's1');
  assert.ok(closer.calls.some((c) => c[0] === 'api' && String(c[1]).includes('closeSession')));

  await assert.rejects(() => refreshWorkbookSession(null, 'f', 's'), /Missing graphClient/);
  const refresher = mockGraph({ getResult: { value: [] } });
  const refreshed = await refreshWorkbookSession(refresher.client, 'f1', 's1', 'd1');
  assert.equal(refreshed.sessionId, 's1');
  assert.ok(refreshed.expiresAt instanceof Date);

  const writer = mockGraph({ patchResult: { values: [[1]] } });
  const written = await updateCellRange(writer.client, 'f1', 's1', 'Sheet1', 'A1:B2', [[1, 2]]);
  assert.deepEqual(written.values, [[1]]);
  assert.ok(writer.calls.some((c) => c[0] === 'patch'));

  const sheets = mockGraph({ getResult: { value: [{ name: 'Sheet1' }] } });
  assert.deepEqual(await getWorksheets(sheets.client, 'f1', 's1'), [{ name: 'Sheet1' }]);

  const used = mockGraph({
    getResult: { values: [[1]], address: 'A1', rowCount: 1, columnCount: 1 },
  });
  const range = await getUsedRange(used.client, 'f1', 's1', 'Sheet1');
  assert.deepEqual(range.values, [[1]]);
  assert.equal(range.address, 'A1');
});

test('checkSessionSupport probes createSession capability', async () => {
  assert.deepEqual(await checkSessionSupport(null, 'f1'), {
    supported: false,
    error: 'Missing graphClient or fileId',
  });

  const ok = mockGraph({ postResult: { id: 's' } });
  assert.deepEqual(await checkSessionSupport(ok.client, 'f1'), { supported: true });

  const denied = mockGraph({
    postError: Object.assign(new Error('denied'), { statusCode: 403, code: 'AccessDenied' }),
  });
  const deniedResult = await checkSessionSupport(denied.client, 'f1');
  assert.equal(deniedResult.supported, false);
  assert.match(deniedResult.error, /Business account/);
});

test('excelSessionService maps close/refresh/update/get errors and close-probe failures', async () => {
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    const closeFail = mockGraph({ postError: new Error('already closed') });
    assert.equal(await closeWorkbookSession(closeFail.client, 'f', 's'), undefined);

    const refreshFail = mockGraph({ getError: new Error('expired') });
    await assert.rejects(() => refreshWorkbookSession(refreshFail.client, 'f', 's'), /Session refresh failed/);

    await assert.rejects(() => updateCellRange(null, 'f', 's', 'Sheet1', 'A1', [[1]]), /Not authenticated/);
    const patchFail = mockGraph({ patchError: new Error('patch-denied') });
    await assert.rejects(
      () => updateCellRange(patchFail.client, 'f', 's', 'Sheet1', 'A1', [[1]]),
      /Failed to update cells/,
    );

    await assert.rejects(() => getWorksheets(null, 'f'), /Not authenticated/);
    const sheetsFail = mockGraph({ getError: new Error('sheets-down') });
    await assert.rejects(() => getWorksheets(sheetsFail.client, 'f'), /Failed to get worksheets/);

    await assert.rejects(() => getUsedRange(null, 'f', null, 'Sheet1'), /Not authenticated/);
    const usedFail = mockGraph({ getError: new Error('used-down') });
    await assert.rejects(() => getUsedRange(usedFail.client, 'f', null, 'Sheet1'), /Failed to get used range/);

    // createSession succeeds but closeSession throws — still supported
    let postN = 0;
    const calls = [];
    const flakyClose = {
      api(path) {
        calls.push(['api', path]);
        return this;
      },
      header() { return this; },
      select() { return this; },
      async post() {
        postN += 1;
        if (postN === 1) return { id: 'sess-close-fail' };
        throw new Error('close failed');
      },
      async get() { return {}; },
      async patch() { return {}; },
    };
    assert.deepEqual(await checkSessionSupport(flakyClose, 'f1'), { supported: true });

    const other = mockGraph({ postError: new Error('other-fail') });
    const otherResult = await checkSessionSupport(other.client, 'f1');
    assert.equal(otherResult.supported, false);
    assert.match(otherResult.error, /other-fail/);
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
});
