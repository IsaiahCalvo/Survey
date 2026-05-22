// Probe whether the send-email edge function is reachable from a signed-in
// user. We deliberately send a minimal payload to confirm wire reachability,
// not to send a real email.
import { admin, SUPABASE_URL, SUPABASE_ANON_KEY } from './admin-client.mjs';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

const usersJson = JSON.parse(
  readFileSync(new URL('../logs/area-02-users.json', import.meta.url), 'utf8')
);
const PASSWORD = usersJson.password;
const pro = usersJson.users.find((u) => u.role === 'pro');

const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
await c.auth.signInWithPassword({ email: pro.email, password: PASSWORD });

const out = {};

// Probe send-email function with intentionally minimal payload
const url = `${SUPABASE_URL}/functions/v1/send-email`;
const { data: { session } } = await c.auth.getSession();
const headers = {
  'Authorization': `Bearer ${session?.access_token || ''}`,
  'apikey': SUPABASE_ANON_KEY,
  'Content-Type': 'application/json'
};

// 1. OPTIONS — should return 200 if function deployed + CORS configured
try {
  const r = await fetch(url, { method: 'OPTIONS', headers });
  out.options = { status: r.status };
} catch (e) {
  out.options = { error: String(e?.message || e) };
}

// 2. POST with empty body — should return 400 from the function itself
try {
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({}) });
  const text = await r.text();
  out.empty_post = { status: r.status, body: text.slice(0, 400) };
} catch (e) {
  out.empty_post = { error: String(e?.message || e) };
}

// 3. POST with bogus payload — confirm function reaches "Missing fields"
try {
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ to: 'noone@example.invalid' }) });
  const text = await r.text();
  out.missing_fields_post = { status: r.status, body: text.slice(0, 400) };
} catch (e) {
  out.missing_fields_post = { error: String(e?.message || e) };
}

await c.auth.signOut();
writeFileSync(new URL('../logs/area-12-functions.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
