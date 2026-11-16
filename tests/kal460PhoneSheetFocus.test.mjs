import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// KAL-460: the phone tool settings sheet and the colour picker sheet are modal
// through useSheetFocus, except over live text editing, where moving focus off
// the text being typed would end the edit.
const src = readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');

test('colour picker sheet traps focus unless told not to', () => {
  assert.match(src, /function MobileColorPickerSurface\(\{[^}]*trapFocus = true[^}]*\}\)/);
  assert.match(src, /const sheetFocusRef = useSheetFocus\(trapFocus, requestClose, sheetProps\.ref\);/);
  const surface = src.slice(src.indexOf('className="mobile-pdf-colorpicker-surface"'));
  assert.match(surface.slice(0, 400), /ref=\{sheetFocusRef\}/);
});

test('the live font colour sheet leaves focus on the text being typed', () => {
  const live = src.slice(src.indexOf("colorPicker === 'fontColorLive'"));
  const block = live.slice(0, live.indexOf('/>'));
  assert.match(block, /trapFocus=\{false\}/);
});

test('tool settings sheet traps focus, but not during text editing', () => {
  assert.match(src, /useSheetFocus\(\s*textDefaultsOpen && !api\?\.richTextEditor,\s*requestTextSheetClose,\s*textSheetProps\.ref,\s*\)/);
  const sheet = src.slice(src.indexOf('aria-label={`${sheetTitle} settings`}') - 200);
  assert.match(sheet.slice(0, 500), /role="dialog"[\s\S]*aria-modal="true"[\s\S]*ref=\{textSheetFocusRef\}/);
});
