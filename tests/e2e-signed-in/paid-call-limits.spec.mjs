// Short-window limits on paid calls (migration 20261022010100): the voice
// agent's per-minute burst cap and the profile-change email cap.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, apiClientFor, expect, test } from './helpers.mjs';

async function signedIn(account) {
  const client = await apiClientFor(account);
  const { data } = await client.auth.getUser();
  return { client, userId: data.user.id };
}

test('the voice agent allows 20 requests a minute per person, then refuses', async () => {
  const admin = adminClient();
  const { userId } = await signedIn(E2E_ACCOUNTS.pro);
  await admin.from('survey_agent_usage').delete().eq('user_id', userId);
  try {
    const results = [];
    for (let i = 0; i < 22; i += 1) {
      const { data } = await admin.rpc('reserve_survey_agent_request', { p_user_id: userId, p_request_cap: 3000, p_cost_cap_micros: 1_000_000 });
      results.push(data);
    }
    expect(results.filter(Boolean)).toHaveLength(20);
    expect(results.slice(20)).toEqual([false, false]);
  } finally {
    await admin.from('survey_agent_usage').delete().eq('user_id', userId);
  }
});

test('one person can send at most 5 profile-change emails an hour', async () => {
  const admin = adminClient();
  const { client, userId } = await signedIn(E2E_ACCOUNTS.editor);
  await admin.from('email_send_events').delete().eq('user_id', userId);
  try {
    const results = [];
    for (let i = 0; i < 6; i += 1) {
      const { data } = await client.rpc('claim_email_send', { p_template: 'profile-change', p_recipient: E2E_ACCOUNTS.editor.email, p_is_invite: false });
      results.push(data);
    }
    expect(results).toEqual(['allowed', 'allowed', 'allowed', 'allowed', 'allowed', 'rate_limited']);
    // Other mail from the same person still has its own room under the hourly cap.
    const { data: other } = await client.rpc('claim_email_send', { p_template: 'document-invite', p_recipient: 'someone@example.com', p_is_invite: false });
    expect(other).toBe('allowed');
  } finally {
    await admin.from('email_send_events').delete().eq('user_id', userId);
  }
});
