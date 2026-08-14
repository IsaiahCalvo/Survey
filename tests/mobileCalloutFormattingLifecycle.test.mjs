import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const TEXT_EDIT_OVERLAY_SOURCE = readFileSync(
  new URL('../src/components/TextEditOverlay.jsx', import.meta.url),
  'utf8',
);

test('committing mobile callout text clears the rich-text bridge before selection resumes', () => {
  assert.match(
    TEXT_EDIT_OVERLAY_SOURCE,
    /const commitAndClose = useCallback[\s\S]{0,520}onRichTextEditorChange\(null\);[\s\S]{0,120}const s = styleRef\.current/,
  );
});

test('cancelling mobile callout text also clears the rich-text bridge immediately', () => {
  assert.match(
    TEXT_EDIT_OVERLAY_SOURCE,
    /const cancelAndClose = useCallback[\s\S]{0,220}onRichTextEditorChange\(null\);[\s\S]{0,100}onEditCancel/,
  );
});

test('a queued style frame cannot republish formatting after callout text commits', () => {
  assert.match(
    TEXT_EDIT_OVERLAY_SOURCE,
    /const publishBridge = useCallback[\s\S]{0,240}if \(committedRef\.current\) return;[\s\S]{0,120}onRichTextEditorChange/,
  );
});
