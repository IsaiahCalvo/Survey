import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nameSize, pageRow, summarize, docFacts, toCsv, inches, mm, formatBytes,
} from '../pageSizes.js';

const PT = 72;

test('page sizes: common sheets get their names', () => {
  assert.deepEqual(nameSize(8.5 * PT, 11 * PT), { name: 'Letter (ANSI A)', orientation: 'portrait' });
  assert.deepEqual(nameSize(14 * PT, 8.5 * PT), { name: 'Legal', orientation: 'landscape' });
  assert.equal(nameSize(11 * PT, 17 * PT).name, 'Tabloid 11x17 (ANSI B)');
  assert.deepEqual(nameSize(36 * PT, 24 * PT), { name: 'ARCH D', orientation: 'landscape' });
  assert.equal(nameSize(42 * PT, 30 * PT).name, 'ARCH E1');
  assert.equal(nameSize(48 * PT, 36 * PT).name, 'ARCH E');
  assert.equal(nameSize(9 * PT, 12 * PT).name, 'ARCH A');
  assert.equal(nameSize(22 * PT, 34 * PT).name, 'ANSI D');
  assert.equal(nameSize(34 * PT, 44 * PT).name, 'ANSI E');
  assert.equal(nameSize(595.28, 841.89).name, 'A4');
  assert.equal(nameSize(2383.94, 3370.39).name, 'A0');
  assert.equal(nameSize(1683.78, 2383.94).name, 'A1');
  assert.equal(nameSize(419.53, 595.28).name, 'A5');
});

test('page sizes: a small tolerance, and custom when nothing is close', () => {
  // A scan a couple of points off is still Letter.
  assert.equal(nameSize(613.5, 790).name, 'Letter (ANSI A)');
  // A4 and Letter are close, but not that close.
  assert.notEqual(nameSize(595, 792).name, 'Letter (ANSI A)');
  assert.equal(nameSize(500, 700).name, 'Custom');
  assert.equal(nameSize(500, 500).orientation, 'square');
});

test('page sizes: a turned page is measured as it shows', () => {
  const r = pageRow(0, [0, 0, 24 * PT, 36 * PT], 90, true);
  assert.equal(r.page, 1);
  assert.equal(r.name, 'ARCH D');
  assert.equal(r.orientation, 'landscape');
  assert.equal(inches(r.width), '36');
  assert.equal(mm(r.width), '914');
  assert.equal(pageRow(2, [10, 10, 622, 802], -90, false).rotate, 270);
  assert.equal(pageRow(2, [10, 10, 622, 802], 0, false).orientation, 'portrait');
});

test('page sizes: summary of one size or many', () => {
  const d = pageRow(0, [0, 0, 36 * PT, 24 * PT], 0, true);
  assert.equal(summarize([d, { ...d, page: 2 }]), 'All 2 pages are ARCH D, landscape.');
  assert.equal(summarize([d]), 'The page is ARCH D, landscape.');
  const letter = pageRow(2, [0, 0, 612, 792], 0, true);
  assert.equal(summarize([d, d, letter]), '2 page sizes. ARCH D, landscape: 2 pages. Letter (ANSI A), portrait: 1 page.');
  assert.match(summarize([pageRow(0, [0, 0, 500, 700], 0, true)]), /Custom size 6\.94 x 9\.72 in/);
  assert.equal(summarize([]), 'This PDF has no pages.');
});

test('page sizes: facts and CSV', () => {
  const facts = docFacts({
    pages: 2, fileSize: 3 * 1024 * 1024, info: { Title: 'Plans, Rev "B"', Producer: 'Revit', Creator: 'Revit', PDFFormatVersion: '1.7' }, encrypted: false, fields: 3, scanned: 1,
  });
  const get = (k) => facts.find(([label]) => label === k)[1];
  assert.equal(get('File size'), '3.0 MB');
  assert.equal(get('Made with'), 'Revit');
  assert.equal(get('Author'), 'None');
  assert.equal(get('Form fields'), 'Yes, 3');
  assert.equal(get('Pages with no text'), '1 (may be scans)');
  assert.equal(get('Password or limits'), 'No');
  const rows = [pageRow(0, [0, 0, 36 * PT, 24 * PT], 0, true), pageRow(1, [0, 0, 612, 792], 0, false)];
  const csv = toCsv(facts, rows);
  assert.match(csv, /^Pages,2\r\n/);
  assert.match(csv, /Title,"Plans, Rev ""B"""\r\n/);
  assert.match(csv, /\r\nPage,Size,Orientation,Width \(in\),Height \(in\),Width \(mm\),Height \(mm\),Rotation,Has text\r\n/);
  assert.match(csv, /\r\n1,ARCH D,landscape,36,24,914,610,0,Yes\r\n/);
  assert.match(csv, /\r\n2,Letter \(ANSI A\),portrait,8\.5,11,216,279,0,No\r\n$/);
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(2048), '2 KB');
});

test('page sizes: /UserUnit scales the page box', () => {
  const r = pageRow(0, [0, 0, 306, 396], 0, true, 2);
  assert.equal(r.width, 612);
  assert.equal(r.height, 792);
  assert.match(r.name, /Letter/);
});
