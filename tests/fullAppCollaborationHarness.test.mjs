import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  createCollaborationEvidence,
  finalizeCollaborationEvidence,
  parseAccountIdentity,
  resolveLeasedCollaborationAccounts,
  assertRuntimeOwnerEntitlement,
} from '../agent-cli/full-app-collaboration-contract.mjs';

const owner = {
  email: 'paid-owner@example.test',
  userId: '11111111-1111-4111-8111-111111111111',
  tier: 'developer',
  status: 'active',
  password: 'secret-owner',
};
const invitee = {
  email: 'invitee@example.test',
  userId: '22222222-2222-4222-8222-222222222222',
  tier: 'free',
  status: 'active',
  password: 'secret-invitee',
};

test('exact account identities require email and Supabase user id', () => {
  assert.deepEqual(
    parseAccountIdentity(`${owner.email}|${owner.userId}`, 'owner'),
    { email: owner.email, userId: owner.userId },
  );
  assert.throws(() => parseAccountIdentity(owner.email, 'owner'), /email\|user-id/);
  assert.throws(() => parseAccountIdentity(`wrong|${owner.userId}`, 'owner'), /valid email/);
});

test('leased collaboration identities resolve by exact identity, never position', () => {
  const resolved = resolveLeasedCollaborationAccounts([invitee, owner], {
    ownerIdentity: `${owner.email}|${owner.userId}`,
    inviteeIdentity: `${invitee.email}|${invitee.userId}`,
  });
  assert.equal(resolved.ownerIndex, 1);
  assert.equal(resolved.inviteeIndex, 0);
  assert.equal(resolved.owner.email, owner.email);
  assert.equal(resolved.invitee.userId, invitee.userId);
  const reversed = resolveLeasedCollaborationAccounts([owner, invitee], {
    ownerIdentity: `${invitee.email}|${invitee.userId}`,
    inviteeIdentity: `${owner.email}|${owner.userId}`,
  });
  assert.equal(reversed.owner.email, invitee.email, 'lease baseline tier must not impersonate runtime entitlement');
  assert.throws(() => resolveLeasedCollaborationAccounts([owner, invitee], {
    ownerIdentity: `${owner.email}|${owner.userId}`,
    inviteeIdentity: `${owner.email}|${owner.userId}`,
  }), /must be different/);
});

test('paid owner gate uses the signed-in backend entitlement, not lease baseline', () => {
  assert.deepEqual(assertRuntimeOwnerEntitlement({
    userId: owner.userId,
    tier: 'developer',
    status: 'active',
  }, owner.userId), { userId: owner.userId, tier: 'developer', status: 'active' });
  assert.throws(() => assertRuntimeOwnerEntitlement({
    userId: owner.userId,
    tier: 'free',
    status: 'active',
  }, owner.userId), /runtime owner entitlement/);
  assert.throws(() => assertRuntimeOwnerEntitlement({
    userId: owner.userId,
    tier: 'developer',
    status: 'trialing',
  }, owner.userId), /active runtime owner entitlement/);
});

test('collaboration cleanup fails closed until invites and collaborator are retired', () => {
  const evidence = createCollaborationEvidence({ owner, invitee });
  evidence.createdInvites.push(
    { id: 'invite-accepted', token: 'token-a', accepted: true },
    { id: 'invite-revoked', token: 'token-b', accepted: false },
  );
  evidence.coverage = {
    invite: 'covered',
    accept: 'covered',
    viewerPermission: 'covered',
    reload: 'covered',
    roleChange: 'covered',
    editorPermission: 'covered',
    revoke: 'covered',
    remove: 'covered',
  };
  assert.equal(finalizeCollaborationEvidence(structuredClone(evidence)).complete, false);
  evidence.revokedInviteIds.push('invite-revoked');
  evidence.removedCollaboratorUserIds.push(invitee.userId);
  evidence.acceptedInviteIds.push('invite-accepted');
  evidence.parentProjectDeleteObserved = true;
  evidence.exactBackendAbsence.invites.push('invite-accepted', 'invite-revoked');
  evidence.exactBackendAbsence.collaborators.push(invitee.userId);
  assert.equal(finalizeCollaborationEvidence(evidence).complete, true, evidence.problems.join('\n'));
});

test('runtime harness is lease-only and covers invite lifecycle without credentials or admin bypasses', () => {
  const runtime = readFileSync(new URL('../agent-cli/full-app-collaboration-e2e.mjs', import.meta.url), 'utf8');
  const durable = readFileSync(new URL('../agent-cli/full-app-durable-e2e.mjs', import.meta.url), 'utf8');
  assert.match(durable, /loadVerifiedTestAccounts/);
  assert.match(durable, /resolveLeasedCollaborationAccounts/);
  assert.match(runtime, /installLeasedBrowserAccount/);
  assert.match(runtime, new RegExp(['assertBrowserUses', 'LeasedAccount'].join('')));
  assert.match(runtime, /data-kal31-status/);
  assert.match(runtime, /viewerPermission = 'covered'/);
  assert.match(runtime, /editorPermission = 'covered'/);
  assert.match(runtime, /revokePendingInvite/);
  assert.match(runtime, /removeInvitee/);
  assert.match(runtime, /proveProjectCollaborationCleanup/);
  assert.doesNotMatch(`${runtime}\n${durable}`, /VITE_DEV_AUTO_LOGIN|SERVICE_ROLE|bot-credentials|createUser|signUp/);
});

test('collaboration project lookup is scoped to the interactive project row and avoids strict text ambiguity', () => {
  const runtime = readFileSync(new URL('../agent-cli/full-app-collaboration-e2e.mjs', import.meta.url), 'utf8');
  assert.match(runtime, /\.projects-desktop-layout \[data-project-id\]/);
  assert.match(runtime, /\.projects-mobile-layout \[data-project-id\]/);
  assert.match(runtime, /findProjectControl\(page, projectName\)/);
  assert.match(runtime, /clickProjectControl\(page, projectName\)/);
  assert.match(runtime, /child\.children\.length === 0 && child\.textContent\?\.trim\(\) === name/);
  assert.doesNotMatch(runtime, /getByText\(projectName, \{ exact: true \}\)/);
});

test('mobile collaboration opens the real project row, team surface, and rename input', () => {
  const runtime = readFileSync(new URL('../agent-cli/full-app-collaboration-e2e.mjs', import.meta.url), 'utf8');
  const projects = readFileSync(new URL('../src/home/ProjectsFolderTree.jsx', import.meta.url), 'utf8');
  /* The row's class list is a template literal now — it appends is-selected
     when the project is picked in Select mode — so the class names are matched
     without the closing quote that a fixed attribute used to have. */
  assert.match(projects, /data-project-id=\{p\.id\}[\s\S]*?role="button"[\s\S]*?className=\{`projects-mobile-folder-row drill reorderable/);
  assert.match(projects, /aria-label="Manage team"[\s\S]*?setTeamModalProject\(mobileDrillProject\)/);
  assert.match(runtime, /getByRole\('button', \{ name: 'Manage team', exact: true \}\)/);
  assert.match(runtime, /input\[title="Click to rename"\], input\[title="Tap to rename"\]/);
});

test('mobile navigation exits transient surfaces and scopes tabs or the rail', () => {
  const runtime = readFileSync(new URL('../agent-cli/full-app-collaboration-e2e.mjs', import.meta.url), 'utf8');
  assert.match(runtime, /async function exitMobileTransientSurface/);
  assert.match(runtime, /manageTeam\.getByRole\('button', \{ name: 'Done', exact: true \}\)/);
  assert.match(runtime, /getByRole\('button', \{ name: 'Back to documents', exact: true \}\)/);
  assert.match(runtime, /locator\('\.projects-mobile-back-button'\)/);
  assert.match(runtime, /getByRole\('navigation', \{ name: 'Home sections', exact: true \}\)/);
  assert.match(runtime, /getByRole\('button', \{ name: 'Open navigation', exact: true \}\)/);
  assert.match(runtime, /getByRole\('complementary', \{ name: 'Mobile navigation', exact: true \}\)/);
  assert.match(runtime, /desktopNavigation\.getByRole\('button', \{ name: title, exact: true \}\)/);
  assert.doesNotMatch(runtime, /clickVisible\(page\.getByRole\('button', \{ name: title/);
});

test('role change uses the menu already opened by Change role and stays inside the exact collaborator row', () => {
  const runtime = readFileSync(new URL('../agent-cli/full-app-collaboration-e2e.mjs', import.meta.url), 'utf8');
  const modal = readFileSync(new URL('../src/home/ManageTeamModal.jsx', import.meta.url), 'utf8');
  assert.match(modal, /data-kal31-project-member=\{m\.userId \|\| m\.id\}/);
  assert.match(modal, /data-kal31-role-menu="true"/);
  assert.match(modal, /data-kal31-role-option=\{r\.toLowerCase\(\)\}/);
  assert.match(runtime, /editRow\.locator\('\[data-kal31-role-menu="true"\]'\)/);
  assert.match(runtime, /roleMenu\.locator\(`\[data-kal31-role-option="\$\{role\.toLowerCase\(\)\}"\]`\)/);
  assert.doesNotMatch(runtime, /current collaborator role/);
});

test('collaborator removal targets the exact leased user-id row and scopes its action menu', () => {
  const runtime = readFileSync(new URL('../agent-cli/full-app-collaboration-e2e.mjs', import.meta.url), 'utf8');
  assert.match(runtime, /page\.locator\(`\[data-kal31-project-member="\$\{userId\}"\]`\)/);
  assert.match(runtime, /Expected one exact collaborator row for \$\{userId\}/);
  assert.match(runtime, /removeInvitee\(page, inviteeEmail, inviteeUserId\)/);
  assert.match(runtime, /row\.getByRole\('button', \{ name: 'Remove from team', exact: true \}\)/);
  assert.match(runtime, /removeInvitee\(ownerPage, inviteeAccount\.email, inviteeAccount\.userId\)/);
  assert.doesNotMatch(runtime, /findAncestorWith\(email, 'button\[title="More"\]', 'collaborator row'\)/);
});

test('invite revocation targets the exact invite UUID row and scopes its action menu', () => {
  const runtime = readFileSync(new URL('../agent-cli/full-app-collaboration-e2e.mjs', import.meta.url), 'utf8');
  const modal = readFileSync(new URL('../src/home/ManageTeamModal.jsx', import.meta.url), 'utf8');
  assert.match(modal, /data-kal31-project-invite=\{inv\.id\}/);
  assert.match(runtime, /page\.locator\(`\[data-kal31-project-invite="\$\{inviteId\}"\]`\)/);
  assert.match(runtime, /Expected one exact pending invite row for \$\{inviteId\}/);
  assert.match(runtime, /revokePendingInvite\(page, inviteId\)/);
  assert.match(runtime, /row\.getByRole\('button', \{ name: 'Revoke invite', exact: true \}\)/);
  assert.match(runtime, /revokePendingInvite\(ownerPage, revokedInvite\.row\.id\)/);
  assert.doesNotMatch(runtime, /tokenText|findAncestorWith\([^\n]*pending invite/);
});

test('all collaboration modal actions use deterministic scoped surfaces, not ancestor guessing', () => {
  const runtime = readFileSync(new URL('../agent-cli/full-app-collaboration-e2e.mjs', import.meta.url), 'utf8');
  const modal = readFileSync(new URL('../src/home/ManageTeamModal.jsx', import.meta.url), 'utf8');
  assert.match(modal, /data-kal31-project-invite-modal="true"/);
  assert.match(modal, /data-kal31-manage-team="true"/);
  assert.match(runtime, /manageTeam\.getByRole\('button', \{ name: 'Invite', exact: true \}\)/);
  assert.match(runtime, /inviteModal\.getByRole\('button', \{ name: 'Copy link', exact: true \}\)/);
  assert.match(runtime, /inviteModal\.locator\('button\[title="Close"\]'\)/);
  assert.match(runtime, /data-kal31-invite-page="true"/);
  assert.match(runtime, /manageTeam\.getByRole\('button', \{ name: 'Done', exact: true \}\)/);
  assert.match(runtime, /manageTeam\.waitFor\(\{ state: 'hidden'/);
  assert.match(runtime, /waitForHub\(ownerPage, 'Projects'\)/);
  assert.doesNotMatch(runtime, /findAncestorWith|xpath=\.\.|getByText\('Invite User'|getByText\('Manage Team'/);
});
