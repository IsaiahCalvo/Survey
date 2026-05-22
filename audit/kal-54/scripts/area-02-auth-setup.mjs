// Area 2 — provision disposable users across tiers and verify sign-in.
import { admin, SUPABASE_URL, SUPABASE_ANON_KEY } from './admin-client.mjs';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const ts = Date.now();
const ROLES = ['free', 'pro', 'developer', 'enterprise'];
const PASSWORD = 'Audit#54-' + ts;
const created = [];
const results = [];

async function provision(role) {
  const email = `survey-test-${role}-${ts}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { audit: 'kal-54', role }
  });
  if (error) {
    results.push({ role, email, ok: false, stage: 'create', error: error.message });
    return null;
  }
  const userId = data.user.id;
  created.push({ role, email, userId });
  return { email, userId };
}

async function setProfileTier(userId, tier) {
  // Try common tier columns / RPCs. The schema typically has a `profiles` row
  // auto-created via trigger; we attempt direct UPDATE on plausible columns.
  const patches = [
    { subscription_tier: tier },
    { plan: tier },
    { tier }
  ];
  for (const patch of patches) {
    const { error } = await admin.from('profiles').update(patch).eq('id', userId);
    if (!error) return Object.keys(patch)[0];
  }
  return null;
}

async function verifySignIn(email) {
  const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data, error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) return { ok: false, error: error.message };
  await c.auth.signOut();
  return { ok: true, userId: data.user.id };
}

(async () => {
  for (const role of ROLES) {
    const u = await provision(role);
    if (!u) continue;
    const tierCol = await setProfileTier(u.userId, role);
    const signIn = await verifySignIn(u.email);
    results.push({
      role,
      email: u.email,
      userId: u.userId,
      tierColumn: tierCol,
      signIn
    });
  }

  // Write to log
  writeFileSync(
    new URL('../logs/area-02-users.json', import.meta.url),
    JSON.stringify({ password: PASSWORD, users: created, results }, null, 2)
  );
  console.log(JSON.stringify({ password: PASSWORD, results }, null, 2));
})();
