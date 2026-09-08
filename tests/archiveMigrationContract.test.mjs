// KAL-426/427/428/429 — locks the database contract the Archive feature stands on.
// Follows the repo's established pattern for SQL and Supabase-touching services
// (see tests/kal31InviteContract.test.mjs): the migration and the service
// sources are read as text and asserted against, because importing a service
// would pull in import.meta.env.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const MIGRATION = read('../supabase/migrations/20260802000000_kal426_user_archive_foundation.sql');
const PLAN_MIGRATION = read('../supabase/migrations/20241226000002_add_archived_columns.sql');
const DOC_SERVICE = read('../src/services/documentArchiveService.js');
const PROJECT_SERVICE = read('../src/services/projectArchiveService.js');
const TEMPLATE_SERVICE = read('../src/services/templateArchiveService.js');
const ARCHIVE_SERVICE = read('../src/services/archiveService.js');

test('KAL-426: the user Archive gets its own columns on all three tables', () => {
  for (const table of ['documents', 'projects', 'templates']) {
    const alter = new RegExp(`ALTER TABLE public\\.${table}[\\s\\S]*?;`, 'm');
    const block = MIGRATION.match(alter)?.[0] || '';
    for (const column of [
      'user_archived_at',
      'user_archive_expires_at',
      'user_archived_by',
      'archive_group_id',
    ]) {
      assert.match(block, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`), `${table}.${column}`);
    }
  }
});

test('KAL-426: the plan-limit archived flag is never reused or rewritten', () => {
  // 20241226000002 added `archived` for Free-tier downgrades. Those rows must
  // never enter the Archive nor be purged after 30 days, so nothing in the new
  // migration may read or write that column.
  assert.match(PLAN_MIGRATION, /archive_excess_documents/);
  const archivedWrites = MIGRATION.match(/^\s*(SET|,)?\s*archived\s*=/gm) || [];
  assert.equal(archivedWrites.length, 0, 'the new migration must not write documents.archived');
  assert.doesNotMatch(MIGRATION, /WHERE[^;]*\barchived\b\s*=\s*(TRUE|FALSE)/i);
});

test('KAL-426: retention is exactly 30 days from one source of truth', () => {
  assert.match(MIGRATION, /CREATE OR REPLACE FUNCTION public\.archive_retention_interval\(\)/);
  assert.match(MIGRATION, /SELECT INTERVAL '30 days'/);
  // Every archive path derives the expiry from that function, never a literal.
  const expiryWrites = MIGRATION.match(/user_archive_expires_at = [^,\n]+/g) || [];
  const derived = expiryWrites.filter((line) => /archive_retention_interval\(\)/.test(line));
  assert.equal(derived.length + expiryWrites.filter((l) => /NULL/.test(l)).length, expiryWrites.length);
  assert.ok(derived.length >= 3, 'documents, projects and templates all derive the expiry');
});

test('KAL-426: archived items resolve for the permanent owner only', () => {
  // The access helpers are the enforcement point: a collaborator — including one
  // whose ROLE is 'owner' — must stop resolving the moment the row is archived.
  for (const fn of ['user_can_access_document', 'user_can_access_project', 'user_can_access_template']) {
    const body = MIGRATION.match(new RegExp(`FUNCTION public\\.${fn}[\\s\\S]*?\\n\\$\\$;`))?.[0] || '';
    assert.ok(body, `${fn} is redefined`);
    assert.match(body, /user_archived_at/, `${fn} reads the archive flag`);
    assert.match(
      body,
      /IF\s+\w*archived_at\s+IS NOT NULL THEN\s*\n\s*RETURN\s+\w*owner_id = auth\.uid\(\);/,
      `${fn} short-circuits to the permanent owner while archived`,
    );
    assert.match(body, /SECURITY DEFINER/);
    assert.match(body, /SET search_path = ''/);
  }

  const role = MIGRATION.match(/FUNCTION public\.get_my_document_role[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.match(role, /IF doc_archived_at IS NOT NULL THEN[\s\S]*?ELSE NULL END;/);
});

test('KAL-426: the role ladder for live items is unchanged', () => {
  const body = MIGRATION.match(/FUNCTION public\.user_can_access_document[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.match(body, /WHEN 'viewer' THEN user_role IN \('viewer', 'editor', 'owner'\)/);
  assert.match(body, /WHEN 'editor' THEN user_role IN \('editor', 'owner'\)/);
  assert.match(body, /WHEN 'owner'\s+THEN user_role = 'owner'/);
  // The project-collaborator and project-owner fallbacks still apply to live docs.
  assert.match(body, /FROM public\.project_collaborators/);
  assert.match(body, /status = 'active'/);
});

test('KAL-427/428/429: every operation is owner-enforced in the database', () => {
  const operations = [
    'archive_document', 'restore_document',
    'archive_project', 'restore_project',
    'archive_template', 'restore_template',
    'purge_archived_document', 'purge_archived_project', 'purge_archived_template',
  ];
  for (const fn of operations) {
    const body = MIGRATION.match(new RegExp(`FUNCTION public\\.${fn}\\(-?[\\s\\S]*?\\n\\$\\$;`))?.[0] || '';
    assert.ok(body, `${fn} exists`);
    assert.match(body, /SECURITY DEFINER/, `${fn} runs as definer`);
    assert.match(body, /SET search_path = ''/, `${fn} pins search_path`);
    assert.match(body, /<> auth\.uid\(\)[\s\S]*?'not_owner'/, `${fn} refuses a non-owner`);
    assert.match(body, /FOR UPDATE/, `${fn} locks the row so retries cannot race`);
    assert.match(MIGRATION, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(UUID\\) TO authenticated`));
  }
});

test('KAL-427/428/429: repeated requests are safe', () => {
  // Archive/restore report `already` instead of re-stamping a new expiry or
  // silently flipping the row back; purge reports success when the row is gone.
  for (const fn of ['archive_document', 'archive_project', 'archive_template',
    'restore_document', 'restore_project', 'restore_template']) {
    const body = MIGRATION.match(new RegExp(`FUNCTION public\\.${fn}\\(-?[\\s\\S]*?\\n\\$\\$;`))?.[0] || '';
    assert.match(body, /'already', true/, `${fn} is idempotent`);
  }
  for (const fn of ['purge_archived_document', 'purge_archived_project', 'purge_archived_template']) {
    const body = MIGRATION.match(new RegExp(`FUNCTION public\\.${fn}\\(-?[\\s\\S]*?\\n\\$\\$;`))?.[0] || '';
    assert.match(body, /IF v_owner IS NULL THEN\s*\n\s*RETURN jsonb_build_object\('ok', true, 'already', true/);
    assert.match(body, /'not_archived'/, `${fn} refuses to touch a live item`);
  }
});

test('KAL-428: restore returns a document to the project it came from', () => {
  const body = MIGRATION.match(/FUNCTION public\.restore_document[\s\S]*?\n\$\$;/)?.[0] || '';
  // project_id is never written by archive or restore — that is the mechanism.
  assert.doesNotMatch(body, /SET[\s\S]*?project_id\s*=/);
  assert.match(body, /'project_id', v_project/);
  // A project child cannot be restored on its own.
  assert.match(body, /IF v_group IS NOT NULL THEN[\s\S]*?'project_child'/);
  const archiveBody = MIGRATION.match(/FUNCTION public\.archive_document[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.doesNotMatch(archiveBody, /SET[\s\S]*?project_id\s*=/);
});

test('KAL-429: project archive is all-or-nothing and adopts loose documents', () => {
  const body = MIGRATION.match(/FUNCTION public\.archive_project[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.match(body, /v_group := gen_random_uuid\(\)/, 'one group id per project archive');
  assert.match(body, /UPDATE public\.projects[\s\S]*?UPDATE public\.documents/, 'both writes in one function body');
  // The document sweep is unconditional on the child's own archive state, which
  // is what pulls an independently archived document into the project group and
  // resets it onto the project's fresh expiry.
  assert.match(body, /UPDATE public\.documents[\s\S]*?WHERE project_id = p_project_id\s*\n\s*AND user_id = v_owner;/);
  assert.doesNotMatch(body, /WHERE project_id = p_project_id[\s\S]*?user_archived_at IS NULL/);

  const restore = MIGRATION.match(/FUNCTION public\.restore_project[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.match(restore, /UPDATE public\.documents[\s\S]*?WHERE archive_group_id = v_group;/);
  assert.match(restore, /UPDATE public\.projects/);
});

test('KAL-428/429: a shared stored PDF is never removed while in use', () => {
  const doc = MIGRATION.match(/FUNCTION public\.purge_archived_document[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.match(
    doc,
    /NOT EXISTS \(\s*\n\s*SELECT 1 FROM public\.documents WHERE file_path = v_file_path\s*\n\s*\)/,
    'only an unreferenced path is reported as orphaned',
  );
  const project = MIGRATION.match(/FUNCTION public\.purge_archived_project[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.match(project, /WHERE NOT EXISTS \(SELECT 1 FROM public\.documents WHERE file_path = p\)/);
  // The purge receipt is only a candidate list. A fresh retirement transaction
  // must authorize deletion; stale reference checks must not bypass that guard.
  for (const source of [DOC_SERVICE, PROJECT_SERVICE]) {
    assert.match(source, /orphaned_paths[\s\S]*?cleanupDocumentStorage\(supabase, orphanedPaths\)/);
    assert.doesNotMatch(source, /\.remove\(/);
  }
});

test('KAL-428: permanent delete also clears the local durable copy', () => {
  assert.match(DOC_SERVICE, /import \{ purgeAnnotationDoc \} from '\.\/annotationDocSync'/);
  assert.match(DOC_SERVICE, /await purgeAnnotationDoc\(documentId\)/);
  assert.match(PROJECT_SERVICE, /await purgeAnnotationDoc\(childId\)/);
});

test('services call the owner-enforced RPCs, never a bare table write', () => {
  const pairs = [
    [DOC_SERVICE, ['archive_document', 'restore_document', 'purge_archived_document']],
    [PROJECT_SERVICE, ['archive_project', 'restore_project', 'purge_archived_project']],
    [TEMPLATE_SERVICE, ['archive_template', 'restore_template', 'purge_archived_template']],
  ];
  for (const [source, rpcs] of pairs) {
    for (const rpc of rpcs) assert.match(source, new RegExp(`'${rpc}'`));
    // No client-side UPDATE or DELETE of the archive columns anywhere.
    assert.doesNotMatch(source, /\.update\(\s*\{[\s\S]*?user_archived_at/);
    assert.doesNotMatch(source, /\.delete\(\)/);
  }
});

test('the Archive read path is owner-scoped and archive-only', () => {
  for (const source of [DOC_SERVICE, PROJECT_SERVICE, TEMPLATE_SERVICE, ARCHIVE_SERVICE]) {
    assert.match(source, /\.eq\('user_id', userId\)/);
    assert.match(source, /\.not\('user_archived_at', 'is', null\)/);
  }
});

test('bulk actions fan out per item so partial failure can be named', () => {
  assert.match(ARCHIVE_SERVICE, /runArchiveBulk\(items, RESTORE_BY_TYPE, 'restored'\)/);
  assert.match(ARCHIVE_SERVICE, /runArchiveBulk\(items, DELETE_BY_TYPE, 'deleted'\)/);
  const bulk = read('../src/services/archiveBulk.js');
  assert.match(bulk, /succeeded\.push\(item\)/);
  assert.match(bulk, /failed\.push\(\{ item, error/);
  assert.doesNotMatch(bulk, /import .* from '\.\.\/supabaseClient'/, 'stays pure so it is testable');
});
