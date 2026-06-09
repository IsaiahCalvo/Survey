import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parentDir, baseName, excelLockFilePath, isExcelOwnerFile } from '../excelLockFile.js';

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
