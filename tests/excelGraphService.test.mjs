import test from 'node:test';
import assert from 'node:assert/strict';

import {
  uploadExcelFile,
  getFileMetadata,
  getFileById,
  downloadExcelFile,
  downloadExcelFileByPath,
  getFileETag,
  getDriveType,
  uploadFileContentById,
  listFolders,
  listDriveItems,
  listSharePointSites,
  listSiteDocumentLibraries,
  checkFileExists,
  checkFileExistsInDrive,
  uploadFileToDrive,
  getTemplateIdFromExcel,
} from '../src/services/excelGraphService.js';
function mockGraph({ getResult, putResult, getError, putError } = {}) {
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
    filter(expr) {
      calls.push(['filter', expr]);
      return chain;
    },
    header(name, value) {
      calls.push(['header', name, value]);
      return chain;
    },
    top(n) {
      calls.push(['top', n]);
      return chain;
    },
    async get() {
      calls.push(['get']);
      if (getError) throw getError;
      return typeof getResult === 'function' ? getResult(calls) : (getResult ?? {});
    },
    async put(body) {
      calls.push(['put', body]);
      if (putError) throw putError;
      return putResult ?? { id: 'uploaded' };
    },
  };
  return { client: chain, calls };
}

test('uploadExcelFile normalizes content shapes and rejects missing auth', async () => {
  await assert.rejects(() => uploadExcelFile(null, '/a.xlsx', new Uint8Array([1])), /Not authenticated/);

  const bytes = mockGraph({ putResult: { id: 'u1' } });
  assert.equal((await uploadExcelFile(bytes.client, '/Documents/a.xlsx', new Uint8Array([1, 2]))).id, 'u1');

  const ab = mockGraph({ putResult: { id: 'u2' } });
  assert.equal((await uploadExcelFile(ab.client, '/a.xlsx', new Uint8Array([9]).buffer)).id, 'u2');

  const view = mockGraph({ putResult: { id: 'u2b' } });
  const u8 = new Uint8Array([9, 8, 7]);
  assert.equal(
    (await uploadExcelFile(view.client, '/a.xlsx', {
      buffer: u8.buffer,
      byteOffset: u8.byteOffset,
      byteLength: u8.byteLength,
    })).id,
    'u2b',
  );

  const serialized = mockGraph({ putResult: { id: 'u3' } });
  assert.equal(
    (await uploadExcelFile(serialized.client, '/a.xlsx', { type: 'Buffer', data: [7, 8] })).id,
    'u3',
  );

  const arr = mockGraph({ putResult: { id: 'u4' } });
  assert.equal((await uploadExcelFile(arr.client, '/a.xlsx', [3, 4])).id, 'u4');

  const fallback = mockGraph({ putResult: { id: 'u5' } });
  assert.equal((await uploadExcelFile(fallback.client, '/a.xlsx', 'raw-bytes')).id, 'u5');

  const fail = mockGraph({ putError: new Error('boom') });
  await assert.rejects(() => uploadExcelFile(fail.client, '/a.xlsx', [1]), /Failed to upload Excel file/);
});
test('metadata/id/etag/drive helpers', async () => {
  await assert.rejects(() => getFileMetadata(null, '/x'), /Not authenticated/);
  const meta = mockGraph({ getResult: { id: 'm1', name: 'a.xlsx' } });
  assert.equal((await getFileMetadata(meta.client, '/Documents/a.xlsx')).id, 'm1');
  await assert.rejects(
    () => getFileMetadata(mockGraph({ getError: new Error('meta-fail') }).client, '/x'),
    /Failed to get file metadata/,
  );

  await assert.rejects(() => getFileById(null, 'f'), /Not authenticated/);
  assert.equal(await getFileById(mockGraph().client, null), null);
  assert.equal(
    await getFileById(mockGraph({ getError: Object.assign(new Error('gone'), { statusCode: 404 }) }).client, 'x'),
    null,
  );
  assert.equal((await getFileById(mockGraph({ getResult: { id: 'f1' } }).client, 'f1')).id, 'f1');
  await assert.rejects(
    () => getFileById(mockGraph({ getError: new Error('other') }).client, 'f'),
    /other/,
  );

  await assert.rejects(() => getFileETag(null, 'f'), /Not authenticated/);
  await assert.rejects(() => getFileETag(mockGraph().client, null), /File ID is required/);
  const etag = mockGraph({
    getResult: { id: 'f', name: 'a.xlsx', eTag: 'e1', lastModifiedDateTime: 't', size: 10 },
  });
  assert.deepEqual(await getFileETag(etag.client, 'f'), {
    id: 'f',
    name: 'a.xlsx',
    eTag: 'e1',
    lastModifiedDateTime: 't',
    size: 10,
  });
  assert.equal(
    await getFileETag(mockGraph({ getError: Object.assign(new Error('x'), { code: 'itemNotFound' }) }).client, 'f'),
    null,
  );
  await assert.rejects(
    () => getFileETag(mockGraph({ getError: new Error('etag-fail') }).client, 'f'),
    /Failed to get file ETag/,
  );

  await assert.rejects(() => getDriveType(null), /Not authenticated/);
  assert.equal(await getDriveType(mockGraph({ getResult: { driveType: 'business' } }).client), 'business');
  assert.equal(await getDriveType(mockGraph({ getResult: { driveType: 'documentLibrary' } }).client, 'd1'), 'documentLibrary');
  assert.equal(await getDriveType(mockGraph({ getResult: {} }).client), null);
});
test('download helpers use downloadUrl + fetch', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  });
  try {
    await assert.rejects(() => downloadExcelFile(null, 'f'), /Not authenticated/);
    await assert.rejects(() => downloadExcelFile(mockGraph().client, null), /File ID is required/);
    await assert.rejects(() => downloadExcelFileByPath(null, '/a.xlsx'), /Not authenticated/);

    const byId = mockGraph({
      getResult: { '@microsoft.graph.downloadUrl': 'https://example.test/file' },
    });
    const buf = await downloadExcelFile(byId.client, 'fid');
    assert.equal(buf.byteLength, 3);

    const byPath = mockGraph({
      getResult: { '@microsoft.graph.downloadUrl': 'https://example.test/file' },
    });
    assert.equal((await downloadExcelFileByPath(byPath.client, '/a.xlsx')).byteLength, 3);

    await assert.rejects(
      () => downloadExcelFile(
        mockGraph({ getResult: {} }).client,
        'fid',
      ),
      /download URL/,
    );
    await assert.rejects(
      () => downloadExcelFileByPath(mockGraph({ getResult: {} }).client, '/a.xlsx'),
      /download URL/,
    );
  } finally {
    globalThis.fetch = prevFetch;
  }

  const prevFetch2 = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, statusText: 'err' });
  try {
    await assert.rejects(
      () => downloadExcelFile(
        mockGraph({ getResult: { '@microsoft.graph.downloadUrl': 'https://x' } }).client,
        'fid',
      ),
      /HTTP error 500/,
    );
    await assert.rejects(
      () => downloadExcelFileByPath(
        mockGraph({ getResult: { '@microsoft.graph.downloadUrl': 'https://x' } }).client,
        '/a.xlsx',
      ),
      /HTTP error 500/,
    );
  } finally {
    globalThis.fetch = prevFetch2;
  }
});
test('upload by id / to drive and listing/existence helpers', async () => {
  await assert.rejects(() => uploadFileContentById(null, 'fid', [1]), /Not authenticated/);
  await assert.rejects(() => uploadFileContentById(mockGraph().client, null, [1]), /File ID is required/);

  const byId = mockGraph({ putResult: { id: 'up1' } });
  assert.equal((await uploadFileContentById(byId.client, 'fid', new Uint8Array([1]))).id, 'up1');
  assert.equal(
    (await uploadFileContentById(mockGraph({ putResult: { id: 'ab' } }).client, 'fid', new Uint8Array([1]).buffer)).id,
    'ab',
  );
  const u8 = new Uint8Array([2, 3]);
  assert.equal(
    (await uploadFileContentById(mockGraph({ putResult: { id: 'view' } }).client, 'fid', {
      buffer: u8.buffer,
      byteOffset: u8.byteOffset,
      byteLength: u8.byteLength,
    })).id,
    'view',
  );
  assert.equal(
    (await uploadFileContentById(mockGraph({ putResult: { id: 'ser' } }).client, 'fid', {
      type: 'Buffer',
      data: [1],
    })).id,
    'ser',
  );
  assert.equal((await uploadFileContentById(mockGraph({ putResult: { id: 'arr' } }).client, 'fid', [1])).id, 'arr');
  assert.equal((await uploadFileContentById(mockGraph({ putResult: { id: 'fb' } }).client, 'fid', 'raw')).id, 'fb');
  await assert.rejects(
    () => uploadFileContentById(mockGraph({ putError: new Error('up-fail') }).client, 'fid', [1]),
    /Failed to upload file content/,
  );

  await assert.rejects(() => uploadFileToDrive(null, 'd', 'root', 'a.xlsx', [1]), /Not authenticated/);
  const toDrive = mockGraph({ putResult: { id: 'up2' } });
  assert.equal(
    (await uploadFileToDrive(toDrive.client, 'd1', 'root', 'a.xlsx', { type: 'Buffer', data: [1] })).id,
    'up2',
  );
  assert.equal(
    (await uploadFileToDrive(mockGraph({ putResult: { id: 'ab2' } }).client, 'd1', 'root', 'a.xlsx', new Uint8Array([1]).buffer)).id,
    'ab2',
  );
  assert.equal(
    (await uploadFileToDrive(mockGraph({ putResult: { id: 'u82' } }).client, 'd1', 'root', 'a.xlsx', new Uint8Array([1]))).id,
    'u82',
  );
  assert.equal(
    (await uploadFileToDrive(mockGraph({ putResult: { id: 'view2' } }).client, 'd1', 'root', 'a.xlsx', {
      buffer: u8.buffer,
      byteOffset: u8.byteOffset,
      byteLength: u8.byteLength,
    })).id,
    'view2',
  );
  assert.equal(
    (await uploadFileToDrive(mockGraph({ putResult: { id: 'arr2' } }).client, 'd1', 'root', 'a.xlsx', [9])).id,
    'arr2',
  );
  assert.equal(
    (await uploadFileToDrive(mockGraph({ putResult: { id: 'fb2' } }).client, 'd1', 'root', 'a.xlsx', 'raw')).id,
    'fb2',
  );
  await assert.rejects(
    () => uploadFileToDrive(mockGraph({ putError: new Error('drive-fail') }).client, 'd', 'root', 'a.xlsx', [1]),
    /Failed to upload file/,
  );

  await assert.rejects(() => listFolders(null), /Not authenticated/);
  assert.deepEqual(
    await listFolders(mockGraph({ getResult: { value: [{ name: 'Docs', folder: {} }] } }).client, '/'),
    [{ name: 'Docs', folder: {} }],
  );
  assert.deepEqual(
    await listFolders(mockGraph({ getResult: {} }).client, ''),
    [],
  );
  assert.deepEqual(
    await listFolders(mockGraph({ getResult: { value: [] } }).client, '/Documents'),
    [],
  );
  await assert.rejects(
    () => listFolders(mockGraph({ getError: new Error('list-fail') }).client, '/'),
    /Failed to list folders/,
  );

  await assert.rejects(() => listDriveItems(null, 'd'), /Not authenticated/);
  assert.deepEqual(
    await listDriveItems(mockGraph({ getResult: { value: [{ id: '1' }] } }).client, 'd1', 'root', true),
    [{ id: '1' }],
  );
  assert.deepEqual(
    await listDriveItems(mockGraph({ getResult: {} }).client, 'd1', 'root', false),
    [],
  );
  await assert.rejects(
    () => listDriveItems(mockGraph({ getError: new Error('ldi') }).client, 'd1'),
    /Failed to list drive items/,
  );

  await assert.rejects(() => listSharePointSites(null), /Not authenticated/);
  assert.deepEqual(
    await listSharePointSites(mockGraph({ getResult: { value: [{ id: 's1' }] } }).client),
    [{ id: 's1' }],
  );
  assert.deepEqual(await listSharePointSites(mockGraph({ getResult: {} }).client), []);
  await assert.rejects(
    () => listSharePointSites(mockGraph({ getError: new Error('MSA accounts not supported') }).client),
    /Failed to list SharePoint sites/,
  );
  await assert.rejects(
    () => listSharePointSites(mockGraph({ getError: new Error('other-sites') }).client),
    /Failed to list SharePoint sites/,
  );

  await assert.rejects(() => listSiteDocumentLibraries(null, 's'), /Not authenticated/);
  assert.deepEqual(
    await listSiteDocumentLibraries(mockGraph({ getResult: { value: [{ id: 'lib' }] } }).client, 'site-1'),
    [{ id: 'lib' }],
  );
  assert.deepEqual(await listSiteDocumentLibraries(mockGraph({ getResult: {} }).client, 'site-1'), []);
  await assert.rejects(
    () => listSiteDocumentLibraries(mockGraph({ getError: new Error('libs') }).client, 's'),
    /Failed to list site document libraries/,
  );

  await assert.rejects(() => checkFileExists(null, '/', 'a.xlsx'), /Not authenticated/);
  assert.deepEqual(
    await checkFileExists(mockGraph({ getResult: { id: 'fx' } }).client, '/Documents', 'a.xlsx'),
    { exists: true, fileId: 'fx' },
  );
  assert.deepEqual(
    await checkFileExists(
      mockGraph({ getError: Object.assign(new Error('x'), { statusCode: 404 }) }).client,
      '/',
      'missing.xlsx',
    ),
    { exists: false },
  );
  await assert.rejects(
    () => checkFileExists(mockGraph({ getError: new Error('exists-fail') }).client, '/', 'a.xlsx'),
    /Failed to check file existence/,
  );

  await assert.rejects(() => checkFileExistsInDrive(null, 'd', 'root', 'a.xlsx'), /Not authenticated/);
  assert.deepEqual(
    await checkFileExistsInDrive(
      mockGraph({ getResult: { value: [{ id: 'fx2', name: 'a.xlsx' }] } }).client,
      'd1',
      'root',
      'a.xlsx',
    ),
    { exists: true, fileId: 'fx2' },
  );
  assert.deepEqual(
    await checkFileExistsInDrive(mockGraph({ getResult: { value: [] } }).client, 'd1', 'root', 'a.xlsx'),
    { exists: false },
  );
  await assert.rejects(
    () => checkFileExistsInDrive(mockGraph({ getError: new Error('in-drive') }).client, 'd', 'root', 'a.xlsx'),
    /Failed to check file existence/,
  );

  await assert.rejects(() => getTemplateIdFromExcel(null, 'f'), /Not authenticated/);
  assert.equal(await getTemplateIdFromExcel(mockGraph().client, 'f'), null);
});

test('getTemplateIdFromExcel reads _SurveyMetadata via exceljs', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const prevFetch = globalThis.fetch;

  async function bufferWithMeta(cells) {
    const wb = new ExcelJS.Workbook();
    if (cells) {
      const sheet = wb.addWorksheet('_SurveyMetadata');
      sheet.getCell('B1').value = cells.B1;
      sheet.getCell('B2').value = cells.B2;
    } else {
      wb.addWorksheet('Data');
    }
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  try {
    const withMetaBuf = await bufferWithMeta({ B1: 'tpl-42', B2: 'Survey Template' });
    globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => withMetaBuf });
    assert.deepEqual(
      await getTemplateIdFromExcel(
        mockGraph({ getResult: { '@microsoft.graph.downloadUrl': 'https://example.test/meta.xlsx' } }).client,
        'fid-meta',
      ),
      { templateId: 'tpl-42', templateName: 'Survey Template' },
    );

    const bareBuf = await bufferWithMeta(null);
    globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => bareBuf });
    assert.equal(
      await getTemplateIdFromExcel(
        mockGraph({ getResult: { '@microsoft.graph.downloadUrl': 'https://example.test/bare.xlsx' } }).client,
        'fid-bare',
      ),
      null,
    );

    const nullishBuf = await bufferWithMeta({ B1: null, B2: 99 });
    globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => nullishBuf });
    assert.deepEqual(
      await getTemplateIdFromExcel(
        mockGraph({ getResult: { '@microsoft.graph.downloadUrl': 'https://example.test/nullish.xlsx' } }).client,
        'fid-nullish',
      ),
      { templateId: null, templateName: '99' },
    );
  } finally {
    globalThis.fetch = prevFetch;
  }
});
