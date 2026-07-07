/* Project + template sharing — contract guard tests.
 *
 * Mirrors tests/kal31InviteContract.test.mjs for the project/template
 * extension (migration 20260701120000_project_template_sharing.sql). These
 * don't hit Supabase — they lock in the invariants the locked KAL-31 spec is
 * loudest about so future refactors don't drift:
 *   - Backend contract: tables, RPCs, statuses, 3-role set, free-tier
 *     downgrade semantics for projects AND templates.
 *   - Services mirror documentInviteService exactly (secure token minting,
 *     shared /invite/<token> URL space, kal31_* RPC names).
 *   - ShareModal routes project/template kinds to the right service and no
 *     longer blocks them behind the Phase-A message.
 *   - InviteAcceptPage resolves a token across all three kinds in
 *     document → project → template order and names the thing in its copy.
 *   - ManageTeamModal is real: live collaborator/invite rows, real invite
 *     minting, last-owner protection — no fake link, no no-op send button.
 */
import test from 'node:test';
import { equal, ok, match } from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

// Strip /* */ and // comments so "never fall back to Math.random()" prose in
// doc comments doesn't trip the no-weak-RNG code assertions.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('sharing migration defines project/template invite tables + collaborators', () => {
  const sql = read('supabase/migrations/20260701120000_project_template_sharing.sql');
  match(sql, /CREATE TABLE IF NOT EXISTS public\.project_invites/);
  match(sql, /CREATE TABLE IF NOT EXISTS public\.template_invites/);
  match(sql, /CREATE TABLE IF NOT EXISTS public\.template_collaborators/);
  // 3-role set on both invite tables.
  const roleChecks = sql.match(/role\s+TEXT NOT NULL CHECK \(role IN \('viewer', 'editor', 'owner'\)\)/g) || [];
  ok(roleChecks.length >= 2, 'both invite tables enforce the 3-role set');
  match(sql, /user_can_access_template/);
});

test('sharing migration ships all six kal31 project/template RPCs + statuses', () => {
  const sql = read('supabase/migrations/20260701120000_project_template_sharing.sql');
  for (const fn of [
    'kal31_accept_project_invite',
    'kal31_resend_project_invite',
    'kal31_revoke_project_invite',
    'kal31_accept_template_invite',
    'kal31_resend_template_invite',
    'kal31_revoke_template_invite',
  ]) {
    match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}`), `${fn} must exist`);
  }
  // Acceptance returns all the documented states (per accept function).
  for (const status of ['accepted', 'wrong_account', 'invalid', 'expired', 'revoked', 'already_accepted']) {
    const hits = sql.match(new RegExp(`'${status}'`, 'g')) || [];
    ok(hits.length >= 2, `status '${status}' present for both project and template accepts`);
  }
  // Free-tier downgrade semantics preserved (viewer + upgrade_required).
  match(sql, /upgrade_required/);
  match(sql, /v_final_role := 'viewer'/);
});

test('projectInviteService mirrors the document invite contract', () => {
  const src = read('src/services/projectInviteService.js');
  for (const fn of [
    'createProjectInvite', 'listProjectInvites', 'revokeProjectInvite',
    'resendProjectInvite', 'acceptProjectInvite',
    'getProjectCollaborators', 'listProjectCollaboratorsForProjects',
    'updateProjectCollaboratorRole', 'removeProjectCollaborator',
  ]) {
    match(src, new RegExp(`export async function ${fn}`), `${fn} must be exported`);
  }
  // kal31 RPC names.
  match(src, /kal31_accept_project_invite/);
  match(src, /kal31_resend_project_invite/);
  match(src, /kal31_revoke_project_invite/);
  // Secure token minting — fail closed, never Math.random.
  match(src, /crypto\.getRandomValues/);
  match(src, /refusing to mint a guessable invite token/);
  ok(!/Math\.random/.test(stripComments(src)), 'no weak RNG fallback');
  // Shared /invite/<token> URL space — reuse the document URL builder.
  match(src, /import \{ buildInviteUrl \} from '\.\/documentInviteService'/);
  match(src, /export \{ buildInviteUrl \}/);
  // Email path mirrors documents (GOAL-1: via the send-invite-email edge fn).
  match(src, /sendInviteEmailSmart/);
});

test('templateInviteService mirrors the document invite contract', () => {
  const src = read('src/services/templateInviteService.js');
  for (const fn of [
    'createTemplateInvite', 'listTemplateInvites', 'revokeTemplateInvite',
    'resendTemplateInvite', 'acceptTemplateInvite',
  ]) {
    match(src, new RegExp(`export async function ${fn}`), `${fn} must be exported`);
  }
  match(src, /kal31_accept_template_invite/);
  match(src, /kal31_resend_template_invite/);
  match(src, /kal31_revoke_template_invite/);
  match(src, /crypto\.getRandomValues/);
  ok(!/Math\.random/.test(stripComments(src)), 'no weak RNG fallback');
  match(src, /import \{ buildInviteUrl \} from '\.\/documentInviteService'/);
  match(src, /sendInviteEmailSmart/);
});

test('shareEmailService routes all three invite kinds through the smart server-side sender', () => {
  const src = read('src/services/shareEmailService.js');
  // GOAL-1: one smart sender invoking the send-invite-email edge fn; the
  // legacy per-kind client senders are gone (see goal1InviteClientContract).
  match(src, /export async function sendInviteEmailSmart/);
  match(src, /functions\.invoke\('send-invite-email'/);
  // Honest per-kind naming so the email copy reads correctly.
  match(src, /the project "/);
  match(src, /the template "/);
  // The existing-account branch still reuses the deployed document-invite
  // template — server-side now (edge fn handler).
  const fn = read('supabase/functions/send-invite-email/handler.js');
  match(fn, /template: 'document-invite'/);
});

test('ShareModal routes project/template kinds to the right service (no Phase-A block)', () => {
  const src = read('src/home/ShareModal.jsx');
  ok(!/Phase A ships document sharing only/.test(src), 'the kind block must be gone');
  match(src, /createProjectInvite/);
  match(src, /createTemplateInvite/);
  match(src, /createDocumentInvite/);
  // Locked UI invariants kept: single role selector, tier gate, honest link
  // placeholder, explicit access copy.
  match(src, /const ROLE_OPTIONS\s*=\s*\['Viewer',\s*'Editor',\s*'Owner'\]/);
  match(src, /Free plan accounts cannot create invite links/);
  match(src, /Press Copy link to create a secure/);
  match(src, /Anyone with this invite link can join as/);
});

test('InviteAcceptPage resolves tokens across document → project → template', () => {
  const src = read('src/home/InviteAcceptPage.jsx');
  match(src, /acceptDocumentInvite/);
  match(src, /acceptProjectInvite/);
  match(src, /acceptTemplateInvite/);
  // Fallback order: document first, then project, then template.
  const iDoc = src.indexOf('await acceptDocumentInvite(token)');
  const iProj = src.indexOf('await acceptProjectInvite(token)');
  const iTpl = src.indexOf('await acceptTemplateInvite(token)');
  ok(iDoc >= 0 && iProj > iDoc && iTpl > iProj, 'accept order must be document, project, template');
  // Success copy names the thing that was shared.
  match(src, /access to this \$\{kindNoun\}/);
  // Project/template land back on the hub root; documents deep-open.
  match(src, /docId=/);
  match(src, /goHome\(\)/);
});

test('ManageTeamModal is real: live rows, real invites, last-owner protection', () => {
  const src = read('src/home/ManageTeamModal.jsx');
  // Live data + real mutations.
  match(src, /getProjectCollaborators/);
  match(src, /listProjectInvites/);
  match(src, /createProjectInvite/);
  match(src, /updateProjectCollaboratorRole/);
  match(src, /removeProjectCollaborator/);
  match(src, /revokeProjectInvite/);
  match(src, /resendProjectInvite/);
  // Real link minting — the fake prototype URL is gone, links come from
  // buildInviteUrl over a real minted invite row.
  ok(!/survey\.hub\/p\//.test(src), 'fake survey.hub link must be gone');
  match(src, /buildInviteUrl/);
  match(src, /Press Copy link to create a secure/);
  // The send button actually sends (the decoy onClick={() => onClose()} is gone).
  ok(!/onClick=\{\(\) => onClose\(\)\}[^]{0,120}Send \{emailRole\} invite/.test(src),
    'send button must not be a close-only decoy');
  match(src, /onClick=\{sendInvites\}/);
  // Last-owner protection mirrors AccessManagementModal.
  match(src, /cannot demote the last owner/);
  match(src, /cannot remove the last owner/);
  // Creator is implicit owner and untouchable here.
  match(src, /The project creator is always an owner/);
  // Emails fire best-effort on role change / removal.
  match(src, /sendPermissionChangedEmail/);
  match(src, /sendAccessRemovedEmail/);
  // Tier gate matches ShareModal.
  match(src, /Free plan accounts cannot create invite links/);
});

test('ProjectsFolderTree team panel reads real project_collaborators rows', () => {
  const src = read('src/home/ProjectsFolderTree.jsx');
  match(src, /listProjectCollaboratorsForProjects/);
  // Bulk fetch keyed by project id, merged into the member directory.
  match(src, /collabByProject/);
  // Local-only (non-uuid) projects are skipped to avoid uuid cast errors.
  match(src, /UUID_RE/);
});
