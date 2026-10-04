import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (rel) => readFile(new URL(`../src/${rel}`, import.meta.url), 'utf8');

// Polish round 2 (2026-10-04): small hub fixes, pinned so they do not drift back.

test('desktop template rows show no second line when a template has no entities', async () => {
  const source = await read('home/TemplatesEditor.jsx');
  // The swatches + count line only renders when there is at least one entity,
  // so an empty template no longer shows a lone "0".
  assert.match(source, /\{t\.roster\.length > 0 && \(\s*<div style=\{\{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 \}\}>/);
});

test('icon-only buttons carry a name: sidebar toggle, tab close X, project More', async () => {
  const sidebar = await read('PDFSidebar.jsx');
  assert.match(sidebar, /aria-label=\{isCollapsed \? 'Expand sidebar' : 'Collapse sidebar'\}/);
  const tabs = await read('TabBar.jsx');
  assert.match(tabs, /aria-label=\{`Close \$\{tab\.name\}`\}/);
  const projects = await read('home/ProjectsFolderTree.jsx');
  assert.doesNotMatch(projects, /title="More"\s*\n/);
});

test('phone Document details: Open file and Share get a 44px tap pad', async () => {
  const css = await read('home/hub.css');
  assert.match(css, /\.documents-mobile-detail-actions \.btn \{\s*position: relative;\s*\}/);
  assert.match(css, /\.documents-mobile-detail-actions \.btn::after \{[^}]*inset-block: -9px;/);
  assert.match(css, /\.documents-mobile-detail-actions \.documents-preview-share::after \{\s*inset-inline: -9px;/);
});
