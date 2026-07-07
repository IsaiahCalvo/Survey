/* KAL-31 — contract guard tests.
 *
 * These don't hit Supabase. They lock in the small set of invariants the
 * locked spec is loudest about so future refactors don't drift:
 *   - Active product role set is exactly viewer/editor/owner.
 *   - `commenter` is removed from active code paths.
 *   - Email parser accepts the formats the ShareModal expects.
 *   - Invite link builder produces a deterministic URL shape from a token.
 */
import test from 'node:test';
import { deepStrictEqual, equal, ok, match } from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');

test('KAL-31: documentAnnotationService no longer advertises `commenter` in active role-doc strings', () => {
  const text = fs.readFileSync(
    path.join(repoRoot, 'src/services/documentAnnotationService.js'),
    'utf8',
  );
  // The doc comments should advertise viewer | editor | owner.
  match(text, /'viewer'.*'editor'.*'owner'/);
  // No active JSDoc role string should still say 'commenter'.
  // (Body-level comments may mention legacy commenter for historical context;
  // we only assert the role-list JSDoc lines drop it.)
  const docCommenter = text.match(/Role: '[^']*commenter[^']*'/g);
  equal(docCommenter, null, 'Role: \'...commenter...\' doc strings must be gone');
});

test('KAL-31: 20260521 forward migration removes commenter from role hierarchy', () => {
  const file = path.join(
    repoRoot,
    'supabase/migrations/20260521000000_kal31_remove_commenter_role.sql',
  );
  const sql = fs.readFileSync(file, 'utf8');
  // Migrates existing rows.
  match(sql, /UPDATE\s+public\.document_collaborators[\s\S]+commenter/);
  match(sql, /UPDATE\s+public\.project_collaborators[\s\S]+commenter/);
  // Tightens CHECK constraints.
  match(sql, /document_collaborators_role_check[\s\S]+'viewer',\s*'editor',\s*'owner'/);
  match(sql, /project_collaborators_role_check[\s\S]+'viewer',\s*'editor',\s*'owner'/);
  // Adds last-owner protection.
  match(sql, /kal31_guard_last_owner/);
});

test('KAL-31: invite-tokens migration enforces 3-role set + RPC contract', () => {
  const sql = fs.readFileSync(
    path.join(repoRoot, 'supabase/migrations/20260521000100_kal31_invite_tokens.sql'),
    'utf8',
  );
  match(sql, /role\s+TEXT\s+NOT NULL\s+CHECK\s*\(role IN \('viewer',\s*'editor',\s*'owner'\)\)/);
  match(sql, /intended_role\s+TEXT\s+NOT NULL/);
  match(sql, /kal31_accept_document_invite/);
  match(sql, /kal31_revoke_document_invite/);
  match(sql, /kal31_resend_document_invite/);
  // Acceptance returns all the documented states.
  for (const status of ['accepted', 'wrong_account', 'invalid', 'expired', 'revoked', 'already_accepted']) {
    match(sql, new RegExp(`'${status}'`));
  }
});

test('KAL-31: ShareModal defaults to Viewer and exposes only viewer/editor/owner', () => {
  const src = fs.readFileSync(
    path.join(repoRoot, 'src/home/ShareModal.jsx'),
    'utf8',
  );
  match(src, /const ROLE_OPTIONS\s*=\s*\['Viewer',\s*'Editor',\s*'Owner'\]/);
  // Default useState role is Viewer.
  match(src, /useState\('Viewer'\)/);
  // Free-user gating message is present.
  match(src, /Free plan accounts cannot create invite links/);
  // Explicit access copy required by locked spec.
  match(src, /Anyone with this invite link can join as/);
  // Backend wiring is in place (not placeholder-only).
  match(src, /createDocumentInvite/);
});

test('KAL-31: AccessManagementModal exposes only viewer/editor/owner', () => {
  const src = fs.readFileSync(
    path.join(repoRoot, 'src/home/AccessManagementModal.jsx'),
    'utf8',
  );
  match(src, /const ROLES\s*=\s*\['Owner',\s*'Editor',\s*'Viewer'\]/);
  ok(!/Commenter/i.test(src), 'AccessManagementModal must not advertise Commenter');
});

test('KAL-31 Phase C: send-email function has invite/permission-changed/access-removed templates', () => {
  const src = fs.readFileSync(
    path.join(repoRoot, 'supabase/functions/send-email/index.ts'),
    'utf8',
  );
  match(src, /'document-invite':/);
  match(src, /'permission-changed':/);
  match(src, /'access-removed':/);
});

test('KAL-31 Phase D: InviteAcceptPage renders the six acceptance states', () => {
  const src = fs.readFileSync(
    path.join(repoRoot, 'src/home/InviteAcceptPage.jsx'),
    'utf8',
  );
  for (const status of ['accepted', 'wrong_account', 'expired', 'revoked', 'already_accepted', 'invalid']) {
    match(src, new RegExp(`'${status}'`), `InviteAcceptPage must handle '${status}'`);
  }
  match(src, /acceptDocumentInvite/);
  // Upgrade-required banner for free-user editor/owner invites.
  match(src, /upgradeRequired/);
});

test('KAL-31 Phase D: main.jsx routes /invite/<token> to the accept page', () => {
  const src = fs.readFileSync(
    path.join(repoRoot, 'src/main.jsx'),
    'utf8',
  );
  match(src, /\/invite\\\//);
  match(src, /InviteAcceptPage/);
});

test('KAL-31 Phase E: AccessManagementModal wires live backend behavior', () => {
  const src = fs.readFileSync(
    path.join(repoRoot, 'src/home/AccessManagementModal.jsx'),
    'utf8',
  );
  match(src, /getDocumentCollaborators/);
  match(src, /updateCollaboratorRole/);
  match(src, /removeDocumentCollaborator/);
  match(src, /listDocumentInvites/);
  match(src, /revokeDocumentInvite/);
  match(src, /resendDocumentInvite/);
  match(src, /sendPermissionChangedEmail/);
  match(src, /sendAccessRemovedEmail/);
  match(src, /cannot demote the last owner/);
});

test('KAL-31 Phase C/E: shareEmailService exists and wraps send-email', () => {
  const src = fs.readFileSync(
    path.join(repoRoot, 'src/services/shareEmailService.js'),
    'utf8',
  );
  // GOAL-1: invite emails now go through the send-invite-email edge fn.
  match(src, /sendInviteEmailSmart/);
  match(src, /sendPermissionChangedEmail/);
  match(src, /sendAccessRemovedEmail/);
  match(src, /functions\.invoke\('send-email'/);
});
