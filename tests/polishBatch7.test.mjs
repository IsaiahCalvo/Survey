import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Checklist answers: hover uses the hover fill and the grey chip shows on the chosen row', () => {
  const css = readFileSync(new URL('../src/home/AnswerSetPicker.css', import.meta.url), 'utf8');
  assert.match(css, /\.answer-set-option:not\(\.is-current\):hover \{ background: var\(--hover\); \}/);
  assert.match(css, /\.answer-set-option:is\(\.is-current, :active\) \.answer-chip:not\(\.is-good\)[^{]*\{ background: var\(--surface-2\); \}/);
});

test('History search glyph is the shared panel-head size', () => {
  const rp = readFileSync(new URL('../src/components/revisions/RevisionsPanel.jsx', import.meta.url), 'utf8');
  assert.match(rp, /size=\{mobileMode \? 20 : SECTION_ICON_SIZES\.desktop\.glyph\}/);
});

test('hover fills on panels use --hover, not the chosen fill', () => {
  const ans = readFileSync(new URL('../src/home/AnswerSetPicker.css', import.meta.url), 'utf8');
  const sheets = readFileSync(new URL('../src/sheets/sheetSet.css', import.meta.url), 'utf8');
  assert.match(ans, /\.template-answers-button:hover \{ background: var\(--hover\);/);
  assert.match(sheets, /\.projects-open-all-view:not\(\.is-picked\):hover \{ background: var\(--hover\);/);
});
