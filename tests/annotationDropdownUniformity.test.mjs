import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const component = await readFile(new URL('../src/components/AnnotationDropdown.jsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/components/AnnotationDropdown.css', import.meta.url), 'utf8');
const sizeControl = await readFile(new URL('../src/components/AnnotationSizeControl.jsx', import.meta.url), 'utf8');
const appShell = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');

test('annotation dropdowns share the Width preset surface and Radix behavior', () => {
  assert.match(component, /@radix-ui\/react-popover/);
  assert.match(component, /data-annotation-dropdown-popover="true"/);
  assert.match(component, /role="listbox"/);
  assert.match(component, /role="option"/);
  assert.match(component, /event\.key === 'ArrowDown'/);
  assert.match(component, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(component, /if \(preserveFocus\) event\.preventDefault\(\)/);
  assert.match(component, /event\.stopPropagation\(\)/);
  assert.match(component, /onMouseDownCapture/);
  assert.match(component, /onPointerDownCapture/);
  assert.match(component, /onOpenAutoFocus/);
  assert.match(component, /onCloseAutoFocus/);
  assert.match(component, /keepEditorFocusForCycleRef/);
  assert.match(component, /editorFocusElementRef/);
  assert.match(component, /document\.querySelector\('\[contenteditable="plaintext-only"\]'\)/);
  assert.match(component, /focusTarget\?\.focus/);
  assert.match(component, /editorFocusElementRef\.current\.focus\(\{ preventScroll: true \}\)/);
  assert.match(component, /document\.activeElement\?\.closest\?\.\('\.annotation-dropdown, \.annotation-dropdown__popover'\)/);
  assert.match(component, /onPointerDownOutside/);
  assert.match(component, /onFocusOutside/);
  assert.match(css, /background: #0d0f14/);
  assert.match(css, /border: 1px solid #3a4252/);
  assert.match(css, /border-radius: 8px/);
  assert.match(css, /box-shadow: 0 10px 30px rgba\(0, 0, 0, 0\.48\)/);
  assert.match(css, /min-height: 34px/);
});

test('only numeric size menus render an input and all annotation menus are mutually exclusive', () => {
  assert.match(sizeControl, /<input \{\.\.\.inputProps\}/);
  assert.match(sizeControl, /open: controlledOpen/);
  assert.match(sizeControl, /onOpenChange/);
  assert.match(appShell, /open=\{openAnnotationDropdown === 'size'\}/);
  assert.match(appShell, /label="Style"/);
  assert.match(appShell, /label="Arrowhead"/);
  assert.match(appShell, /label="Eraser type"/);
  assert.match(appShell, /label="Counter series"/);
  assert.match(appShell, /label="Font"/);
  assert.match(appShell, /label="Font size"/);
  assert.match(appShell, /label="Text alignment"/);
  assert.ok((appShell.match(/preserveFocus/g) || []).length >= 3, 'rich-text dropdowns must preserve the active Fabric selection');
  assert.match(appShell, /bottomToolbarApi\?\.setShowAnnotationColorPicker\?\.\(false\);\s*setOpenAnnotationDropdown\(null\);/);
  assert.match(appShell, /if \(!openAnnotationDropdown\) return;[\s\S]*setShowFontColorPicker\(false\)[\s\S]*setShowAnnotationColorPicker/);
  assert.match(appShell, /if \(!bottomToolbarApi\?\.showAnnotationColorPicker\) return;[\s\S]*setOpenAnnotationDropdown\(null\)/);
  assert.doesNotMatch(component, /<input/);
});

test('portaled Counter series rows suppress the underlying annotation context menu', () => {
  assert.match(component, /<Popover\.Content[\s\S]*\{\.\.\.markerProps\}/);
  assert.match(appShell, /dataMarker="data-counter-series-menu"/);
  assert.match(appShell, /outsideBoundarySelector="\[data-counter-series-context-menu\]"/);
});
