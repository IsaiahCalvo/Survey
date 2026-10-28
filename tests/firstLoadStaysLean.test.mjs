import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// 2026-10-28 health round: first-load JavaScript had grown to 794.7 KB gzip
// (budget 725.4 KB, scripts/bundle-budget.json). The growth was code Home
// loaded before anyone could use it: dialogs that render closed, two Survey
// Nightly betas, and the whole mark sync engine pulled in by the delete and
// "new version" paths. Each now loads on its own. A plain static import of any
// of them puts it back on the first load, so this file pins the split.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const staticImport = (source, module) => new RegExp(
  `^import\\s[^;]*?from\\s+['"]${module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.jsx?)?['"]`,
  'm',
).test(source);

const preloaded = (source, module) => new RegExp(
  `preloadedComponent\\(\\(\\)\\s*=>\\s*import\\(['"]${module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.jsx?)?['"]\\)\\)`,
).test(source);

const CASES = [
  { file: '../src/home/SurveyHub.jsx', module: './ShareModal', why: 'Share renders closed on every Home visit' },
  { file: '../src/home/SurveyHub.jsx', module: './AccessManagementModal', why: 'Document access renders closed on every Home visit' },
  { file: '../src/home/ProjectsFolderTree.jsx', module: './ManageTeamModal', why: 'Manage team renders closed until picked' },
  { file: '../src/Dashboard.jsx', module: './components/PdfToolsDialog', why: 'PDF tools render closed until picked' },
  { file: '../src/AppShell.jsx', module: './components/PinnedToolsDock', why: 'the pinned tools dock is a Nightly beta' },
  { file: '../src/AppShell.jsx', module: './components/ExportPdfDialog', why: 'the Export PDF dialog is a Nightly beta' },
];

for (const { file, module, why } of CASES) {
  test(`${module} stays off the first load (${why})`, () => {
    const source = read(file);
    assert.equal(staticImport(source, module), false, `${file} must not statically import ${module}`);
    assert.equal(preloaded(source, module), true, `${file} should load ${module} with preloadedComponent, so it still opens with no wait`);
  });
}

test('the mark sync engine is not on the first load for deletes', () => {
  for (const file of ['../src/Dashboard.jsx', '../src/services/documentArchiveService.js', '../src/services/projectArchiveService.js']) {
    const source = read(file);
    assert.equal(staticImport(source, './services/annotationDocSync'), false, `${file} must not statically import annotationDocSync`);
    assert.equal(staticImport(source, './annotationDocSync'), false, `${file} must not statically import annotationDocSync`);
  }
  const purge = read('../src/services/annotationDocPurge.js');
  assert.match(purge, /await import\(['"]\.\/annotationDocSync\.js['"]\)/);
  assert.equal(/^import\s/m.test(purge), false, 'annotationDocPurge.js must stay import-free so it costs nothing on the first load');
});

test('"Upload as new version" fetches the mark carry code only when it runs', () => {
  const dashboard = read('../src/Dashboard.jsx');
  assert.equal(staticImport(dashboard, './services/documentVersionMarks'), false);
  assert.match(dashboard, /await import\(['"]\.\/services\/documentVersionMarks\.js['"]\)/);
});

test('the viewer chrome reads the pinned tools store without the dock', () => {
  const shell = read('../src/AppShell.jsx');
  assert.match(shell, /from ['"]\.\/pinnedTools\/pinnedToolsShared\.jsx['"]/);
  const shared = read('../src/pinnedTools/pinnedToolsShared.jsx');
  assert.equal(/PinnedToolsDock/.test(shared.replace(/\/\*[\s\S]*?\*\//g, '')), false, 'the shared module must not import the dock');
});
