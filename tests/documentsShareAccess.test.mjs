import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEmails } from '../src/home/shareInviteParse.js';

// Live proof: debug/scenarios/e2e-hub-docs-share-access.spec.mjs
// Unique leftover after Account Settings Usage: Documents More → Share →
// Document Access (Invite + Done on SE-011). Fail-closed without a cloud
// session. Distinct from Documents extras / Lock persist / Open file,
// leftover-18 A-03 inbox mint, and Templates Share.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SE-011 owner Share opens Document Access; Package 2 stays ShareModal', () => {
  const preview = read('src/home/HubPreview.jsx');
  const hub = read('src/home/SurveyHub.jsx');
  const access = read('src/home/AccessManagementModal.jsx');

  assert.match(preview, /Preview owner chrome \(P2-07\): creator id matches mockUser so Share opens/);
  assert.match(preview, /id: 'd1', name: 'SE-011 Security Shop Drawings\.pdf'/);
  assert.match(preview, /user_id: mockUser\.id/);
  assert.match(preview, /Package 2 stays unstamped so leftover A-03 ShareModal holds/);
  assert.match(preview, /id: 'd2', name: 'Package 2 — Rev 4 — IC\.pdf'/);
  assert.match(preview, /isSupabaseAvailable: false,/);
  assert.match(preview, /tier: 'developer',/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /createDocumentInvite/);

  assert.match(hub, /if \(userCanManageDocumentAccess\(single, user\)\) \{/);
  assert.match(hub, /applyShare\(true\)/);
  assert.match(hub, /if \(auth\.isSupabaseAvailable === false\) \{/);
  assert.match(hub, /applyShare\(false\);/);
  assert.match(hub, /getDocumentCollaborators\(single\.id\)/);
  assert.match(hub, /<AccessManagementModal/);
  assert.match(hub, /open=\{!!share\?\.manage\}/);
  assert.match(hub, /onShare=\{shareDocuments\}/);
  assert.doesNotMatch(hub, /VITE_DEV_AUTO_LOGIN/);

  const ledger = read('src/home/DocumentsLedger.jsx');
  assert.match(ledger, /\{ label: 'Share', onClick: \(\) => onShare && onShare\(\[doc\.raw\]\) \}/);
  assert.doesNotMatch(ledger, /createDocumentInvite/);
});

test('AccessManagementModal is local empty chrome when cloud is unavailable', () => {
  const access = read('src/home/AccessManagementModal.jsx');
  const modal = read('src/home/ShareModal.jsx');

  assert.match(access, /if \(kind === 'document'\) return 'Document Access';/);
  assert.match(access, />Invite<\/button>/);
  assert.match(access, />Done<\/button>/);
  assert.match(access, /No collaborators yet\. Use Invite to add one\./);
  assert.match(access, /if \(auth\.isSupabaseAvailable === false\) \{/);
  assert.match(access, /setMembers\(\[\]\);/);
  assert.match(access, /setInvites\(\[\]\);/);
  assert.match(access, /<ShareModal/);
  assert.match(access, /setInviteOpen\(true\)/);
  assert.match(access, /if \(e\.key === 'Escape' && !inviteOpen\)/);
  assert.doesNotMatch(access, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(access, /invented-collaborator/);

  assert.match(modal, /if \(auth\.isSupabaseAvailable === false\) \{/);
  assert.match(modal, /setError\('Sharing needs a signed-in cloud account\.'\);/);
  assert.match(modal, /Enter at least one valid email\./);
  assert.match(modal, /const ROLE_OPTIONS = \['Viewer', 'Editor', 'Owner'\];/);
  assert.match(modal, /return createDocumentInvite\(\{ documentId: targetId/);
  assert.doesNotMatch(modal, /file\.id/);
});

test('parseEmails rejects empty/invalid; leftover-18 A-03 mint stays uninvented', () => {
  assert.deepEqual(parseEmails(''), []);
  assert.deepEqual(parseEmails('not-an-email'), []);
  assert.deepEqual(parseEmails('teammate@example.com'), ['teammate@example.com']);

  const live = read('debug/scenarios/e2e-hub-docs-share-access.spec.mjs');
  assert.match(live, /DOCS_SHARE_ACCESS_PROOF/);
  assert.match(live, /Document Access/);
  assert.match(live, /Sharing needs a signed-in cloud account\./);
  assert.match(live, /leftover18InboxNotInvented/);
  assert.doesNotMatch(live, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(live, /createDocumentInvite\(/);

  const leftover = read('.planning/logic-audit-2026-08-20/fix-logs/leftover18-unblock-2026-08-21.md');
  assert.match(leftover, /A-03/);
});
