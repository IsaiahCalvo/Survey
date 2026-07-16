import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(new URL('.', import.meta.url).pathname, '..');
const migrationDir = resolve(repoRoot, 'supabase/migrations');
const correctionName = '20260712010000_service_role_only_security_definers.sql';
const correctionPath = resolve(migrationDir, correctionName);
const advisorPath = resolve(migrationDir, '20260702010000_security_advisor_hardening.sql');

const serviceOnlyFunctions = [
  'public.archive_excess_documents(uuid, integer)',
  'public.archive_excess_projects(uuid, integer)',
  'public.archive_excess_projects(uuid, uuid)',
  'public.check_collaborator_by_email(text)',
  'public.check_user_collaborator_eligibility(uuid)',
  'public.get_user_id_by_email(text)',
  'public.handle_downgrade_to_free(uuid)',
  'public.kal309_persist_created_token(uuid, text, text, text, text, text)',
  'public.recalculate_all_user_storage()',
  'public.recalculate_user_storage(uuid)',
  'public.record_usage_metric(uuid, character varying, bigint, jsonb)',
  'public.sweep_annotation_trash_events(integer)',
];

const normalizeSql = (sql) => sql
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

test('service-only SECURITY DEFINER RPCs stay unavailable to client roles', () => {
  assert.ok(
    existsSync(correctionPath),
    `${correctionName} must revoke the authenticated grants added by the advisor migration`,
  );

  const sql = normalizeSql(readFileSync(correctionPath, 'utf8'));

  for (const signature of serviceOnlyFunctions) {
    assert.ok(
      sql.includes(`revoke all on function ${signature} from public, anon, authenticated;`),
      `${signature} must revoke PUBLIC, anon, and authenticated`,
    );
    assert.ok(
      sql.includes(`grant execute on function ${signature} to service_role;`),
      `${signature} must remain callable by service_role`,
    );
  }

  const migrationNames = readdirSync(migrationDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const correctionIndex = migrationNames.indexOf(correctionName);
  const laterSql = normalizeSql(
    migrationNames
      .slice(correctionIndex + 1)
      .map((name) => readFileSync(resolve(migrationDir, name), 'utf8'))
      .join('\n'),
  );

  for (const signature of serviceOnlyFunctions) {
    assert.ok(
      !laterSql.includes(`grant execute on function ${signature} to authenticated`),
      `${signature} must not be re-granted to authenticated by a later migration`,
    );
  }
});

test('advisor hardening targets the deployed kal309 function signature', () => {
  const sql = normalizeSql(readFileSync(advisorPath, 'utf8'));
  const signature = 'public.kal309_persist_created_token(p_document_id uuid, p_template_id text, p_scope_id text, p_marker_annotation_id text, p_client_change_set_id text, p_assigned_token text)';
  assert.ok(sql.includes(`revoke all on function ${signature} from public;`));
  assert.ok(sql.includes(`grant execute on function ${signature} to authenticated, service_role;`));
});
