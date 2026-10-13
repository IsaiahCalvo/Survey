// Survey media storage: the proposed bucket migration (static), the survey
// marker localStorage cache's quota fallback, and the cloud row's note source.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { SURVEY_MEDIA_ALLOWED_MIME_TYPES, SURVEY_MEDIA_BUCKET } from '../src/services/surveyMediaService.js';
import { saveSurveyMarkers } from '../src/viewerShared.js';
import { buildSurveyMarkerRow } from '../src/services/documentSurveyMarkerMapper.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const MIGRATION = read('../supabase/proposed/20261001_survey_media_bucket.sql');
const ROLLBACK = read('../supabase/rollbacks/20261001_survey_media_bucket.down.sql');
// SQL without comments, so assertions match statements, not the header prose.
const sqlOnly = (text) => text.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n');
const SQL = sqlOnly(MIGRATION);
const policy = (name) => {
  const match = new RegExp(`CREATE POLICY ${name} ON storage\\.objects([\\s\\S]*?);`).exec(SQL);
  assert.ok(match, `policy ${name} exists`);
  return match[1];
};

describe('proposed survey-media migration (static)', () => {
  // Codex review 2026-10-13: the versioned migration (the version prod
  // recorded when this was applied by hand on 2026-10-01) used to be a no-op
  // placeholder, so databases that replay migrations had no bucket. It now
  // carries the proposal's statements; prod skips it (version recorded).
  const VERSIONED = read('../supabase/migrations/20261001131413_survey_media_bucket_20261001.sql');
  const VERSIONED_SQL = sqlOnly(VERSIONED);
  const statementsFromBegin = (sql) => sql.slice(sql.search(/^BEGIN;/m)).replace(/[ \t]+$/gm, '').trim();

  it('the proposal records it was applied by hand; only the versioned copy lives in migrations/', () => {
    assert.match(MIGRATION, /^-- APPLIED to prod 2026-10-01/);
    assert.match(MIGRATION, /VERIFY AFTER APPLYING/);
    // The un-versioned proposal name would be an invalid migration file.
    assert.equal(existsSync(new URL('../supabase/migrations/20261001_survey_media_bucket.sql', import.meta.url)), false);
  });

  it('the versioned migration runs the same schema SQL as the proposal (not a placeholder)', () => {
    assert.doesNotMatch(VERSIONED_SQL, /^\s*SELECT 1;\s*$/m);
    assert.equal(statementsFromBegin(VERSIONED_SQL), statementsFromBegin(SQL));
    assert.match(VERSIONED_SQL, /^\s*BEGIN;/m);
    assert.match(VERSIONED_SQL, /^\s*COMMIT;\s*$/m);
  });

  it('the versioned migration is idempotent (safe on a database that already has it)', () => {
    const body = VERSIONED_SQL;
    // Every policy is dropped (IF EXISTS) right before it is created.
    const created = [...body.matchAll(/CREATE POLICY (\w+) ON storage\.objects/g)].map((m) => m[1]);
    assert.equal(created.length, 3);
    for (const name of created) {
      const drop = body.indexOf(`DROP POLICY IF EXISTS ${name} ON storage.objects;`);
      assert.ok(drop >= 0 && drop < body.indexOf(`CREATE POLICY ${name} ON storage.objects`), name);
    }
    // Functions are only ever CREATE OR REPLACE; the bucket insert upserts.
    assert.doesNotMatch(body, /CREATE\s+FUNCTION/i);
    assert.match(body, /INSERT INTO storage\.buckets[\s\S]*?ON CONFLICT \(id\) DO UPDATE/);
    assert.equal((body.match(/INSERT INTO/gi) || []).length, 1);
    // Nothing that fails the second time round.
    assert.doesNotMatch(body, /CREATE\s+(TABLE|INDEX|UNIQUE INDEX|TRIGGER|TYPE|SCHEMA|ROLE|EXTENSION)\b(?!\s+IF NOT EXISTS)/i);
    assert.doesNotMatch(body, /\bDROP\s+(?!POLICY IF EXISTS)\w+/i);
    assert.doesNotMatch(body, /ALTER\s+TABLE/i);
  });

  it('creates a private 50 MiB bucket with exactly the app MIME list', () => {
    assert.equal(SURVEY_MEDIA_BUCKET, 'survey-media');
    const bucket = /INSERT INTO storage\.buckets[\s\S]*?VALUES \(([\s\S]*?)\)\s*ON CONFLICT/.exec(SQL);
    assert.ok(bucket);
    assert.match(bucket[1], /'survey-media',\s*'survey-media',\s*false,\s*52428800/);
    const mimes = [...bucket[1].matchAll(/'([a-z]+\/[a-z0-9.+-]+)'/g)].map((m) => m[1]);
    assert.deepEqual(mimes.sort(), [...SURVEY_MEDIA_ALLOWED_MIME_TYPES].sort());
    assert.match(SQL, /ON CONFLICT \(id\) DO UPDATE\s+SET public = false/);
  });

  it('reads need viewer access (or being the uploader)', () => {
    const body = policy('survey_media_read');
    assert.match(body, /FOR SELECT TO authenticated/);
    assert.match(body, /bucket_id = 'survey-media'/);
    assert.match(body, /user_can_access_document\(public\.survey_media_object_document_id\(name\), 'viewer'\)/);
    assert.match(body, /owner_id = \(SELECT auth\.uid\(\)\)::text/);
  });

  it('inserts need editor access plus the quota check charged to the uploader', () => {
    const body = policy('survey_media_insert');
    assert.match(body, /FOR INSERT TO authenticated/);
    assert.match(body, /survey_media_object_document_id\(name\) IS NOT NULL/);
    assert.match(body, /user_can_access_document\(public\.survey_media_object_document_id\(name\), 'editor'\)/);
    assert.match(body, /get_actual_storage_usage\(\(SELECT auth\.uid\(\)\)\)/);
    assert.match(body, /<= public\.get_storage_limit\(\(SELECT auth\.uid\(\)\)\)/);
  });

  it('deletes are for the uploader or the document owner; no UPDATE policy', () => {
    const body = policy('survey_media_delete');
    assert.match(body, /FOR DELETE TO authenticated/);
    assert.match(body, /owner_id = \(SELECT auth\.uid\(\)\)::text/);
    assert.match(body, /user_can_access_document\(public\.survey_media_object_document_id\(name\), 'owner'\)/);
    assert.doesNotMatch(SQL, /CREATE POLICY survey_media_\w+ ON storage\.objects\s+FOR UPDATE/);
    assert.equal((SQL.match(/CREATE POLICY survey_media_/g) || []).length, 3);
  });

  it('uses only the role names user_can_access_document accepts', () => {
    const latest = read('../supabase/migrations/20260802000000_kal426_user_archive_foundation.sql');
    for (const role of ['viewer', 'editor', 'owner']) assert.match(latest, new RegExp(`WHEN '${role}'\\s+THEN`));
    const used = [...SQL.matchAll(/user_can_access_document\([^)]*\)[^,]*,\s*'(\w+)'\)/g)].map((m) => m[1]);
    assert.ok(used.length >= 3);
    for (const role of used) assert.ok(['viewer', 'editor', 'owner'].includes(role), role);
  });

  it('pins the object name shape <document uuid>/<marker>/<media uuid>.<ext>', () => {
    assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.survey_media_object_document_id\(object_name text\)/);
    assert.match(SQL, /\[0-9a-fA-F\]\{8\}-[^']*\/\[A-Za-z0-9_-\]\{1,128\}\/[^']*\\\.\[a-z0-9\]\{2,5\}\$'/);
  });

  it('counts the uploader\'s survey media in get_actual_storage_usage and the byte-gate trigger', () => {
    const usage = /CREATE OR REPLACE FUNCTION public\.get_actual_storage_usage\(p_user_id UUID\)([\s\S]*?)\$\$;/.exec(SQL)[1];
    assert.match(usage, /SECURITY DEFINER/);
    assert.match(usage, /o\.bucket_id = 'documents'\s+AND o\.name LIKE COALESCE\(auth\.uid\(\), p_user_id\)::text \|\| '\/%'/);
    assert.match(usage, /o\.bucket_id = 'survey-media'\s+AND o\.owner_id = COALESCE\(auth\.uid\(\), p_user_id\)::text/);
    const trigger = /CREATE OR REPLACE FUNCTION public\.enforce_documents_storage_quota\(\)([\s\S]*?)\$\$;/.exec(SQL)[1];
    assert.match(trigger, /ELSIF NEW\.bucket_id = 'survey-media' THEN[\s\S]*?v_owner := NULLIF\(NEW\.owner_id, ''\)::uuid/);
    assert.match(trigger, /IF v_new_size <= v_old_size THEN\s+RETURN NEW;/);
    assert.match(trigger, /hashtextextended\('kal390:' \|\| v_owner::text, 0\)/);
    assert.match(trigger, /RAISE EXCEPTION\s+'Storage quota exceeded/);
  });

  it('exposes orphaned media to the service role only', () => {
    assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.list_orphaned_survey_media\(p_limit integer DEFAULT 500\)/);
    assert.match(SQL, /REVOKE ALL ON FUNCTION public\.list_orphaned_survey_media\(integer\) FROM PUBLIC, anon, authenticated;/);
    assert.match(SQL, /GRANT EXECUTE ON FUNCTION public\.list_orphaned_survey_media\(integer\) TO service_role;/);
  });

  it('runs in one transaction and has a rollback that restores the documents-only functions', () => {
    assert.match(SQL, /^\s*BEGIN;/m);
    assert.match(SQL, /^\s*COMMIT;\s*$/m);
    const back = sqlOnly(ROLLBACK);
    for (const name of ['survey_media_read', 'survey_media_insert', 'survey_media_delete']) {
      assert.match(back, new RegExp(`DROP POLICY IF EXISTS ${name}\\s+ON storage\\.objects;`));
    }
    assert.match(back, /DROP FUNCTION IF EXISTS public\.list_orphaned_survey_media\(integer\);/);
    assert.match(back, /DROP FUNCTION IF EXISTS public\.survey_media_object_document_id\(text\);/);
    assert.doesNotMatch(back, /survey-media/, 'restored functions are documents-only');
    assert.match(back, /IF NEW\.bucket_id IS DISTINCT FROM 'documents' THEN/);
  });
});

describe('saveSurveyMarkers localStorage quota fallback', () => {
  const realStorage = globalThis.localStorage;
  const realWarn = console.warn;
  afterEach(() => {
    globalThis.localStorage = realStorage;
    console.warn = realWarn;
  });

  const quotaStorage = (limit) => {
    const store = new Map();
    return {
      store,
      setItem(key, value) {
        if (String(value).length > limit) {
          const err = new Error('The quota has been exceeded.');
          err.name = 'QuotaExceededError';
          throw err;
        }
        store.set(key, String(value));
      },
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      removeItem: (key) => store.delete(key),
    };
  };
  const big = (n) => `data:image/jpeg;base64,${'A'.repeat(n)}`;

  it('keeps caching every marker by dropping the largest inline media first, and warns once', () => {
    const storage = quotaStorage(20_000);
    globalThis.localStorage = storage;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    const markers = {
      m1: { annotationId: 'm1', name: 'Door', note: { text: 'one', photos: [{ name: 'huge.jpg', dataUrl: big(15_000) }, { name: 'small.jpg', dataUrl: big(500) }] } },
      m2: { annotationId: 'm2', name: 'Wall', note: { text: 'two', videos: [{ name: 'clip.mp4', dataUrl: big(9_000) }] } },
      m3: { annotationId: 'm3', name: 'Ceiling', checklistResponses: { a: { selection: 'Y' } } },
    };
    assert.equal(saveSurveyMarkers('doc-a', markers), true);
    const cached = JSON.parse(storage.getItem('surveyMarkers_doc-a'));
    assert.deepEqual(Object.keys(cached), ['m1', 'm2', 'm3']);
    assert.equal(cached.m1.note.text, 'one');
    assert.deepEqual(cached.m1.note.photos[0], { name: 'huge.jpg', dataUrl: null, cacheOmitted: true });
    assert.equal(cached.m1.note.photos[1].dataUrl, big(500), 'smaller media still cached');
    assert.equal(cached.m2.note.videos[0].dataUrl, big(9_000));
    assert.deepEqual(cached.m3.checklistResponses, { a: { selection: 'Y' } });
    assert.ok(markers.m1.note.photos[0].dataUrl, 'in-memory markers are not modified');
    assert.equal(warnings.length, 1);
    // Another oversize save of the same document does not warn again.
    assert.equal(saveSurveyMarkers('doc-a', { ...markers, m4: { annotationId: 'm4' } }), true);
    assert.equal(warnings.length, 1);
    assert.ok(JSON.parse(storage.getItem('surveyMarkers_doc-a')).m4);
  });

  it('saves normally when it fits, and keeps the previous snapshot when nothing fits', () => {
    const storage = quotaStorage(200);
    globalThis.localStorage = storage;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    assert.equal(saveSurveyMarkers('doc-b', { m1: { name: 'x' } }), true);
    assert.equal(warnings.length, 0);
    const before = storage.getItem('surveyMarkers_doc-b');
    const huge = { m1: { name: 'x'.repeat(500), note: { photos: [{ name: 'p', dataUrl: big(50) }] } } };
    assert.equal(saveSurveyMarkers('doc-b', huge), false);
    assert.equal(storage.getItem('surveyMarkers_doc-b'), before);
    assert.equal(warnings.length, 1);
  });
});

describe('survey marker cloud row note source', () => {
  it('writes the edited `note`, not the stale `notes` copy the row was read with', () => {
    const row = buildSurveyMarkerRow({
      documentId: 'doc-1',
      userId: 'user-1',
      annotationId: 'm1',
      annotation: {
        notes: { text: 'old', photos: [{ name: 'p', dataUrl: 'data:image/png;base64,AAAA' }] },
        note: { text: 'new', media: [{ id: 'r1', kind: 'photo', path: 'd/m/r1.jpg' }] },
      },
    });
    assert.equal(row.notes.text, 'new');
    assert.doesNotMatch(JSON.stringify(row.notes), /base64/);
    const legacyOnly = buildSurveyMarkerRow({ documentId: 'd', userId: 'u', annotationId: 'm', annotation: { notes: { text: 'kept' } } });
    assert.equal(legacyOnly.notes.text, 'kept');
  });
});
