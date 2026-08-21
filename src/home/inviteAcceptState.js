// Invite accept copy + token fall-through. Extracted from InviteAcceptPage
// so Node can prove intended / break / edge without mounting React.

export const INVITE_ACCEPT_STATUSES = Object.freeze([
  'accepted',
  'already_accepted',
  'wrong_account',
  'expired',
  'revoked',
  'invalid',
]);

export async function acceptAnyInvite(token, {
  acceptDocumentInvite,
  acceptProjectInvite,
  acceptTemplateInvite,
} = {}) {
  if (!token) return { status: 'invalid', kind: 'document' };
  const doc = await acceptDocumentInvite(token);
  if (doc.status !== 'invalid') return { ...doc, kind: 'document' };
  const proj = await acceptProjectInvite(token);
  if (proj.status !== 'invalid') return { ...proj, kind: 'project' };
  const tpl = await acceptTemplateInvite(token);
  if (tpl.status !== 'invalid') return { ...tpl, kind: 'template' };
  return { ...doc, status: 'invalid', kind: 'document' };
}

export function inviteResultHeading({ phase, result } = {}) {
  if (phase === 'loading') return 'Checking invite…';
  if (phase === 'needs-auth') return 'Sign in to accept this invite';
  if (!result) return 'Invite';
  switch (result.status) {
    case 'accepted': return result.upgradeRequired ? 'Welcome — Viewer access granted' : 'Welcome!';
    case 'already_accepted': return 'You already accepted this invite';
    case 'wrong_account': return 'Wrong account';
    case 'expired': return 'This invite has expired';
    case 'revoked': return 'This invite was revoked';
    case 'invalid':
    default: return 'Invite link looks invalid';
  }
}

export function inviteResultDescription({ phase, result } = {}) {
  if (phase === 'loading') return 'Validating your invite. One moment…';
  if (phase === 'needs-auth') return 'Sign in or create a free Survey account to accept this invite.';
  if (!result) return '';
  const kindNoun = result.kind || 'document';
  switch (result.status) {
    case 'accepted':
      if (result.upgradeRequired) {
        const intended = (result.intendedRole || 'editor').toLowerCase();
        return `You have Viewer access for now. Upgrade to Pro or higher to unlock ${intended.charAt(0).toUpperCase() + intended.slice(1)} access.`;
      }
      return `You now have ${(result.effectiveRole || 'viewer')} access to this ${kindNoun}.`;
    case 'already_accepted':
      return 'This invite was used previously. Your access is still active.';
    case 'wrong_account':
      return 'This invite was sent to a different email address. Sign out and sign back in with the invited email to accept.';
    case 'expired':
      return 'This invite expired. Ask the owner to send a new one.';
    case 'revoked':
      return 'The owner revoked this invite before you accepted it. Ask them for a new one if you need access.';
    case 'invalid':
    default:
      return 'We couldn\'t find that invite. The link may be mistyped or the invite was deleted.';
  }
}
