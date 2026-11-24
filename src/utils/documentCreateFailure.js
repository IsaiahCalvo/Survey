// What to say when the cloud row for a new document can't be made.
//
// On the Free plan the documents table refuses a 6th row through its row
// rule, so the server's words were "new row violates row-level security
// policy for table documents" (round 4 audit, r4d #11). When that refusal
// comes with the account at its document limit, say the limit, as the
// project limit does; anything else gets plain words, never the raw text.
import { withUpgradeHint } from './accountPlatform.js';

export function isRowRuleRefusal(err) {
  return err?.code === '42501' || /row-level security/i.test(String(err?.message || ''));
}

const planName = (tier) => {
  const t = String(tier || 'free');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function documentLimitText(limit, tier) {
  return withUpgradeHint(
    `You've reached the limit of ${limit} document${limit > 1 ? 's' : ''} on the ${planName(tier)} plan.`,
    'Upgrade to Pro for unlimited documents.',
  );
}

/**
 * @returns {Promise<{ text: string, limit: boolean }>}
 */
export async function documentCreateFailure(err, { client = null, userId = null, tier = 'free' } = {}) {
  if (!isRowRuleRefusal(err)) {
    return { text: `Couldn’t prepare the document in the cloud: ${err?.message || 'Unknown error'}`, limit: false };
  }
  if (client && userId) {
    try {
      const [limitRes, countRes] = await Promise.all([
        client.rpc('get_document_limit', { p_user_id: userId }),
        client.from('documents').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      ]);
      const limit = Number(limitRes?.data);
      const count = Number(countRes?.count);
      if (Number.isFinite(limit) && limit > 0 && limit < 999999 && Number.isFinite(count) && count >= limit) {
        return { text: documentLimitText(limit, tier), limit: true };
      }
    } catch {
      // Fall through to the plain words below.
    }
  }
  return { text: 'Couldn’t add the document to your account. Reload Survey and try again.', limit: false };
}
