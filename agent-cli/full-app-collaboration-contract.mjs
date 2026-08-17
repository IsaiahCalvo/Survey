const PAID_OWNER_TIERS = new Set(['pro', 'enterprise', 'developer']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseAccountIdentity(value, label = 'account') {
  const [email, userId, ...extra] = String(value || '').split('|').map((part) => part.trim());
  if (!email || !userId || extra.length) {
    throw new Error(`${label} must use exact email|user-id syntax`);
  }
  if (!EMAIL_RE.test(email)) throw new Error(`${label} must include a valid email`);
  if (!UUID_RE.test(userId)) throw new Error(`${label} must include a valid Supabase user id`);
  return { email: email.toLowerCase(), userId: userId.toLowerCase() };
}

export function accountTier(account) {
  return String(account?.tier || account?.baseline?.tier || 'unknown').toLowerCase();
}

export function accountStatus(account) {
  return String(account?.status || account?.baseline?.status || 'unknown').toLowerCase();
}

export function resolveLeasedCollaborationAccounts(accounts, { ownerIdentity, inviteeIdentity }) {
  const ownerExact = parseAccountIdentity(ownerIdentity, 'owner account');
  const inviteeExact = parseAccountIdentity(inviteeIdentity, 'invitee account');
  if (ownerExact.email === inviteeExact.email || ownerExact.userId === inviteeExact.userId) {
    throw new Error('Owner and invitee leased accounts must be different');
  }
  const exactIndex = (identity, label) => {
    const index = accounts.findIndex((account) => (
      String(account?.email || '').toLowerCase() === identity.email
      && String(account?.userId || '').toLowerCase() === identity.userId
    ));
    if (index < 0) throw new Error(`${label} exact email/user-id is not present in the verified lease`);
    return index;
  };
  const ownerIndex = exactIndex(ownerExact, 'Owner');
  const inviteeIndex = exactIndex(inviteeExact, 'Invitee');
  const owner = accounts[ownerIndex];
  const invitee = accounts[inviteeIndex];
  if (accountStatus(owner) !== 'active' || accountStatus(invitee) !== 'active') {
    throw new Error('Collaboration E2E requires both exact leased accounts to be active');
  }
  return { owner, ownerIndex, invitee, inviteeIndex };
}

export function assertRuntimeOwnerEntitlement(entitlement, expectedUserId) {
  const userId = String(entitlement?.userId || '').toLowerCase();
  const tier = String(entitlement?.tier || 'unknown').toLowerCase();
  const status = String(entitlement?.status || 'unknown').toLowerCase();
  if (userId !== String(expectedUserId || '').toLowerCase()) {
    throw new Error('Runtime entitlement response did not belong to the exact leased owner');
  }
  if (!PAID_OWNER_TIERS.has(tier)) {
    throw new Error(`Collaboration E2E requires paid runtime owner entitlement; signed-in backend returned ${tier}`);
  }
  if (status !== 'active') {
    throw new Error(`Collaboration E2E requires active runtime owner entitlement; signed-in backend returned ${status}`);
  }
  return { userId, tier, status };
}

export function createCollaborationEvidence({ owner, invitee, runtimeOwnerEntitlement = null }) {
  return {
    schemaVersion: 1,
    status: 'pending',
    owner: { email: owner.email, userId: owner.userId, tier: accountTier(owner), status: accountStatus(owner) },
    invitee: { email: invitee.email, userId: invitee.userId, tier: accountTier(invitee), status: accountStatus(invitee) },
    runtimeOwnerEntitlement,
    coverage: {
      invite: 'pending', accept: 'pending', viewerPermission: 'pending', reload: 'pending',
      roleChange: 'pending', editorPermission: 'pending', revoke: 'pending', remove: 'pending',
    },
    createdInvites: [],
    acceptedInviteIds: [],
    revokedInviteIds: [],
    removedCollaboratorUserIds: [],
    parentProjectDeleteObserved: false,
    exactBackendAbsence: { invites: [], collaborators: [] },
    errors: [],
    complete: false,
  };
}

export function finalizeCollaborationEvidence(evidence) {
  const requiredCoverage = Object.entries(evidence.coverage || {})
    .filter(([, value]) => value !== 'covered')
    .map(([key]) => key);
  const accepted = new Set(evidence.acceptedInviteIds || []);
  const revoked = new Set(evidence.revokedInviteIds || []);
  const removed = new Set(evidence.removedCollaboratorUserIds || []);
  const problems = requiredCoverage.map((key) => `${key} was not covered`);
  for (const invite of evidence.createdInvites || []) {
    if (invite.accepted && !accepted.has(invite.id)) problems.push(`accepted invite ${invite.id} lacks acceptance proof`);
    if (!invite.accepted && !revoked.has(invite.id)) problems.push(`pending invite ${invite.id} lacks revoke proof`);
  }
  if (!removed.has(evidence.invitee?.userId)) problems.push('invitee collaborator removal was not proved');
  if (!evidence.parentProjectDeleteObserved) problems.push('parent project delete/cascade was not observed');
  const inviteAbsence = new Set(evidence.exactBackendAbsence?.invites || []);
  const collaboratorAbsence = new Set(evidence.exactBackendAbsence?.collaborators || []);
  for (const invite of evidence.createdInvites || []) {
    if (!inviteAbsence.has(invite.id)) problems.push(`invite ${invite.id} lacks exact backend cleanup proof`);
  }
  if (!collaboratorAbsence.has(evidence.invitee?.userId)) problems.push('invitee collaborator lacks exact backend cleanup proof');
  if (evidence.errors?.length) problems.push(`${evidence.errors.length} collaboration error(s) recorded`);
  evidence.problems = problems;
  evidence.complete = problems.length === 0;
  evidence.status = evidence.complete ? 'covered-and-clean' : 'incomplete';
  return evidence;
}
