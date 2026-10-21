import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// PDF tools from the viewer must not need the network. A streamed open (#1097)
// leaves the tab with the library row, not a File, so the bytes come from the
// viewer's loaded pdf.js document (the offline Android walk caught this).
const src = fs.readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('const openPdfToolsForActiveTab'), src.indexOf('const openPdfToolsRef'));

test('viewer PDF tools fall back to the open pdf.js document bytes', () => {
  assert.match(body, /file instanceof Blob && file\.size > 0/);
  assert.match(body, /leftRailApi\?\.pdfDoc\?\.getData\?\.\(\)/);
  assert.match(body, /new Blob\(\[data\]/);
});
