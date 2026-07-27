import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { canManageCollaborativeSpaces } from '../src/utils/collaborativeSpaceAccess.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const EDITOR = '22222222-2222-4222-8222-222222222222';

test('Free editor can manage Spaces in a document another user shared with them', () => {
  assert.equal(canManageCollaborativeSpaces({
    hasAdvancedSurvey: false,
    documentId: 'shared-doc',
    documentOwnerId: OWNER,
    viewerId: EDITOR,
    documentRole: 'editor',
  }), true);
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

test('shared-document grant is editor-only and fails closed without ownership truth', () => {
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

test('Space create and Region edit UI use the document-scoped grant', () => {
  const panelSource = readFileSync(
    new URL('../src/sidebar/SpacesPanel.jsx', import.meta.url),
    'utf8',
  );
  const viewerSource = readFileSync(
    new URL('../src/PDFViewer.jsx', import.meta.url),
    'utf8',
  );

  assert.match(panelSource, /if \(!canManageSpaces\) \{[\s\S]*?Upgrade to Pro to create Spaces/);
  assert.match(viewerSource, /if \(canManageSpaces\) \{[\s\S]*?setShowRegionSelection\(true\)/);
});
