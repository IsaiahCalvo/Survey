import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parentDir,
  baseName,
  excelLockFilePath,
  isExcelOwnerFile,
  excelOwnerFileName,
  isOwnerFileFor,
} from '../src/services/excelLockFile.js';

test('path helpers split unix and windows paths', () => {
  assert.equal(parentDir('/tmp/work/Report.xlsx'), '/tmp/work');
  assert.equal(baseName('/tmp/work/Report.xlsx'), 'Report.xlsx');
  assert.equal(parentDir('Report.xlsx'), '');
  assert.equal(baseName('Report.xlsx'), 'Report.xlsx');
  assert.equal(parentDir('C:\\docs\\A.xlsx'), 'C:\\docs');
  assert.equal(baseName('C:\\docs\\A.xlsx'), 'A.xlsx');
});

test('excelLockFilePath builds the ~$ owner file path', () => {
  assert.equal(excelLockFilePath('/tmp/Report.xlsx'), '/tmp/~$Report.xlsx');
  assert.equal(excelLockFilePath('Report.xlsx'), '~$Report.xlsx');
  assert.equal(excelLockFilePath(''), null);
  assert.equal(excelLockFilePath(null), null);
});

test('owner-file detectors match only the target workbook', () => {
  assert.equal(isExcelOwnerFile('~$Report.xlsx'), true);
  assert.equal(isExcelOwnerFile('Report.xlsx'), false);
  assert.equal(excelOwnerFileName('/tmp/Report.xlsx'), '~$Report.xlsx');
  assert.equal(isOwnerFileFor('~$Report.xlsx', '/tmp/Report.xlsx'), true);
  assert.equal(isOwnerFileFor('~$report.xlsx', '/tmp/Report.xlsx'), true);
  assert.equal(isOwnerFileFor('~$Budget.xlsx', '/tmp/Report.xlsx'), false);
  assert.equal(isOwnerFileFor(null, '/tmp/Report.xlsx'), false);
});
