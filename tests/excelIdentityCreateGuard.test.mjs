import test from 'node:test';
import { match, ok, equal } from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260820230000_kal309_create_identity_guard.sql',
);

function readMigration() {
  return fs.readFileSync(migrationPath, 'utf8');
}

function createBranch(sql) {
  const start = sql.indexOf("ELSIF v_op_type = 'create' THEN");
  const end = sql.indexOf("ELSE\n      -- legacy/unknown op_type", start);
  ok(start >= 0 && end > start, 'create branch must exist');
  return sql.slice(start, end);
}

const ALLOWED_FIXED = new Set(['changedBy', 'changedDate', 'item', 'entity', 'notes']);

function createFieldKeysAllowed(keys, { templateConfig = null, fields = {} } = {}) {
  for (const key of keys) {
    if (!ALLOWED_FIXED.has(key) && !key.startsWith('answer:') && !key.startsWith('answer.')) {
      return false;
    }
    if (!templateConfig) continue;
    if (key.startsWith('answer:') || key.startsWith('answer.')) {
      const checklistId = key.slice(7);
      const ids = [];
      for (const mod of templateConfig.modules || []) {
        for (const cat of mod.categories || []) {
          for (const item of cat.checklist || []) ids.push(item.id);
        }
      }
      if (!checklistId || !ids.includes(checklistId)) return false;
    } else if (key === 'entity') {
      const value = fields.entity;
      if (value) {
        const okEntity = (templateConfig.entities || []).some((e) => e.id === value || e.name === value);
        if (!okEntity) return false;
      }
    }
  }
  return true;
}

function resolveCreateIdentity({ incomingFingerprint, existing = [] }) {
  if (!incomingFingerprint) return { outcome: 'create', reuse: false };
  const hit = existing.find((row) => row.fingerprint === incomingFingerprint && row.scopeId === row.matchScope);
  if (!hit) return { outcome: 'create', reuse: false };
  if (hit.status === 'client_conflict_review') return { outcome: 'review', reuse: true };
  return { outcome: 'applied', reuse: true, markerId: hit.markerId };
}

test('P2-21 intended: create branch runs the apply whitelist on fields / changedFieldKeys', () => {
  const branch = createBranch(readMigration());
  match(branch, /changedFieldKeys/);
  match(branch, /v_key NOT IN \('changedBy','changedDate','item','entity','notes'\)/);
  match(branch, /v_key NOT LIKE 'answer:%'/);
  match(branch, /p_template_config IS NOT NULL/);
  match(branch, /v_outcome := 'review'/);
});

test('P2-21 intended: allowed create keys pass the JS contract', () => {
  const template = {
    modules: [{ categories: [{ checklist: [{ id: 'chk-1' }] }] }],
    entities: [{ id: 'ent-1', name: 'Room' }],
  };
  ok(createFieldKeysAllowed(['item', 'notes', 'answer:chk-1'], { templateConfig: template }));
  ok(createFieldKeysAllowed(['entity'], { templateConfig: template, fields: { entity: 'ent-1' } }));
});

test('P2-21 break: injected answer/entity keys that apply would reject also fail create', () => {
  const template = {
    modules: [{ categories: [{ checklist: [{ id: 'chk-1' }] }] }],
    entities: [{ id: 'ent-1' }],
  };
  equal(createFieldKeysAllowed(['secret'], { templateConfig: template }), false);
  equal(createFieldKeysAllowed(['answerKeys'], { templateConfig: template }), false);
  equal(createFieldKeysAllowed(['answer:missing'], { templateConfig: template }), false);
  equal(createFieldKeysAllowed(['entity'], { templateConfig: template, fields: { entity: 'not-in-template' } }), false);
});

test('P2-21 edge: missing template_config is structural-only; empty fields are ok', () => {
  ok(createFieldKeysAllowed(['item', 'answer:anything'], { templateConfig: null }));
  ok(createFieldKeysAllowed([], { templateConfig: { modules: [], entities: [] } }));
  const branch = createBranch(readMigration());
  match(branch, /v_changed_keys := '\[\]'::jsonb/);
});

test('P2-10 intended: create looks up a non-empty identity fingerprint before minting', () => {
  const branch = createBranch(readMigration());
  match(branch, /identity_vector_fingerprint = v_base_iv/);
  match(branch, /identityRecord,identityVectorFingerprint/);
  match(branch, /v_outcome := 'applied'/);
  match(branch, /FOR UPDATE/);
  const sql = readMigration();
  match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS excel_sync_state_identity_fingerprint_uidx/);
  match(sql, /identity_vector_fingerprint <> ''/);
});

test('P2-10 intended: matching fingerprint reuses the existing marker', () => {
  const result = resolveCreateIdentity({
    incomingFingerprint: 'fp-1',
    existing: [{ fingerprint: 'fp-1', matchScope: 's1', scopeId: 's1', markerId: 'm-1', status: 'accepted' }],
  });
  equal(result.outcome, 'applied');
  equal(result.reuse, true);
  equal(result.markerId, 'm-1');
});

test('P2-10 break: empty fingerprint never dedups — two creates still mint', () => {
  const result = resolveCreateIdentity({
    incomingFingerprint: '',
    existing: [{ fingerprint: '', matchScope: 's1', scopeId: 's1', markerId: 'm-1', status: 'accepted' }],
  });
  equal(result.outcome, 'create');
  equal(result.reuse, false);
  const branch = createBranch(readMigration());
  match(branch, /v_base_iv IS NOT NULL AND v_base_iv <> ''/);
});

test('P2-10 edge: same fingerprint on another scope does not collide', () => {
  const result = resolveCreateIdentity({
    incomingFingerprint: 'fp-1',
    existing: [{ fingerprint: 'fp-1', matchScope: 's1', scopeId: 's2', markerId: 'm-1', status: 'accepted' }],
  });
  equal(result.outcome, 'create');
  equal(result.reuse, false);
});

test('P2-10 edge: open client_conflict_review routes the duplicate create to review', () => {
  const result = resolveCreateIdentity({
    incomingFingerprint: 'fp-1',
    existing: [{ fingerprint: 'fp-1', matchScope: 's1', scopeId: 's1', markerId: 'm-1', status: 'client_conflict_review' }],
  });
  equal(result.outcome, 'review');
  const branch = createBranch(readMigration());
  match(branch, /materialization_status = 'client_conflict_review'/);
});
