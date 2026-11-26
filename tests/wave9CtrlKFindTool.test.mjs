import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dockSource = fs.readFileSync(
  path.resolve('src/components/PinnedToolsDock.jsx'),
  'utf8',
);

test('#1758: PinnedToolsDock binds Ctrl+K / Cmd+K to open Find a tool', () => {
  assert.match(dockSource, /const addButtonRef = useRef\(null\);/);
  assert.match(dockSource, /ref=\{addButtonRef\}/);
  assert.match(dockSource, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(dockSource, /String\(event\.key \|\| ''\)\.toLowerCase\(\) !== 'k'/);
  assert.match(dockSource, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  assert.match(dockSource, /setMenu\(\{ kind: 'add', rect: anchor\.getBoundingClientRect\(\), opener: anchor \}\);/);
});

test('#1758: Find a tool search input focuses on open and isolates typed keys from viewer shortcuts', () => {
  assert.match(dockSource, /searchInputRef\.current\?\.focus\?\.\(\{ preventScroll: true \}\);/);
  assert.match(dockSource, /if \(event\.key !== 'Escape'\) event\.stopPropagation\(\);/);
});
