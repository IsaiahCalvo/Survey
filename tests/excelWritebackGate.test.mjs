// Stage 0 — Excel writeback safety switch.
//
// While automatic (silent) writeback is disabled, the silent whole-workbook
// upload path must be blocked and manual (non-silent) export must pass through.
// This pins the gate decision the export chokepoint in PDFViewer relies on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXCEL_AUTOMATIC_WRITEBACK_ENABLED,
  isSilentWritebackBlocked,
} from '../src/utils/excelWritebackGate.js';

test('the safety switch ships OFF (automatic writeback disabled)', () => {
  assert.equal(EXCEL_AUTOMATIC_WRITEBACK_ENABLED, false);
});

test('silent (automatic) writeback is blocked while the switch is off', () => {
  assert.equal(isSilentWritebackBlocked(true, false), true);
});

test('manual (non-silent) export is never blocked', () => {
  assert.equal(isSilentWritebackBlocked(false, false), false);
  assert.equal(isSilentWritebackBlocked(false, true), false);
});

test('nothing is blocked once the switch is enabled (Stage 3)', () => {
  assert.equal(isSilentWritebackBlocked(true, true), false);
});

test('defaults to the shipped switch value when enabled is omitted', () => {
  // With the switch off, an omitted-arg silent call is blocked.
  assert.equal(isSilentWritebackBlocked(true), !EXCEL_AUTOMATIC_WRITEBACK_ENABLED);
});
