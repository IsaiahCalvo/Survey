/* One plain-English summary of an "Invite by email" send (inviteFix, 2026-10-07).
 *
 * The Share dialog and Manage Team's Invite dialog used to show
 *   "Sent 0 of 1. First failure: Access was granted. The email may already
 *    have been delivered. Use Resend only if you intentionally want to send
 *    another copy.."
 * in a red box: two messages glued together, a double full stop, and alarm red
 * even though the person HAD been given access. This builder says what
 * happened to each address, in one sentence, and says which follow-up the
 * dialog can offer (copy that person's invite link, or try the email again).
 *
 * Input: [{ email, result }] where result is what create*Invite (or a
 * resend*Invite retry) returned: { success, invite?, accessGranted?,
 * emailSent?, retryable?, deliveryUncertain?, error? }.
 * Pure: no React, no network. Tests: tests/inviteSendSummary.test.mjs.
 */

/** Trim a service message and end it with exactly one full stop. */
export function asSentence(text) {
  const s = String(text || '').trim().replace(/[.\s]+$/, '');
  return s ? `${s}.` : '';
}

/** What happened to one address. */
export function describeInviteSendResult(email, result) {
  const who = email || 'This person';
  const invite = result?.invite || null;

  // The email went out. (A failure to close the pending invite after a
  // successful send is bookkeeping only - Manage Access hides that row.)
  if (result?.success || result?.emailSent === true) {
    return { email, state: 'sent', text: '', invite, canCopyLink: false, canRetry: false };
  }

  // Nothing was created: no access, no invite, nothing to copy.
  if (!invite) {
    const reason = asSentence(result?.error) || 'Try again.';
    return {
      email,
      state: 'failed',
      text: `Couldn't invite ${who}. ${reason}`,
      invite: null,
      canCopyLink: false,
      canRetry: false,
    };
  }

  // The invite exists but its email did not (certainly) go out. When the
  // send outcome is unknown the email may have arrived, so no Try again
  // (it could send a second copy) - only the copy-it-yourself route.
  const unsure = !!result?.deliveryUncertain || result?.retryable === false;
  const granted = !!result?.accessGranted;
  const copy = 'Copy the invite link to share it yourself';
  let state;
  let text;
  if (granted && unsure) {
    state = 'access-unsure';
    text = `${who} now has access, but we couldn't confirm the invite email was sent. ${copy}.`;
  } else if (granted) {
    state = 'access-no-email';
    text = `${who} now has access, but the invite email didn't send. ${copy}, or try again.`;
  } else if (unsure) {
    state = 'invite-unsure';
    text = `We couldn't confirm the invite email to ${who} was sent. They get access when they open the invite. ${copy}.`;
  } else {
    state = 'invite-no-email';
    text = `The invite email to ${who} didn't send, so they don't have access yet. ${copy}, or try again.`;
  }
  return { email, state, text, invite, canCopyLink: true, canRetry: !unsure };
}

/**
 * Summarise a whole send.
 * @returns {{ tone: 'success'|'warning'|'danger'|null, message: string,
 *   items: Array, sent: number, total: number }}
 *   tone   success = every email went out; warning = something needs a
 *          follow-up but nothing is broken (access was granted or an invite
 *          link exists); danger = at least one address got nothing at all.
 *   message the one line to show (a single address: its sentence; several:
 *          "1 of 3 invite emails sent." with the per-address lines in items).
 *   items  the addresses that need attention, in input order.
 */
export function summarizeInviteSend(entries, { roleLabel = '' } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const described = list.map(({ email, result }) => describeInviteSendResult(email, result));
  const items = described.filter((d) => d.state !== 'sent');
  const total = described.length;
  const sent = total - items.length;
  const role = roleLabel ? `${String(roleLabel).toLowerCase()} ` : '';

  if (!total) return { tone: null, message: '', items: [], sent: 0, total: 0 };
  if (!items.length) {
    return {
      tone: 'success',
      message: total === 1 && described[0].email
        ? `Sent ${role}invite to ${described[0].email}.`
        : `Sent ${total} ${role}invite${total === 1 ? '' : 's'}.`,
      items: [],
      sent,
      total,
    };
  }
  const tone = items.some((d) => d.state === 'failed') ? 'danger' : 'warning';
  const message = total === 1
    ? items[0].text
    : `${sent} of ${total} invite emails sent.`;
  return { tone, message, items, sent, total };
}

/**
 * Fold a Try again (resend*Invite) result back into the original entry. A
 * resend does not repeat the access grant, so keep what the first attempt
 * established (the invite row and whether access was granted).
 */
export function mergeRetryResult(original, retry) {
  const prev = original?.result || {};
  if (retry?.success) {
    return { email: original?.email, result: { ...prev, success: true, emailSent: true, error: undefined } };
  }
  return {
    email: original?.email,
    result: {
      ...prev,
      success: false,
      emailSent: retry?.emailSent === true,
      retryable: retry?.retryable !== false,
      deliveryUncertain: retry?.retryable === false,
      error: retry?.error || prev.error,
    },
  };
}
