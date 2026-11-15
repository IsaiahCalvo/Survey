// KAL-369 (Sharing): collaborator rows are written by the server. These pin
// the migration and the client wiring; the behaviour itself runs against the
// real local stack in tests/e2e-signed-in/collaborator-writes.spec.mjs and
// tests/phase28/rls/06_document_collaborators_rls.sql.
import test from 'node:test';
import { doesNotMatch, match, ok } from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const MIGRATION = read('supabase/migrations/20261116030000_collaborator_writes_server_side.sql');

function fn(name) {
  const start = MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  ok(start >= 0, `${name} missing`);
  return MIGRATION.slice(start, MIGRATION.indexOf('$$;', start));
}

test('no signed-in direct inserts, and only the role is updatable', () => {
  for (const table of ['document_collaborators', 'project_collaborators']) {
    match(MIGRATION, new RegExp(`REVOKE INSERT ON TABLE public\\.${table} FROM anon, authenticated;`));
    match(MIGRATION, new RegExp(`REVOKE UPDATE ON TABLE public\\.${table} FROM anon, authenticated;`));
    match(MIGRATION, new RegExp(`GRANT UPDATE \\(role\\) ON TABLE public\\.${table} TO authenticated;`));
  }
  match(MIGRATION, /DROP POLICY IF EXISTS "Document owners can add collaborators" ON public\.document_collaborators;/);
  match(MIGRATION, /DROP POLICY IF EXISTS "Project owners can add collaborators" ON public\.project_collaborators;/);
  doesNotMatch(MIGRATION, /CREATE POLICY[^;]*FOR INSERT/);
});

test('the owner-row triggers run as the server, with a fixed search path', () => {
  for (const name of ['add_project_owner_collaborator', 'add_document_owner_collaborator']) {
    const body = fn(name);
    match(body, /SECURITY DEFINER/);
    match(body, /SET search_path = ''/);
    match(MIGRATION, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(\\) FROM PUBLIC, anon, authenticated;`));
  }
});

test('grant_document_invite_to_account checks owner, open invite and plan before writing', () => {
  const body = fn('grant_document_invite_to_account');
  match(body, /SECURITY DEFINER/);
  match(body, /SET search_path = ''/);
  const order = [
    "user_can_access_document(v_invite.document_id, 'owner')",
    'v_invite.revoked_at IS NOT NULL',
    "get_user_tier(v_uid)::text = 'free'",
    'FROM auth.users u',
    "WHEN v_invite.role IN ('editor', 'owner') AND v_tier = 'free' THEN 'viewer'",
    'INSERT INTO public.document_collaborators',
  ].map((needle) => {
    const at = body.indexOf(needle);
    ok(at >= 0, `missing: ${needle}`);
    return at;
  });
  ok(order.every((at, i) => i === 0 || at > order[i - 1]), 'checks must come before the insert, in order');
  match(body, /is_guest_session\(\) OR public\.is_agent_session\(\)/);
  match(MIGRATION, /REVOKE ALL ON FUNCTION public\.grant_document_invite_to_account\(uuid\) FROM PUBLIC, anon;/);
  match(MIGRATION, /GRANT EXECUTE ON FUNCTION public\.grant_document_invite_to_account\(uuid\) TO authenticated;/);
});

test('the app grants email invites through the server and never writes collaborator rows', () => {
  const invite = read('src/services/documentInviteService.js');
  match(invite, /rpc\(\s*'grant_document_invite_to_account',\s*\{ p_invite_id: data\.id \}/);
  for (const file of [
    'src/services/documentInviteService.js',
    'src/services/documentAnnotationService.js',
    'src/services/projectInviteService.js',
    'src/projectAccess/ProjectSettings.jsx',
  ]) {
    const src = read(file);
    doesNotMatch(src, /from\('(document|project)_collaborators'\)\s*\.(insert|upsert)\(/, file);
    // Updates name the role and nothing else.
    for (const m of src.matchAll(/from\('(document|project)_collaborators'\)\s*\.update\(\{([^}]*)\}/g)) {
      match(m[2].trim(), /^role: [^,]+$/, `${file} updates more than the role: ${m[2]}`);
    }
  }
});
