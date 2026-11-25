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
  // 2026-11-13: the Underline / Squiggle / Strikethrough / Redact text tools
  // ('text-markup-tools') share the mode, so it carries the kind.
  // 'text-review-remove' (Remove text marks) rides the same drag too.
  assert.match(viewer, /const textDragToolsOn = textHighlightToolEnabled \|\| textMarkupToolsEnabled \|\| textReviewRemoveEnabled;/);
  assert.match(viewer, /textDragToolsOn \? \[\{ id: 'text-highlight', label: 'Highlight text', iconName: 'textHighlightTool', highlightMode: 'highlight' \}\]/);
  assert.match(viewer, /useTextHighlightMode\(\{\s*on: textDragToolsOn && Boolean\(textHighlightMode\) && activeTool === 'text-select'/);
  assert.match(viewer, /: handleTextSelectionAction\(textDragKind, \{ keepSelection: false, preferLiveSelection: true, allowToggleOff: false \}\)\)/);
  assert.match(viewer, /\? handleTextSelectionRemove\(\{ keepSelection: false \}\)/);
  const migration = readFileSync(new URL('../supabase/migrations/20261112093000_text_highlight_tool_flag.sql', import.meta.url), 'utf8');
  assert.match(migration, /'text-highlight-tool', 'off'/);
});

test('#1693: a second highlight or underline drag takes the fresh live selection and never toggles off an earlier mark', async () => {
  const { resolveTextSelectionForAction } = await import('../src/hooks/useTextHighlightMode.js');
  const staleFirst = { text: 'Building', pages: [{ pageNumber: 1 }] };
  const freshSecond = { text: 'above', pages: [{ pageNumber: 1 }] };
  const selectedHighlight = { data: { type: 'text-markup', markupType: 'highlight' } };

  // A fresh drag (preferLive) ignores both a stale selected highlight and stale React state.
  assert.equal(resolveTextSelectionForAction({
    preferLive: true,
    selectedMarkup: selectedHighlight,
    selectedMarkupSelection: staleFirst,
    liveSelectionRef: staleFirst,
    liveSelectionState: staleFirst,
    captureLive: () => freshSecond,
  }), freshSecond);

  // Even without preferLive, the synchronous ref wins over lagging render state.
  assert.equal(resolveTextSelectionForAction({
    preferLive: false,
    selectedMarkup: null,
    liveSelectionRef: freshSecond,
    liveSelectionState: staleFirst,
    captureLive: () => freshSecond,
  }), freshSecond);

  // Non-drag toolbar clicks on a selected text markup still target that markup.
  assert.equal(resolveTextSelectionForAction({
    preferLive: false,
    selectedMarkup: selectedHighlight,
    selectedMarkupSelection: staleFirst,
    liveSelectionRef: null,
    liveSelectionState: null,
    captureLive: () => null,
  }), staleFirst);

  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /resolveTextSelectionForAction\(/);
  assert.match(viewer, /options\.allowToggleOff !== false/);
});

test('a release on the selection bar or other chrome is not the end of a drag', async () => {
  const { releasedOnChrome } = await import('../src/hooks/useTextHighlightMode.js');
  const on = (hit) => ({ target: { nodeType: 1, closest: (sel) => (hit && sel.includes('[role="toolbar"]') ? {} : null) } });
  assert.equal(releasedOnChrome(on(true)), true);
  assert.equal(releasedOnChrome(on(false)), false);
  // A text node inside a button counts through its parent.
  assert.equal(releasedOnChrome({ target: { nodeType: 3, parentElement: { closest: () => ({}) } } }), true);
  assert.equal(releasedOnChrome(null), false);
});

test('any other tool press, Select text included, ends Highlight text', () => {
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /setActiveToolLogged = useCallback\(\(next, \{ source, keepTextHighlight \} = \{\}\) => \{[\s\S]{0,300}if \(!keepTextHighlight\) setTextHighlightMode\(false\);/);
  assert.match(viewer, /setActiveToolLogged\('text-select', \{ source: 'toolbar', keepTextHighlight: true \}\)/);
  assert.match(viewer, /setActiveTool\(next\.activeTool\);\n    setTextHighlightMode\(false\);/);
  assert.match(viewer, /textHighlightMode: textDragToolsOn && Boolean\(textHighlightMode\),/);
  assert.match(shell, /const isTextSelect = bottomToolbarApi\.activeTool === 'text-select' && !bottomToolbarApi\.textHighlightMode;/);
});
