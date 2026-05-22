import { createClient } from '/Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2/.claude/worktrees/agent-a5368e61bcaea4ed3/node_modules/@supabase/supabase-js/dist/index.mjs';
import fs from 'node:fs';

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('#') || !line.trim()) continue;
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadEnvFile('/Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2/.claude/worktrees/agent-a5368e61bcaea4ed3/.env.local');
loadEnvFile('/Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2/.claude/worktrees/agent-a5368e61bcaea4ed3/.env');

const URL = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log('URL=', URL);

const admin = createClient(URL, SVC, { auth: { persistSession: false, autoRefreshToken: false } });
const STAMP = Date.now();
const password = 'Kal31-Verify-Pass!';
const ownerEmail = `test-rpc-owner-${STAMP}@example.com`;
const userEmail = `test-rpc-user-${STAMP}@example.com`;

const { data: ow } = await admin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true });
const ownerId = ow.user.id;
const { data: us } = await admin.auth.admin.createUser({ email: userEmail, password, email_confirm: true });
const userId = us.user.id;
await admin.from('user_subscriptions').upsert({ user_id: ownerId, tier: 'pro', status: 'active' }, { onConflict: 'user_id' });
await admin.from('user_subscriptions').upsert({ user_id: userId, tier: 'pro', status: 'active' }, { onConflict: 'user_id' });

const { data: doc, error: doc_e } = await admin.from('documents').insert({
  name: 'test-rpc-doc', user_id: ownerId,
  file_path: `kal31-rpc/${STAMP}.pdf`, file_size: 0, page_count: 1
}).select().single();
if (doc_e) { console.error('doc create error:', doc_e); process.exit(1); }

await admin.from('document_collaborators').upsert({
  document_id: doc.id, user_id: ownerId, email: ownerEmail, role: 'owner', status: 'active'
}, { onConflict: 'document_id,user_id' });

const token = `test-rpc-${STAMP}`;
const { data: inv } = await admin.from('document_invites').insert({
  document_id: doc.id, token,
  role: 'viewer', intended_role: 'viewer',
  target_email: userEmail.toLowerCase(),
  created_by: ownerId,
  expires_at: new Date(Date.now() + 86400000).toISOString(),
}).select().single();
console.log('invite token:', token, 'id:', inv.id, 'target:', inv.target_email);

const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: si } = await anon.auth.signInWithPassword({ email: userEmail, password });
console.log('signed in as:', si.user.email, 'id:', si.user.id);

const userClient = createClient(URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${si.session.access_token}` } }
});
const { data: rpc, error: rpc_e } = await userClient.rpc('kal31_accept_document_invite', { invite_token: token });
console.log('RPC result:', rpc, 'error:', rpc_e?.message);

const { data: col } = await admin.from('document_collaborators').select('*').eq('document_id', doc.id).eq('user_id', userId);
console.log('user collaborator rows:', col);

// cleanup
await admin.from('document_invites').delete().eq('id', inv.id);
await admin.from('document_collaborators').delete().eq('document_id', doc.id);
await admin.from('documents').delete().eq('id', doc.id);
await admin.from('user_subscriptions').delete().in('user_id', [ownerId, userId]);
await admin.auth.admin.deleteUser(ownerId);
await admin.auth.admin.deleteUser(userId);
console.log('cleanup done');
