import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-hub-projects-extras.spec.mjs
// Unique leftover after Projects catalog-completeness (rename/delete/create)
// and Hub Documents extras / Lock persist. Search / Pin / Select Duplicate /
// file More Copy-Paste are local hubPreview chrome. Share send / Upload
// picker / Team writeback / cloud lockDocument stay leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('ProjectsFolderTree Search / Pin / Duplicate / file clipboard are live local chrome', () => {
  const tree = read('src/home/ProjectsFolderTree.jsx');
  assert.match(tree, /placeholder="Search projects\.\.\."/);
  assert.match(tree, /return localProjects\.filter\(\(p\) => !q \|\| \(p\.name \|\| ''\)\.toLowerCase\(\)\.includes\(q\)\)/);
  assert.match(tree, /label: projPinned \? 'Unpin project' : 'Pin project'/);
  assert.match(tree, /onClick: \(\) => togglePin\(proj\.id\)/);
  assert.match(tree, /onProjectPreferencesChange\?\.\(\{ pinnedIds: \[\.\.\.next\] \}\)/);
  assert.match(tree, /const duplicateProjects = useCallback\(async \(ids\) => \{/);
  assert.match(tree, /name: `\$\{src\.name\} \(copy\)`/);
  assert.match(tree, /\{ label: 'Copy', onClick: \(\) => copyFile\(f\) \}/);
  assert.match(tree, /\{ label: 'Paste', disabled: !clipboard, onClick: \(\) => pasteFile\(\) \}/);
  assert.doesNotMatch(tree, /onExportSpaceCSV/);
  assert.doesNotMatch(tree, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(tree, /__e2eProjectsExtras/);
});

test('HubPreview Duplicate + pin preferences are local; Share/Upload stay fail-closed', () => {
  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /const handleDuplicateProjects = \(items\) => \{/);
  assert.match(preview, /name: `\$\{source\.name\} \(copy\)`/);
  assert.match(preview, /const handleProjectPreferencesChange = \(patch\) => \{/);
  assert.match(preview, /onDuplicateProjects=\{handleDuplicateProjects\}/);
  assert.match(preview, /onProjectPreferencesChange=\{handleProjectPreferencesChange\}/);
  assert.match(preview, /\{ id: 'p1', name: 'Tower 5 — Security'/);
  assert.match(preview, /\{ id: 'p2', name: 'Lab Reno — MEP'/);
  assert.doesNotMatch(preview, /onShare=\{/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /onExportSpaceCSV/);

  const hub = read('src/home/SurveyHub.jsx');
  assert.match(hub, /const shareProject = \(project\) => \{/);
  assert.match(hub, /setShare\(\{ kind: 'project', name: project\.name, item: project, manage: false \}\)/);
});

test('Projects extras are not leftover-18 invent and not Documents extras replay', () => {
  const tree = read('src/home/ProjectsFolderTree.jsx');
  assert.match(tree, /\{ icon: 'users', label: 'Add member', onClick: \(\) => onShare && onShare\(proj\) \}/);
  assert.match(tree, /\{ icon: 'arrow-r', label: 'Get link to project', onClick: \(\) => onShare && onShare\(proj\) \}/);
  assert.match(tree, /label: 'Upload files'/);
  assert.doesNotMatch(tree, /lockDocument\(/);
  assert.doesNotMatch(tree, /kal49_lock_document/);
  assert.doesNotMatch(tree, /setCopyModeActive\(true\)/);

  const extras = read('debug/scenarios/e2e-hub-docs-extras.spec.mjs');
  assert.match(extras, /Hub documents Copy\/Paste \+ Duplicate \+ Move\/Copy \+ Sort \+ Preview/);
  assert.doesNotMatch(extras, /Pin project/);
  assert.doesNotMatch(extras, /Search projects/);
});
