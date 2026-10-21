// Runs the kits-admin edge function's logic (supabase/functions/_shared/kitsAdmin.js)
// in Node for the signed-in e2e: the local stack has no edge runtime. Reads
// { auth, payload } on stdin, prints { status, body }.
import { createClient } from '@supabase/supabase-js';
import { handleKitsAdmin } from '../../supabase/functions/_shared/kitsAdmin.js';

const input = JSON.parse(await new Promise((resolve) => {
  let s = ''; process.stdin.on('data', (c) => { s += c; }); process.stdin.on('end', () => resolve(s));
}));
const url = process.env.E2E_SUPABASE_URL;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const userClient = createClient(url, process.env.E2E_SUPABASE_ANON_KEY, { ...opts, global: { headers: { Authorization: input.auth } } });
const { data: { user } } = await userClient.auth.getUser(String(input.auth).replace(/^Bearer\s+/i, ''));
const result = user
  ? await handleKitsAdmin(input.payload, { userClient, service: createClient(url, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY, opts) })
  : { status: 401, body: { error: 'Unauthorized' } };
process.stdout.write(JSON.stringify(result));
