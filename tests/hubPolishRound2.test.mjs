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

test('hub header counts: plain count, singular for one, no stale Projects tail', async () => {
  const projects = await read('home/ProjectsFolderTree.jsx');
  assert.doesNotMatch(projects, /projects · expand any/);
  assert.match(projects, /<b>\{filtered\.length\}<\/b> \{filtered\.length === 1 \? 'project' : 'projects'\}/);
  const templates = await read('home/TemplatesEditor.jsx');
  assert.match(templates, /<b>\{visibleTemplates\.length\}<\/b> \{visibleTemplates\.length === 1 \? 'template' : 'templates'\}/);
  assert.match(templates, /orderedMods\.length === 1 \? 'module' : 'modules'/);
  const docs = await read('home/DocumentsLedger.jsx');
  assert.match(docs, /<b>\{docs\.length\}<\/b> \{docs\.length === 1 \? 'file' : 'files'\}/);
});

test('desktop Documents: a file in no project shows an empty Project cell, not "N/A"', async () => {
  const docs = await read('home/DocumentsLedger.jsx');
  assert.doesNotMatch(docs, />N\/A</);
  assert.match(docs, /\{d\.project === 'Sandbox' \? null : d\.project\}/);
});

test('New project dialog: the file picker button wears the outlined hub button look', async () => {
  const modal = await read('home/CreateProjectModal.jsx');
  assert.match(modal, /className="create-project-file-input"/);
  assert.match(modal, /title="Close" aria-label="Close"/);
  const css = await read('home/hub.css');
  assert.match(css, /\.create-project-file-input::file-selector-button \{[^}]*border: 1px solid var\(--border-strong\);[^}]*background: transparent;/);
});

test('desktop empty Projects / Templates say "no X yet" once, in the big empty state', async () => {
  const projects = await read('home/ProjectsFolderTree.jsx');
  assert.match(projects, /\{filtered\.length === 0 && localProjects\.length > 0 && \(/);
  assert.doesNotMatch(projects, /'No projects yet\.'/);
  const templates = await read('home/TemplatesEditor.jsx');
  assert.match(templates, /\{visibleTemplates\.length === 0 && rich\.length > 0 && \(/);
  assert.doesNotMatch(templates, /'No templates yet\.'/);
  assert.match(templates, /\{tpl && tpl\.roster\.length === 0 && \(\s*<div className="meta"[^>]*>No entities on this template yet\.<\/div>/);
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
