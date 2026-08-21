import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const barrier = read('../src/components/DismissBarrier.jsx');
const hubShell = read('../src/home/HubShell.jsx');
const documents = read('../src/home/DocumentsLedger.jsx');
const projects = read('../src/home/ProjectsFolderTree.jsx');
const templates = read('../src/home/TemplatesEditor.jsx');
const manageTeam = read('../src/home/ManageTeamModal.jsx');

test('shared dismissal barrier consumes pointerdown and its trailing click', () => {
  assert.match(barrier, /document\.addEventListener\('pointerdown', onPointerDown, true\)/);
  assert.match(barrier, /document\.addEventListener\('click', onTrailingClick, true\)/);
  assert.match(barrier, /const onKeyDown = \(event\) => \{[\s\S]*consume\(event\);[\s\S]*onDismiss\(event\);/);
  assert.match(barrier, /leave an armed trailing-click blocker alive/);
  assert.match(barrier, /insideRefs/);
  assert.match(barrier, /insideSelector/);
});

test('shared Home search blurs through the first-tap barrier', () => {
  assert.match(hubShell, /active=\{focused\}[\s\S]*insideRefs=\{\[rootRef\]\}/);
  assert.match(hubShell, /inputRef\.current\?\.blur\(\)/);
  assert.match(hubShell, /onFocus=\{\(\) => setFocused\(true\)\}/);
});

test('document, project, and template More menus use the same barrier', () => {
  assert.match(documents, /function DocumentActionMenu[\s\S]*<DismissBarrier insideRefs=\{\[ref, trigger\]\} onDismiss=\{onClose\}/);
  assert.match(projects, /function PopupMenu[\s\S]*<DismissBarrier insideRefs=\{\[ref\]\} onDismiss=\{onClose\}/);
  assert.match(templates, /function MoreMenu[\s\S]*<DismissBarrier insideRefs=\{\[ref\]\} onDismiss=\{onClose\}/);
  assert.match(templates, /className="ed-tpl-menu"[\s\S]*role="menu"/);
  assert.match(templates, /role="menuitem"/);
});

test('Manage Team search and transient menus use the first-tap barrier', () => {
  assert.match(manageTeam, /active=\{searchFocused\}[\s\S]*insideRefs=\{\[searchRootRef\]\}/);
  assert.match(manageTeam, /data-manage-team-dismiss-surface="true"/);
  assert.match(manageTeam, /insideSelector="\[data-manage-team-dismiss-surface='true'\]"/);
  assert.doesNotMatch(manageTeam, /document\.addEventListener\("click", onDoc\)/);
});
