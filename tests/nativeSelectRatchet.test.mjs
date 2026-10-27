// Owner 2026-10-27: a browser <select> "looks nothing like any of our other
// dropdowns" and draws a white border. Off the phone, a pick-one list is the
// app's own drop-down: ValueSelect (src/components/ValueSelect.jsx), which is
// the toolbar's AnnotationDropdown. Phones keep the browser's own wheel
// (owner decision 3, 2026-07-12), so a phone-only branch may still render one.
//
// This is a ratchet: no file may gain a native <select>, and a file not
// listed here may have none. When you move one over, lower its count here in
// the same change; when a file reaches 0, drop it from the list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const ALLOWED = {
  // Old edit modal inside the high-risk per-page layer.
  'src/PageAnnotationLayer.jsx': 2,
  // The phone layout's rows (the browser's wheel).
  'src/home/TemplatesEditor.jsx': 3,
  // Beta answer editors (nightly 'custom-answers'): phone rows keep the
  // wheel; the answer-kind list (it has groups) is still to move.
  'src/home/AnswerSetEditor.jsx': 4,
  'src/components/TypedAnswerInput.jsx': 2,
  // Phone panel (the browser's wheel).
  'src/components/PageGridSettings.jsx': 1,
  // Admin-only page.
  'src/home/KitsAdminPage.jsx': 1,
};

// A JSX <select> element at the start of a line (comments that mention
// "<select>" in prose do not count).
const NATIVE_SELECT = /^\s*(?:return \(?\s*)?<select(?:\s|>|$)/gm;

function jsxFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!['__tests__', 'prototype', 'mobile'].includes(name)) jsxFiles(path, out);
    } else if (name.endsWith('.jsx')) out.push(path);
  }
  return out;
}

test('no native <select> outside the phone layouts and the listed files, and no file gains one', () => {
  const over = [];
  for (const path of jsxFiles(join(root, 'src'))) {
    const file = relative(root, path).split('\\').join('/');
    const count = (readFileSync(path, 'utf8').match(NATIVE_SELECT) || []).length;
    const max = ALLOWED[file] ?? 0;
    if (count > max) over.push(`${file}: ${count} native <select> (max ${max}); use ValueSelect`);
  }
  assert.deepEqual(over, []);
});

test('ValueSelect is the shared drop-down, and its list is the topmost popover while open', () => {
  const source = readFileSync(join(root, 'src/components/ValueSelect.jsx'), 'utf8');
  assert.match(source, /import AnnotationDropdown from '\.\/AnnotationDropdown\.jsx';/);
  assert.match(source, /watchLightPopover\(/);
  const css = readFileSync(join(root, 'src/components/ValueSelect.css'), 'utf8');
  // Over every dialog (theme Z_INDEX.modalOverlay is 10000).
  assert.match(css, /\.annotation-dropdown__popover\.value-select__menu \{\s*z-index: 10000;/);
  // The trigger stays the borderless setting pill: no border anywhere.
  assert.doesNotMatch(css, /border:\s*1px/);
});
