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

/*
 * RULED 2026-09-23 (owner: dismiss rules R1–R6). This test was "shared
 * dismissal barrier consumes pointerdown and its trailing click" and pinned
 * the old swallow: a document-level trailing-click blocker, an Escape handler
 * inside the barrier, and the "leave an armed trailing-click blocker alive"
 * comment. The owner ruled that a light popover never blocks (R1): the press
 * outside closes it AND still does its job. The swallow now survives only for
 * the bare page (R2), typing (R3) and blocking windows (R4), through the shared
 * swallowRestOfPress, and Escape goes through the shared registry (R5).
 * Kept: capture-phase pointerdown, insideRefs, insideSelector.
 */
const rules = read('../src/components/dismissRules.js');
test('shared dismissal barrier follows the owner dismiss rules', () => {
  assert.match(barrier, /document\.addEventListener\('pointerdown', onPointerDown, true\)/);
  assert.match(barrier, /insideRefs/);
  assert.match(barrier, /insideSelector/);
  assert.match(barrier, /mode = 'light'/);
  assert.match(barrier, /\/\/ R1: close, and let this same press do its job\.\n\s*field\?\.blur\(\);\n\s*dismiss\(event\);/);
  assert.match(barrier, /mode === 'blocking'[\s\S]*consumeEvent\(event\);\n\s*swallowRestOfPress\(event\);/);
  assert.match(barrier, /registerLightPopover\(/);
  assert.doesNotMatch(barrier, /addEventListener\('keydown'/, 'Escape is the shared registry\'s (R5)');
  assert.match(rules, /window\.addEventListener\('click', onClick, true\)/);
  assert.match(rules, /export function isBarePagePress/);
});

test('shared Home search blurs through the first-tap barrier', () => {
  assert.match(hubShell, /active=\{focused\}[\s\S]*insideRefs=\{\[rootRef\]\}/);
  assert.match(hubShell, /inputRef\.current\?\.blur\(\)/);
  assert.match(hubShell, /onFocus=\{\(\) => setFocused\(true\)\}/);
});

test('document, project, and template More menus use the same barrier', () => {
  assert.match(documents, /function DocumentActionMenu[\s\S]*<DismissBarrier insideRefs=\{\[ref\]\} onDismiss=\{onClose\}/);
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
