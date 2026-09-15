import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('viewer exposes both private tool-default conflict choices from the hook', () => {
  const hookStart = source.indexOf('// Per-document, per-tool preferences hook');
  const hookEnd = source.indexOf('// Input field state for stroke width', hookStart);
  const hook = source.slice(hookStart, hookEnd);
  assert.match(hook, /preferenceConflict: toolPreferencesConflict/);
  assert.match(hook, /keepShownToolPreferences/);
  assert.match(hook, /useSavedToolPreferences/);

  const noticeStart = source.indexOf('{toolPreferencesConflict && (');
  const noticeEnd = source.indexOf('{/* Hidden custom print panel implementation.', noticeStart);
  const notice = source.slice(noticeStart, noticeEnd);
  assert.match(notice, /role="alertdialog"/);
  assert.match(notice, /Use saved defaults/);
  assert.match(notice, /Keep my shown defaults/);
  assert.match(notice, /may replace defaults saved in the other window/);
});
