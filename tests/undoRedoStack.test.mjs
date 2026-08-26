import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isUndoKeyEvent,
  isRedoKeyEvent,
  isUndoRedoBlocked,
} from '../src/utils/undoRedoHotkeys.js';

// Source contracts for E-05 Undo / Redo stack (intended + break + edge).
// Live proof: debug/scenarios/e2e-undo-redo-stack.spec.mjs
// Distinct from the 2026-08-21 keyboard sample matrix, P1-45 bookmark
// undo, style-catalog undo-as-edge, and leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const keyEvent = ({
  key,
  code,
  metaKey = false,
  ctrlKey = false,
  shiftKey = false,
  altKey = false,
} = {}) => ({ key, code, metaKey, ctrlKey, shiftKey, altKey });

test('undo/redo chords: Ctrl/Cmd+Z undo; Shift+Z and Y redo; Alt and INPUT blocked', () => {
  assert.equal(isUndoKeyEvent(keyEvent({ key: 'z', code: 'KeyZ', ctrlKey: true })), true);
  assert.equal(isUndoKeyEvent(keyEvent({ key: 'z', code: 'KeyZ', metaKey: true })), true);
  assert.equal(isRedoKeyEvent(keyEvent({ key: 'z', code: 'KeyZ', ctrlKey: true })), false);

  assert.equal(isRedoKeyEvent(keyEvent({ key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true })), true);
  assert.equal(isRedoKeyEvent(keyEvent({ key: 'y', code: 'KeyY', ctrlKey: true })), true);
  assert.equal(isUndoKeyEvent(keyEvent({ key: 'y', code: 'KeyY', ctrlKey: true })), false);

  assert.equal(isUndoKeyEvent(keyEvent({ key: 'z', code: 'KeyZ', ctrlKey: true, altKey: true })), false);
  assert.equal(isRedoKeyEvent(keyEvent({ key: 'y', code: 'KeyY', ctrlKey: true, altKey: true })), false);

  assert.equal(isUndoRedoBlocked(null), false);
  assert.equal(isUndoRedoBlocked({
    body: { getAttribute: () => null },
    querySelector: () => null,
    activeElement: { tagName: 'INPUT' },
  }), true);
  assert.equal(isUndoRedoBlocked({
    body: { getAttribute: () => 'true' },
    querySelector: () => null,
    activeElement: { tagName: 'DIV' },
  }), true);
  assert.equal(isUndoRedoBlocked({
    body: { getAttribute: () => null },
    querySelector: (sel) => (sel === '[data-region-selection-ui="true"]' ? {} : null),
    activeElement: { tagName: 'DIV' },
  }), true);
});

test('viewer capture listener + toolbar chrome + new action clears redo', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /isUndoKeyEvent/);
  assert.match(viewer, /isRedoKeyEvent/);
  assert.match(viewer, /isUndoRedoBlocked/);
  assert.match(viewer, /addEventListener\('keydown', handleUndoRedoKey, \{ capture: true \}/);
  assert.match(viewer, /setRedoHistory\(\[\]\); \/\/ Clear redo history when new action is performed/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /data-undo-redo-controls="true"/);
  assert.match(shell, /aria-label="Undo"/);
  assert.match(shell, /aria-label="Redo"/);
  assert.match(shell, /disabled=\{!topToolbarApi\.canUndo\}/);
  assert.match(shell, /disabled=\{!topToolbarApi\.canRedo\}/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /aria-label="Undo"/);
  assert.match(mobile, /aria-label="Redo"/);
  assert.match(mobile, /disabled=\{!topToolbarApi\?\.canUndo\}/);

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /keys: \['Ctrl', 'Z'\], description: 'Undo'/);
  assert.match(overlay, /keys: \['Ctrl', 'Shift', 'Z'\], description: 'Redo'/);
});

test('live spec covers Ctrl+Z / Shift+Z / Y + toolbar + empty + input-block + redo-clear', () => {
  const spec = read('debug/scenarios/e2e-undo-redo-stack.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /empty-stack chords must hold imported ids/);
  assert.match(spec, /Ctrl\+Z must drop B and keep A/);
  assert.match(spec, /Ctrl\+Shift\+Z must restore B/);
  assert.match(spec, /Ctrl\+Y must restore B/);
  assert.match(spec, /toolbar Undo must drop B/);
  assert.match(spec, /toolbar Redo must restore B/);
  assert.match(spec, /two Ctrl\+Z must drop A and B/);
  assert.match(spec, /Ctrl\+Z in zoom INPUT must keep A and B/);
  assert.match(spec, /cleared redo must not restore B/);
  assert.match(spec, /Select \/ empty page invents 0/);
  assert.match(spec, /390 toolbar Undo drops B/);
  assert.match(spec, /390 Ctrl\+Y restores B/);
  assert.match(spec, /hubPreview/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
