import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const CSS = fs.readFileSync(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url), 'utf8');
const TOAST = fs.readFileSync(new URL('../src/components/ToastHost.css', import.meta.url), 'utf8');

test('phone rail survey discs carry an invisible tap pad over their slot', () => {
  for (const column of ['survey-categories', 'survey-entities']) {
    const re = new RegExp(`\\.mobile-pdf-tools__${column} button::after[^{]*\\{[^}]*content: ''[^}]*position: absolute[^}]*inset-block:[^}]*inset-inline: calc\\(\\(var\\(--mobile-rail-sub-w\\) - var\\(--mobile-rail-disc\\)\\) / -2\\)`);
    assert.match(CSS, re, `${column} discs need the slot-wide pad`);
  }
  assert.match(CSS, /\.mobile-pdf-tools__survey-entities button \{\s*position: relative;/);
});

test('toast action (Undo and the like) keeps its 44px phone tap pad', () => {
  assert.match(TOAST, /\.app-toast__action::after \{[^}]*width: max\(100%, 44px\);[^}]*height: max\(100%, 44px\);/);
});
