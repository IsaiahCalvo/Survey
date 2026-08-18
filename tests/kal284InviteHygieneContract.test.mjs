/* DB hygiene bundle contract tests (source-assertion style):
 *   KAL-284 (c)+(d) — document_invites migration shape;
 *   KAL-285 — getOtherSurveysUsingTemplate is bounded;
 *   KAL-283 — deliberately SKIPPED: replica identity must stay FULL while the
 *     realtime DELETE consumer depends on full old-row payloads. This test
 *     pins the reasoning so a future flip has to consciously revisit it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('KAL-284(c): inviter deletion nulls attribution instead of destroying invite rows', () => {
  const sql = read('supabase/migrations/20260817030000_kal284_document_invites_hygiene.sql');

  assert.match(sql, /ALTER COLUMN created_by DROP NOT NULL/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS document_invites_created_by_fkey/);
  assert.match(sql, /FOREIGN KEY \(created_by\) REFERENCES auth\.users\(id\) ON DELETE SET NULL/);
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  assert.doesNotMatch(withoutComments, /created_by[\s\S]{0,120}ON DELETE CASCADE/);
});

test('KAL-284(d): pending-email uniqueness with pre-dedupe, re-invite flows preserved', () => {
  const sql = read('supabase/migrations/20260817030000_kal284_document_invites_hygiene.sql');

  // Dedupe must run before the index and keep the newest pending row.
  const dedupe = sql.indexOf('ROW_NUMBER() OVER');
  const index = sql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uniq_document_invites_pending_email');
  assert.ok(dedupe >= 0 && index > dedupe, 'dedupe must precede index creation');
  assert.match(sql, /ORDER BY created_at DESC, id DESC/);
  assert.match(sql, /SET revoked_at = now\(\)/);

  // The index scopes uniqueness to LIVE PENDING invites only — revoked and
  // accepted rows must stay out so revoke→re-invite and remove→re-invite work.
  assert.match(sql, /ON public\.document_invites \(document_id, target_email\)\s*\n\s*WHERE target_email IS NOT NULL\s*\n\s*AND revoked_at IS NULL\s*\n\s*AND accepted_at IS NULL/);
});

test('KAL-285: getOtherSurveysUsingTemplate is bounded to 100 rows', () => {
  const src = read('src/hooks/useDatabase.js');
  const start = src.indexOf('export async function getOtherSurveysUsingTemplate');
  const end = src.indexOf('\nexport ', start + 1);
  const body = src.slice(start, end === -1 ? src.length : end);

  assert.match(body, /\.eq\('template_id', templateId\)[\s\S]*?\.limit\(100\)/);
});

test('KAL-283 stays skipped: realtime DELETE consumer still needs full old-row payloads', () => {
  // The per-id DELETE fast path reads annotation_type (and the survey-marker
  // guard does too) from payload.old — columns no unique index carries. With
  // REPLICA IDENTITY USING INDEX every DELETE would degrade to the full
  // refetch fallback. Flip this only after the consumer stops depending on
  // non-key old-row columns.
  const consumer = read('src/services/annotationCloudSync.js');
  assert.match(consumer, /isSurveyMarkerType\(oldRow\.annotation_type\)/);
  assert.match(consumer, /!oldRow\.annotation_id \|\| !oldRow\.annotation_type/);

  const migrations = fs.readdirSync(path.join(repoRoot, 'supabase/migrations'));
  const flipped = migrations.filter((f) => {
    const sql = read(path.join('supabase/migrations', f));
    return /REPLICA IDENTITY USING INDEX/i.test(sql)
      && /document_annotations/.test(sql);
  });
  assert.deepEqual(flipped, [], 'no migration may flip document_annotations replica identity while the consumer reads non-key old-row columns');
});
