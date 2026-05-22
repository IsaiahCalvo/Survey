// Area 12 — Supabase / RLS / functions sanity.
// 1. user_can_access_document RPC returns boolean (not 42703 column error).
// 2. Probe access matrix: owner / collaborator / unauthorized.
// 3. Check no references to dropped `created_by` on documents.
import { admin, SUPABASE_URL, SUPABASE_ANON_KEY } from './admin-client.mjs';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

const users = JSON.parse(
  readFileSync(new URL('../logs/area-02-users.json', import.meta.url), 'utf8')
).users;
const PASSWORD = JSON.parse(
  readFileSync(new URL('../logs/area-02-users.json', import.meta.url), 'utf8')
).password;

const findings = {};

// --- 1. documents table column inventory ---
const sample = await admin.from('documents').select('*').limit(1);
findings.documents_columns_present = sample.data?.[0]
  ? Object.keys(sample.data[0])
  : (sample.error ? `err: ${sample.error.message}` : '(empty table)');

// --- 2. user_can_access_document RPC ---
// Sign in as a real user (developer = no rows yet) and probe the RPC against a known doc_id
// First create a doc owned by 'pro' user using service role
const pro = users.find((u) => u.role === 'pro');
const enterprise = users.find((u) => u.role === 'enterprise');
const free = users.find((u) => u.role === 'free');
const dev = users.find((u) => u.role === 'developer');

// Discover projects schema first
const projProbe = await admin.from('projects').select('*').limit(1);
findings.projects_columns_present = projProbe.data?.[0]
  ? Object.keys(projProbe.data[0])
  : (projProbe.error ? `err: ${projProbe.error.message}` : '(empty)');

// Create a project + document owned by pro (via service role bypassing RLS)
const projIns = await admin
  .from('projects')
  .insert({ name: 'audit-kal-54-proj-' + Date.now(), user_id: pro.userId })
  .select()
  .single();
findings.project_create = projIns.error ? { error: projIns.error.message } : { ok: true, id: projIns.data.id };

let docId = null;
if (projIns.data) {
  const docIns = await admin
    .from('documents')
    .insert({
      name: 'audit-kal-54-doc.pdf',
      project_id: projIns.data.id,
      user_id: pro.userId,
      file_size: 1024,
      file_path: `audit/kal-54/${Date.now()}/doc.pdf`
    })
    .select()
    .single();
  findings.document_create = docIns.error ? { error: docIns.error.message } : { ok: true, id: docIns.data.id };
  docId = docIns.data?.id;
}

async function probeAs(user, label) {
  const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const signIn = await c.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  if (signIn.error) return { label, signIn: signIn.error.message };
  // RPC: signature is (doc_id uuid, required_role text DEFAULT 'viewer')
  const rpc = await c.rpc('user_can_access_document', { doc_id: docId, required_role: 'viewer' });
  // SELECT
  const sel = await c.from('documents').select('id,name').eq('id', docId);
  await c.auth.signOut();
  return {
    label,
    rpc: rpc.error ? { error: rpc.error.message ?? String(rpc.error), code: rpc.error?.code } : { value: rpc.data },
    select: sel.error ? { error: sel.error.message, code: sel.error.code } : { rows: sel.data?.length ?? 0 }
  };
}

if (docId) {
  findings.access_matrix = {
    owner_pro: await probeAs(pro, 'owner_pro'),
    unauthorized_free: await probeAs(free, 'unauthorized_free'),
    unauthorized_enterprise: await probeAs(enterprise, 'unauthorized_enterprise')
  };

  // Add enterprise as collaborator
  const collabIns = await admin
    .from('document_collaborators')
    .insert({
      document_id: docId,
      user_id: enterprise.userId,
      role: 'viewer',
      invited_by: pro.userId
    })
    .select();
  findings.collaborator_invite = collabIns.error
    ? { error: collabIns.error.message, code: collabIns.error.code }
    : { ok: true, row: collabIns.data?.[0] };

  if (!collabIns.error) {
    findings.access_matrix.collaborator_enterprise = await probeAs(enterprise, 'collaborator_enterprise');
  }
}

// --- 3. RPC signature: does the function still mention created_by? ---
// Indirect probe — call RPC with a junk UUID and look for column error
const junk = '00000000-0000-0000-0000-000000000000';
const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
await c.auth.signInWithPassword({ email: pro.email, password: PASSWORD });
const junkRpc = await c.rpc('user_can_access_document', { doc_id: junk, required_role: 'viewer' });
await c.auth.signOut();
findings.rpc_with_junk_doc = junkRpc.error
  ? { error: junkRpc.error.message, code: junkRpc.error.code }
  : { value: junkRpc.data };

writeFileSync(
  new URL('../logs/area-12-supabase.json', import.meta.url),
  JSON.stringify({ docId, projectId: projIns.data?.id, findings }, null, 2)
);
console.log(JSON.stringify({ docId, projectId: projIns.data?.id, findings }, null, 2));
