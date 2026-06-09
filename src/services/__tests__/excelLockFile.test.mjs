import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parentDir, baseName, excelLockFilePath, isExcelOwnerFile, excelOwnerFileName, isOwnerFileFor } from '../excelLockFile.js';

test('splits an absolute macOS path', () => {
  const p = '/Users/isaiahcalvo/Desktop/Security_export.xlsx';
  assert.equal(parentDir(p), '/Users/isaiahcalvo/Desktop');
  assert.equal(baseName(p), 'Security_export.xlsx');
  assert.equal(excelLockFilePath(p), '/Users/isaiahcalvo/Desktop/~$Security_export.xlsx');
});

test('handles a bare filename (no directory)', () => {
  assert.equal(parentDir('foo.xlsx'), '');
  assert.equal(excelLockFilePath('foo.xlsx'), '~$foo.xlsx');
});

test('handles a Windows path separator', () => {
  const p = 'C:\\Users\\me\\book.xlsx';
  assert.equal(excelLockFilePath(p), 'C:\\Users\\me\\~$book.xlsx');
});

test('empty path → null lock path', () => {
  assert.equal(excelLockFilePath(''), null);
  assert.equal(excelLockFilePath(null), null);
});

test('owner-file detection', () => {
  assert.equal(isExcelOwnerFile('~$Security_export.xlsx'), true);
  assert.equal(isExcelOwnerFile('Security_export.xlsx'), false);
  assert.equal(isExcelOwnerFile(undefined), false);
});

test('owner-file NAME for a workbook (no directory)', () => {
  assert.equal(excelOwnerFileName('/Users/x/Desktop/Security_export.xlsx'), '~$Security_export.xlsx');
  assert.equal(excelOwnerFileName(''), null);
});

test('exact owner-file match blocks only this workbook', () => {
  const target = '/Users/x/Desktop/Security_export.xlsx';
  // This workbook's own owner file blocks it.
  assert.equal(isOwnerFileFor('~$Security_export.xlsx', target), true);
  // Case-insensitive (macOS/Windows default filesystems).
  assert.equal(isOwnerFileFor('~$security_export.XLSX', target), true);
});

test('a different open workbook in the same folder does NOT block this one', () => {
  const target = '/Users/x/Desktop/Security_export.xlsx';
  // Some OTHER workbook is open in the same folder — must not block the target push.
  assert.equal(isOwnerFileFor('~$Budget.xlsx', target), false);
  assert.equal(isOwnerFileFor('~$Security_export_v2.xlsx', target), false);
  // Non-owner entries are ignored.
  assert.equal(isOwnerFileFor('Security_export.xlsx', target), false);
  assert.equal(isOwnerFileFor(undefined, target), false);
});
