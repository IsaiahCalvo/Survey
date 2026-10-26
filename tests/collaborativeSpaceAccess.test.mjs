import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { canManageCollaborativeSpaces } from '../src/utils/collaborativeSpaceAccess.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const EDITOR = '22222222-2222-4222-8222-222222222222';

test('Free editor cannot manage Spaces in a document another user shared with them', () => {
  assert.equal(canManageCollaborativeSpaces({
    hasAdvancedSurvey: false,
    documentId: 'shared-doc',
    documentOwnerId: OWNER,
    viewerId: EDITOR,
    documentRole: 'editor',
  }), false);
});

test('paid viewer remains read-only in a document another user shared with them', () => {
  assert.equal(canManageCollaborativeSpaces({
    hasAdvancedSurvey: true,
    documentId: 'shared-doc',
    documentOwnerId: OWNER,
    viewerId: EDITOR,
    documentRole: 'viewer',
  }), false);
});

test('paid viewer fails closed even if shared-document ownership metadata is missing', () => {
  assert.equal(canManageCollaborativeSpaces({
    hasAdvancedSurvey: true,
    documentId: 'shared-doc',
    documentOwnerId: null,
    viewerId: EDITOR,
    documentRole: 'viewer',
  }), false);
});

test('paid document access fails closed when both ownership and role are unresolved', () => {
  assert.equal(canManageCollaborativeSpaces({
    hasAdvancedSurvey: true,
    documentId: 'cloud-doc',
    documentOwnerId: null,
    viewerId: EDITOR,
    documentRole: null,
  }), false);
});

test('shared-document Space management requires both a paid plan and an editing role', () => {
  for (const documentRole of ['editor', 'owner']) {
    assert.equal(canManageCollaborativeSpaces({
      hasAdvancedSurvey: true,
      documentId: 'shared-doc',
      documentOwnerId: OWNER,
      viewerId: EDITOR,
      documentRole,
    }), true);
    assert.equal(canManageCollaborativeSpaces({
      hasAdvancedSurvey: false,
      documentId: 'shared-doc',
      documentOwnerId: OWNER,
      viewerId: EDITOR,
      documentRole,
    }), false);
  }
});

test('an authoritative paid editor or owner role survives missing owner metadata', () => {
  for (const documentRole of ['editor', 'owner']) {
    assert.equal(canManageCollaborativeSpaces({
      hasAdvancedSurvey: true,
      documentId: 'shared-doc',
      documentOwnerId: null,
      viewerId: EDITOR,
      documentRole,
    }), true);
  }
});

test('personal Advanced Survey entitlement still gates a Free user own document', () => {
  assert.equal(canManageCollaborativeSpaces({
    hasAdvancedSurvey: false,
    documentId: 'own-doc',
    documentOwnerId: EDITOR,
    viewerId: EDITOR,
    documentRole: 'owner',
  }), false);
});

test('shared-document grant denies viewers and fails closed without an editing role', () => {
  for (const documentRole of ['viewer', null]) {
    assert.equal(canManageCollaborativeSpaces({
      hasAdvancedSurvey: false,
      documentId: 'shared-doc',
      documentOwnerId: OWNER,
      viewerId: EDITOR,
      documentRole,
    }), false);
  }
  assert.equal(canManageCollaborativeSpaces({
    hasAdvancedSurvey: false,
    documentId: 'shared-doc',
    documentOwnerId: null,
    viewerId: EDITOR,
    documentRole: 'editor',
  }), false);
});

test('personal Advanced Survey entitlement continues to grant Space management', () => {
  assert.equal(canManageCollaborativeSpaces({
    hasAdvancedSurvey: true,
    documentId: 'own-doc',
    documentOwnerId: EDITOR,
    viewerId: EDITOR,
    documentRole: 'owner',
  }), true);
});

test('every Space and Region mutation path uses the document-scoped grant', () => {
  const panelSource = readFileSync(
    new URL('../src/sidebar/SpacesPanel.jsx', import.meta.url),
    'utf8',
  );
  const viewerSource = readFileSync(
    new URL('../src/PDFViewer.jsx', import.meta.url),
    'utf8',
  );

  assert.match(panelSource, /const requireSpaceManagement = useCallback/);
  for (const handlerName of [
    'handleCreateSpace',
    'handleRenameSpace',
    'handleDelete',
    'handleAssignPages',
    'handleRemovePage',
    'handleRenameRegion',
    'handleRequestRegionEdit',
    'handleSpaceReorder',
  ]) {
    assert.match(
      panelSource,
      new RegExp(String.raw`const ${handlerName} = useCallback\(\([^)]*\) => \{\s*if \(!requireSpaceManagement\(\)\) return;`),
      `${handlerName} must deny plan/role bypasses`,
    );
  }
  assert.match(panelSource, /disabled=\{!canManageSpaces \|\| !onReorderSpaces\}/);

  assert.match(viewerSource, /const requireSpaceManagement = useCallback/);
  for (const handlerName of [
    'handleSpaceCreate',
    'handleSpaceUpdate',
    'handleSpaceAssignPages',
    'handleSpaceRemovePage',
    'handleSpaceRenamePage',
    'handleSpaceClearRegions',
    'handleReorderSpaces',
    'handleSpaceDelete',
    'handleRegionSetFullPage',
    'handleRegionComplete',
    'handleRestoreSpace',
    'setPageAnnotationVisibilityState',
  ]) {
    assert.match(
      viewerSource,
      new RegExp(String.raw`const ${handlerName} = useCallback\(\([^)]*\) => \{\s*if \(!requireSpaceManagement\(\)\)`),
      `${handlerName} must deny plan/role bypasses`,
    );
  }
  assert.match(viewerSource, /if \(canManageSpaces\) \{[\s\S]*?setShowRegionSelection\(true\)/);
});
