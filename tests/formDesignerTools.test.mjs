/**
 * KAL-47 — Unit tests for the Survey-native Forms toolbar helpers.
 *
 * These exercise the small pure module that backs the Forms category
 * dropdown in App.jsx. The tests deliberately do NOT mount React or
 * Pdfjs — they pin the contract between the toolbar IDs, the
 * Pdfjs FormFieldType strings, and the `addFormField` payload shape.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FORM_TOOLS,
  FORM_TOOL_IDS,
  getFormToolById,
  getFormFieldTypeForTool,
  isFormTool,
  buildFieldSettings,
  sizeBoundsForType,
  buildFormFieldUpdate,
} from '../src/components/formDesignerTools.js';

test('FORM_TOOLS covers v1 scope: textbox, checkbox, radio, signature', () => {
  const ids = FORM_TOOLS.map((t) => t.id).sort();
  assert.deepEqual(ids, ['form-checkbox', 'form-radio', 'form-signature', 'form-textbox']);
});

test('FORM_TOOL_IDS is derived from FORM_TOOLS and stable', () => {
  assert.equal(FORM_TOOL_IDS.length, FORM_TOOLS.length);
  for (const id of FORM_TOOL_IDS) {
    assert.equal(typeof id, 'string');
    assert.match(id, /^form-/);
  }
});

test('isFormTool matches form-* ids only', () => {
  assert.equal(isFormTool('form-textbox'), true);
  assert.equal(isFormTool('form-checkbox'), true);
  assert.equal(isFormTool('form-radio'), true);
  assert.equal(isFormTool('form-signature'), true);
  assert.equal(isFormTool('pen'), false);
  assert.equal(isFormTool('pan'), false);
  assert.equal(isFormTool(null), false);
  assert.equal(isFormTool(undefined), false);
});

test('getFormFieldTypeForTool maps to Pdfjs FormFieldType strings', () => {
  assert.equal(getFormFieldTypeForTool('form-textbox'), 'Textbox');
  assert.equal(getFormFieldTypeForTool('form-checkbox'), 'CheckBox');
  assert.equal(getFormFieldTypeForTool('form-radio'), 'RadioButton');
  assert.equal(getFormFieldTypeForTool('form-signature'), 'SignatureField');
  assert.equal(getFormFieldTypeForTool('pen'), null);
  assert.equal(getFormFieldTypeForTool(null), null);
});

test('getFormToolById returns full metadata or null', () => {
  const tool = getFormToolById('form-textbox');
  assert.ok(tool);
  assert.equal(tool.formFieldType, 'Textbox');
  assert.equal(typeof tool.label, 'string');
  assert.equal(typeof tool.iconName, 'string');
  assert.equal(getFormToolById('unknown'), null);
});

test('sizeBoundsForType: checkbox + radio are square 20x20', () => {
  const cb = sizeBoundsForType('CheckBox', { x: 5, y: 10, width: 9999, height: 9999 });
  assert.deepEqual(cb, { x: 5, y: 10, width: 20, height: 20 });
  const rb = sizeBoundsForType('RadioButton', { x: 1, y: 2, width: 50, height: 50 });
  assert.deepEqual(rb, { x: 1, y: 2, width: 20, height: 20 });
});

test('sizeBoundsForType: signature is wider 180x40', () => {
  const sig = sizeBoundsForType('SignatureField', { x: 0, y: 0 });
  assert.deepEqual(sig, { x: 0, y: 0, width: 180, height: 40 });
});

test('sizeBoundsForType: textbox honours width/height with sensible defaults', () => {
  const defaulted = sizeBoundsForType('Textbox', { x: 7, y: 8 });
  assert.deepEqual(defaulted, { x: 7, y: 8, width: 150, height: 24 });
  const sized = sizeBoundsForType('Textbox', { x: 7, y: 8, width: 200, height: 30 });
  assert.deepEqual(sized, { x: 7, y: 8, width: 200, height: 30 });
});

test('buildFieldSettings(Textbox) emits all the keys Pdfjs expects', () => {
  const settings = buildFieldSettings('Textbox', {
    pageNumber: 3,
    bounds: { x: 50, y: 60, width: 220, height: 28 },
    name: 'Survey_NameField'
  });
  assert.equal(settings.name, 'Survey_NameField');
  assert.equal(settings.pageNumber, 3);
  assert.deepEqual(settings.bounds, { x: 50, y: 60, width: 220, height: 28 });
  assert.equal(settings.value, '');
  // Single-name font — matches the project rule from CLAUDE.md (Fabric textbox
  // gotcha). Survey form fields aren't Fabric, but using a single name keeps
  // the rule consistent across the codebase.
  assert.equal(settings.fontFamily, 'Helvetica');
  assert.equal(settings.fontSize, 12);
  assert.equal(settings.isReadOnly, false);
  assert.equal(settings.isRequired, false);
  assert.equal(settings.isPrint, true);
});

test('buildFieldSettings(CheckBox) is minimal and bounded', () => {
  const settings = buildFieldSettings('CheckBox', {
    pageNumber: 1,
    bounds: { x: 100, y: 200 }
  });
  assert.deepEqual(settings.bounds, { x: 100, y: 200, width: 20, height: 20 });
  assert.equal(typeof settings.name, 'string');
  assert.equal(settings.isReadOnly, false);
  assert.equal(settings.isRequired, false);
});

test('buildFieldSettings(SignatureField) defaults to 180x40 at (x,y)', () => {
  const settings = buildFieldSettings('SignatureField', {
    pageNumber: 2,
    bounds: { x: 30, y: 40 }
  });
  assert.deepEqual(settings.bounds, { x: 30, y: 40, width: 180, height: 40 });
  assert.equal(settings.pageNumber, 2);
});

test('buildFieldSettings generates unique-ish names by default', () => {
  const a = buildFieldSettings('Textbox', { pageNumber: 1, bounds: { x: 0, y: 0 } });
  const b = buildFieldSettings('Textbox', { pageNumber: 1, bounds: { x: 0, y: 0 } });
  // Either both are timestamped (different `_xxx` suffix) or at minimum the
  // default name follows the pattern `<Type>_<token>`. We don't require
  // uniqueness across the same millisecond, just the pattern.
  assert.match(a.name, /^Textbox_/);
  assert.match(b.name, /^Textbox_/);
});

test('buildFormFieldUpdate forwards only known keys', () => {
  const update = buildFormFieldUpdate({
    name: 'Address',
    value: '123 Main St',
    tooltip: 'Street address',
    isRequired: true,
    isReadOnly: false,
    // Unknown / unsupported keys must be dropped — otherwise Pdfjs
    // throws on undefined fields in `updateFormField`.
    extra: 'ignored',
    pageNumber: 5
  });
  assert.deepEqual(update, {
    name: 'Address',
    value: '123 Main St',
    tooltip: 'Street address',
    isRequired: true,
    isReadOnly: false
  });
});

test('buildFormFieldUpdate ignores wrong-typed inputs', () => {
  const update = buildFormFieldUpdate({
    name: 42,
    value: null,
    tooltip: undefined,
    isRequired: 'yes',
    isReadOnly: 1
  });
  assert.deepEqual(update, {});
});
