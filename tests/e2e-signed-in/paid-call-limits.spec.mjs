// Short-window limits on paid calls (migration 20261022010100): the voice
// agent's per-minute burst cap and the profile-change email cap; and the
// daily cap on voice logs (20261022190000).
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
    // Parallel claims cannot all read the same count and all pass.
    await admin.from('email_send_events').delete().eq('user_id', userId);
    const parallel = await Promise.all(Array.from({ length: 12 }, () => client.rpc('claim_email_send', {
      p_template: 'profile-change', p_recipient: E2E_ACCOUNTS.editor.email, p_is_invite: false,
    })));
    expect(parallel.filter((r) => r.data === 'allowed')).toHaveLength(5);
    await admin.from('email_send_events').delete().eq('user_id', userId);
    // Other mail from the same person still has its own room under the hourly cap.
    const { data: other } = await client.rpc('claim_email_send', { p_template: 'document-invite', p_recipient: 'someone@example.com', p_is_invite: false });
    expect(other).toBe('allowed');
  } finally {
    await admin.from('email_send_events').delete().eq('user_id', userId);
  }
});

test('one person can send at most 50 voice logs a day, and back-dating does not get round it', async () => {
  const admin = adminClient();
  const { client, userId } = await signedIn(E2E_ACCOUNTS.pro);
  await admin.from('survey_agent_voice_logs').delete().eq('user_id', userId);
  try {
    const old = new Date(Date.now() - 3 * 864e5).toISOString();
    for (let i = 0; i < 50; i += 1) {
      const { error } = await client.from('survey_agent_voice_logs').insert({ log: { turns: [] }, created_at: old });
      expect(error).toBeNull();
    }
    const { data: rows } = await admin.from('survey_agent_voice_logs').select('created_at').eq('user_id', userId);
    expect(rows.every((r) => Date.parse(r.created_at) > Date.now() - 3600e3)).toBe(true);
    const over = await client.from('survey_agent_voice_logs').insert({ log: { turns: [] }, created_at: old });
    expect(over.error?.message).toContain('voice_log_limit');
  } finally {
    await admin.from('survey_agent_voice_logs').delete().eq('user_id', userId);
  }
});
