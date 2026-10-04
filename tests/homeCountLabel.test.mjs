import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countLabel } from '../src/home/countLabel.js';

test('countLabel says one thing in the singular and the rest in the plural', () => {
  assert.equal(countLabel(1, 'file'), '1 file');
  assert.equal(countLabel(0, 'file'), '0 files');
  assert.equal(countLabel(3, 'page'), '3 pages');
  assert.equal(countLabel(1, 'category', 'categories'), '1 category');
  assert.equal(countLabel(2, 'entity', 'entities'), '2 entities');
});

test('home count lines no longer hand-write a plural after a number', () => {
  const files = ['TemplatesEditor.jsx', 'ProjectsFolderTree.jsx', 'ArchiveScreen.jsx', 'DocumentsLedger.jsx'];
  for (const f of files) {
    const src = readFileSync(new URL(`../src/home/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\.length\}\s+(modules|categories|entities|files|members)\b/, f);
    assert.doesNotMatch(src, /(pages|pageCount)\}\s+pages`/, f);
  }
});
