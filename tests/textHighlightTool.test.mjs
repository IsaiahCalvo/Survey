// Highlight text (Nightly 'text-highlight-tool').
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveHighlightPaint } from '../src/hooks/useTextHighlightMode.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

test('the live band takes the highlight colour and opacity', () => {
  assert.equal(liveHighlightPaint('#f5c229', 40), 'rgba(245, 194, 41, 0.4)');
  assert.equal(liveHighlightPaint('#0f0', 100), 'rgba(0, 255, 0, 1)');
  assert.equal(liveHighlightPaint('nope', 50), 'rgba(245, 194, 41, 0.4)');
  assert.equal(liveHighlightPaint('#000000', 1), 'rgba(0, 0, 0, 0.15)');
});

test('flag, button and wiring', () => {
  assert.equal(FEATURE_FLAGS['text-highlight-tool'].stage, 'beta');
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /textHighlightToolEnabled \? \[\{ id: 'text-highlight', label: 'Highlight text'/);
  assert.match(viewer, /useTextHighlightMode\(\{\s*on: textHighlightToolEnabled && textHighlightMode && activeTool === 'text-select'/);
  assert.match(viewer, /apply: \(\) => handleTextSelectionAction\('highlight', \{ keepSelection: false \}\)/);
  const migration = readFileSync(new URL('../supabase/migrations/20261112093000_text_highlight_tool_flag.sql', import.meta.url), 'utf8');
  assert.match(migration, /'text-highlight-tool', 'off'/);
});
