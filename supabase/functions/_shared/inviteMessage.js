// The inviter's own words on an email invite (share dialog, Nightly flag
// share-extras). Plain text only: line breaks kept, other control characters
// dropped, at most 500 characters, at most one blank line in a row. Used by
// send-invite-email (what it forwards) and send-email (what it renders, after
// HTML-escaping). The app's copy is cleanInviteMessage in src/home/accessRows.js.
export const INVITE_MESSAGE_MAX = 500;

export function inviteMessage(v) {
  if (typeof v !== 'string') return '';
  return v
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\x00-\x09\x0b-\x1f\x7f]/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, INVITE_MESSAGE_MAX)
    .trim();
}
