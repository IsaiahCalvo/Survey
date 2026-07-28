// agent-cli/lib/client.mjs — build a Supabase client for headless CLI use.
//
// Two modes:
//   'user'    (default) — anon key + sign in as the dev test account. This goes
//             through Row-Level Security exactly like the real app, so load
//             measurements reflect the per-row access-check cost a real user pays.
//   'service' — service-role key, which BYPASSES RLS. Faster, NOT representative
//             of real-user cost; use only as a floor/baseline comparison.

import { createClient } from '@supabase/supabase-js';
import { loadVerifiedTestAccounts } from '../../scripts/test-account-lease.mjs';
import { loadEnv } from './env.mjs';

loadEnv();

export async function makeClient(mode = 'user') {
  const url = process.env.VITE_SUPABASE_URL;
  if (!url) throw new Error('VITE_SUPABASE_URL missing (check .env)');

  if (mode === 'service') {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing (check .env.local)');
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    return { supabase, mode, userId: null, who: 'service-role (RLS bypassed)' };
  }

  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  const [leasedAccount] = loadVerifiedTestAccounts();
  const { email, password, userId: leasedUserId } = leasedAccount;
  if (!anon) throw new Error('VITE_SUPABASE_ANON_KEY missing (check .env)');
  const supabase = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`dev login failed: ${error.message}`);
  if (data.user.id !== leasedUserId) {
    throw new Error(`Leased account identity mismatch for ${email}`);
  }
  return { supabase, mode, userId: data.user.id, who: `${email} (RLS enforced)` };
}
