import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-hub-projects-rename-escape.spec.mjs
// Product bug leftover the Counter Start / Width Escape hunts parked:
// project-name fields committed on Enter/blur with no Escape restore.
// Distinct from catalog-completeness Enter rename, leftover-18 / X-01.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('ProjectsFolderTree project rename Escape restores the pre-edit name and skips blur persist', () => {
  const tree = read('src/home/ProjectsFolderTree.jsx');
  const helperAt = tree.indexOf('const handleProjectRenameKeyDown = (event, currentName) => {');
  assert.ok(helperAt > 0, 'handleProjectRenameKeyDown');
  const helper = tree.slice(helperAt, tree.indexOf('function PopupMenu', helperAt));
  assert.match(helper, /if \(event\.key === 'Enter'\)/);
  assert.match(helper, /event\.currentTarget\.blur\(\)/);
  assert.match(helper, /if \(event\.key === 'Escape'\)/);
  assert.match(helper, /event\.preventDefault\(\)/);
  assert.match(helper, /event\.stopPropagation\(\)/);
  assert.match(helper, /event\.currentTarget\.value = currentName/);
  assert.match(helper, /event\.currentTarget\.blur\(\)/);
  assert.doesNotMatch(helper, /renameProject\(/);

  assert.match(tree, /onKeyDown=\{\(e\) => handleProjectRenameKeyDown\(e, open\.name\)\}/);
  assert.match(tree, /onKeyDown=\{\(e\) => handleProjectRenameKeyDown\(e, mobileDrillProject\.name\)\}/);
  assert.equal(
    (tree.match(/handleProjectRenameKeyDown\(e, /g) || []).length,
    4,
    'desktop + three mobile rename fields share the helper',
  );
  assert.doesNotMatch(
    tree,
    /onKeyDown=\{\(e\) => \{ if \(e\.key === 'Enter'\) e\.currentTarget\.blur\(\); \}\}/,
  );

  const blurCommit = tree.slice(tree.indexOf('const renameProject = useCallback'), tree.indexOf('const reorderProjects'));
  assert.match(blurCommit, /if \(project && onRenameProject\) void onRenameProject\(project, name\)/);

  const desktopBlurAt = tree.indexOf('title="Click to rename"');
  assert.ok(desktopBlurAt > 0);
  const desktopBlur = tree.slice(desktopBlurAt, tree.indexOf('Add files', desktopBlurAt));
  assert.match(desktopBlur, /if \(name && name !== open\.name\) renameProject\(open\.id, name\)/);
  assert.match(desktopBlur, /else e\.currentTarget\.value = open\.name/);

  assert.doesNotMatch(tree, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(tree, /__e2eProjectsRenameEscape/);
  assert.doesNotMatch(tree, /file\.id/);
});

test('HubPreview seed names stay local; project rename is not leftover-18 invent', () => {
  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /\{ id: 'p1', name: 'Tower 5 — Security'/);
  assert.match(preview, /\{ id: 'p2', name: 'Lab Reno — MEP'/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /onExportSpaceCSV/);

  const extras = read('debug/scenarios/e2e-hub-projects-extras.spec.mjs');
  assert.match(extras, /Projects extras Search \/ Pin \/ Duplicate \/ file Copy-Paste/);
  assert.doesNotMatch(extras, /handleProjectRenameKeyDown/);

  const catalog = read('debug/scenarios/e2e-catalog-completeness.spec.mjs');
  assert.match(catalog, /Hub projects rename \/ delete \/ create intended \+ break \+ edge/);
  assert.match(catalog, /await rename\.press\('Enter'\)/);
  assert.doesNotMatch(catalog, /handleProjectRenameKeyDown/);
});
