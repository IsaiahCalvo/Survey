import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Tablet (820 / 1024 wide) with the preview open: the list pane is narrow and
// the fixed columns pushed each row's More button off the right edge. The
// preview-open columns now live in hub.css with a container query that drops
// Size, then Project, so More always fits.
const jsx = readFileSync(new URL('../src/home/DocumentsLedger.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/home/hub.css', import.meta.url), 'utf8');

test('preview-open ledger columns come from CSS, not an inline fixed grid', () => {
  assert.doesNotMatch(jsx, /minmax\(150px,1fr\) 124px 124px 72px 36px/);
  assert.match(jsx, /documents-ledger-scroll/);
  assert.match(jsx, /documents-ledger-grid\$\{showPreview \? ' is-preview' : ''\}/);
  assert.equal((jsx.match(/documents-col-size/g) || []).length, 2);
  assert.equal((jsx.match(/documents-col-project/g) || []).length, 2);
});

test('narrow list panes drop Size and Project so More stays visible', () => {
  assert.match(css, /\.documents-ledger-scroll \{ container-type: inline-size; \}/);
  const narrow = css.slice(css.lastIndexOf('@container (max-width: 480px)')).match(/^@container \(max-width: 480px\) \{([^}]*\}){2}/);
  assert.ok(narrow, 'narrow container query present');
  assert.match(narrow[0], /documents-col-project \{ display: none; \}/);
  assert.match(narrow[0], /36px; \}/);
});

test('preview Share tooltip matches the owner-only toast wording', () => {
  assert.doesNotMatch(jsx, /'Only the owner can share'/);
  assert.equal((jsx.match(/'Only the owner can share this', 'above'/g) || []).length, 2);
});
