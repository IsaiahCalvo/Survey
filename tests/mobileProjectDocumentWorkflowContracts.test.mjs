import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8');
const dashboard = read('src/Dashboard.jsx');
const modal = read('src/home/CreateProjectModal.jsx');
const preview = read('src/home/HubPreview.jsx');
const hub = read('src/home/SurveyHub.jsx');
const documents = read('src/home/DocumentsLedger.jsx');
const projects = read('src/home/ProjectsFolderTree.jsx');
const harness = read('agent-cli/mobile-workflows/project-document-e2e.mjs');

test('production create-project action renders an accessible dialog with optional PDFs', () => {
  assert.match(dashboard, /<CreateProjectModal[\s\S]*open=\{isProjectModalOpen\}/);
  assert.match(dashboard, /onConfirm=\{handleConfirmCreateProject\}/);
  assert.doesNotMatch(dashboard, /if \(projectFiles\.length === 0\)[\s\S]{0,160}Add at least one PDF/);
  assert.match(dashboard, /if \(files\.length > 0 && successCount === 0\)/);
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-label="Create project"/);
  assert.match(modal, /aria-label="Project name"/);
  assert.match(modal, /PDF files \(optional\)/);
  assert.ok((modal.match(/minHeight: 44/g) || []).length >= 4, 'mobile dialog controls need 44px targets');
});

test('project and document renames are wired from hub UI to durable host handlers', () => {
  assert.match(hub, /onRenameProject/);
  assert.match(hub, /onRenameDocument/);
  assert.match(dashboard, /updateSupabaseProject\(project\.id, \{ name/);
  assert.match(dashboard, /updateSupabaseDocument\(doc\.id, \{ name/);
  assert.match(documents, /title="Rename document"/);
  assert.match(projects, /onRenameProject\(project, name\)/);
});

test('mock-only workflow exposes exact persisted models and stable row ids', () => {
  for (const key of ['mobileWorkflowDocuments', 'mobileWorkflowProjects', 'mobileWorkflowTemplates']) {
    assert.match(preview, new RegExp(key));
  }
  assert.match(preview, /window\.__mobileWorkflowState/);
  assert.match(preview, /workflowE2E/);
  assert.match(documents, /data-document-id=\{d\.id\}/);
  assert.match(projects, /data-project-id=\{p\.id\}/);
  assert.match(projects, /data-document-id=\{f\.id\}/);
});

test('mobile project list rows omit the decorative folder icon', () => {
  const rowStart = projects.indexOf('data-project-id={p.id}');
  const rowEnd = projects.indexOf('</SortableRearrangeRow>', rowStart);
  assert.ok(rowStart >= 0 && rowEnd > rowStart);
  assert.doesNotMatch(projects.slice(rowStart, rowEnd), /projects-mobile-folder-glyph/);
});

test('project/document harness defaults to parallel mobile and desktop model contracts', () => {
  assert.match(harness, /device: 'all'/);
  assert.match(harness, /Promise\.allSettled\(devices\.map/);
  assert.match(harness, /createTouchDriver/);
  assert.match(harness, /touch\.inputKind/);
  assert.match(harness, /desktop-mouse-keyboard/);
  assert.match(harness, /project delete cascades documents/);
  assert.match(harness, /restoreWorkflowModel/);
  assert.match(harness, /hubPreview=1/);
});
