# PLAN KAL-309 — concrete, file-level implementation of the KAL-308 keystone

_Turns the Codex-APPROVED design in `PLAN-KAL308.md` into a buildable spec.
KAL-308a shipped (`20260624120000_kal308a_rowid_signing_secrets.sql`,
server-held signing secret + `kal308a_get_or_create_signing_secret` /
`kal308a_get_signing_secret` / `kal308a_has_server_key`). This plan is the
"how", section-by-section: (A) migration, (B) apply RPC, (C) Edge Function,
(D) client cutover, (E) the riskiest decisions to flag to Codex before coding.
Drafted 2026-06-24; body rewritten 2026-06-24 (round-1 integration) so every
section matches the "Critique resolutions" below. Ground-truth verified against
live source — see "Verified anchors" at the end._

> **Build step 0 (still mandatory, unchanged from KAL-308 Decision 0).** Before
> any of A–D, pin by live browser trace that the open client hydrates markers
> from the `annotationDocSync` Y.Doc (`getSurveyMarkers/applySurveyMarkers` at
> `annotationDocSync.js:360,363`; map `surveyMarkers` at `annotationDocStore.js:71`).
> The client materialize target (D) and the `excelSyncFrontier` cursor location both
> depend on it. The server never writes Yjs.

---

## Critique resolutions (adversarial pass + Codex round-1, 2026-06-24 — these are AUTHORITATIVE; the body below has been rewritten to match them)

**F0 — DISMISSED (false alarm).** KAL-308a IS landed + live-verified (`20260624120000`,
6/6 survey-test integration). The critic read a stale worktree; the intro (lines 4–6) is
correct. The Edge token-verify path via `kal308a_get_signing_secret` + frozen
`signing_doc_id` is real.

**F1 — the three `excel_sync_*` tables FK to `documents(id) ON DELETE CASCADE`, NOT to
the registration row.** KAL-307 revokes + inserts a NEW-generation registration row on
every re-export, so FKing the registration `id` pins state to a revoked generation.
Carry `template_id`, `scope_id`, `workbook_generation` as plain columns; resolve the
active registration by `(document_id, template_id) WHERE revoked_at IS NULL` at apply time.

**F2 — `excel_revision` lives on a dedicated per-mirror head table keyed by stable mirror
identity, NOT on the registration.** New `excel_sync_head (document_id UUID, template_id
TEXT, excel_revision BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (document_id, template_id))` —
survives re-export (keyed by the stable `(document_id, template_id)` mirror, not the
swappable generation). The apply RPC locks this row `FOR UPDATE` + increments it in the
SAME txn as the op inserts. **Remove `excel_revision` from `excel_workbook_registrations`.**

**F3 + F8 — `marker_annotation_id NOT NULL`; create-ids minted server-side ONCE and
persisted.** For `create` ops the RPC mints `marker_annotation_id := gen_random_uuid()`
BEFORE insert and writes it into `excel_sync_ops.patch_payload` + `excel_sync_state` + the
stored changeset outcomes — so it's never NULL and never regenerated. "Atomic create id" =
minted on FIRST apply then frozen; retries reuse the persisted id (F7). No twin-marker bug.

**F4 — `excel_sync_audit` immutability is TRIGGER-enforced, not RLS/REVOKE.** A SECURITY
DEFINER RPC runs as table owner and bypasses RLS AND privileges. Add a `BEFORE UPDATE OR
DELETE` trigger that `RAISE EXCEPTION`s — structurally immutable even against the owner.
(REVOKE UPDATE/DELETE from PUBLIC too, as defense-in-depth.) Concrete DDL in A.4.

**F5 — revision bump + op insert + head bump are ONE atomic step.** After locking
`excel_sync_head FOR UPDATE`, compute each op's `excel_revision` from the locked value,
INSERT ops, UPSERT state, and bump the head in the SAME transaction. A visible head
revision therefore always has its ops committed (this also closes F12). Never a separate
post-insert UPDATE on a different table.

**F6 — the server validates the EXCEL side ONLY; the client owns the app-vs-Excel merge.**
Drop any claim the RPC re-validates "app now" — marker values live in Yjs, not a server
table. The RPC validates actor role (against `p_actor_id`) + registration/token + Excel-side
base fingerprint (client-sent vs stored `excel_sync_state`) = Excel-vs-Excel drift.
App-vs-Excel field conflict is the client materialize reducer's job (two-tier model,
PLAN-KAL308 Decision 16). State this trust boundary plainly.

**F7 — retries are pure replays; revision never re-derived on retry; stored outcomes
returned verbatim.** Idempotency is keyed by `(document_id, template_id,
client_change_set_id)` in `excel_sync_changesets`. A replay inserts nothing new and returns
the STORED `outcomes` + `writeback_jobs` jsonb verbatim — ALL per-row outcomes (applied /
create / conflict / review / stale / unauthorized / locked), not just accepted ops.
`excel_revision` is assigned only on the first (non-conflicting) apply.

**F8 — ops carry a globally-unique op UUID; the client cursor is a single contiguous
frontier (refined by R2#2).** `excel_sync_ops` carries an `op_uuid UUID NOT NULL DEFAULT
gen_random_uuid()` with a GLOBAL `UNIQUE` constraint (the durable cross-client op identity;
the human-supplied `op_id` TEXT stays as the per-change-set idempotency key). The client
cursor is the single persisted `excelSyncFrontier:${templateId}` (R2#2) — it advances only
over CONTIGUOUS fully-handled ops and HALTS at any op still in `client_conflict_review`
(recorded durably in `excelSyncReview:${templateId}`), never skipping it.

**F9 — client materialize is READ-MERGE-WRITE per SINGLE marker under a per-marker
in-memory lock, NOT a full-map `applySurveyMarkers`.** Per accepted op: acquire a
per-marker in-memory lock (client), RE-READ the current marker from Yjs, overlay ONLY the
op's `changedFieldKeys` onto a copy, write THAT single marker; if the marker changed between
read and write, retry under the lock. Never call `applySurveyMarkers` with a full merged
map. Residual risk: a concurrent edit that lands inside the lock-free Yjs write itself is
still possible (the lock is advisory in-process only) — accepted for V1; the
conflict-review + reconcile backstop covers it; true field-level CRDT is the op-log rebuild
(KAL-263/270). FLAG to Codex.

**F10 — deletes stay REVIEW-ONLY (PLAN-KAL308 Decision 10); the materialize never
auto-deletes.** So `origin:'excel-import'` suppressing deletes is CORRECT, not a bug.
`candidateDeletes` route to the existing review surface; the materialize applies only
apply/create ops. Drop any "candidate-delete trashing to materialize" in D.3.

**F11 — `fetchSince(sinceRevision)` keyed off the STABLE head (F2); cursor = the single
`excelSyncFrontier` (refined by R2#2).** A cold client reads the Y.Doc snapshot + the
`excelSyncFrontier:${templateId}` meta and fetches missing ops by the stable `excel_sync_head`
revision (not the resettable registration), starting at the frontier revision. The reducer
re-walks from there, advancing/halting the single frontier (R2#2). No replay-from-zero.

**F12 — broadcast fires POST-COMMIT; fetch reads only committed ops; capped backoff.**
The Edge calls the RPC (commits) THEN broadcasts a content-free hint. `fetchSince` reads
`excel_sync_ops` (committed rows only) up to the committed head; F5 guarantees head ≤
committed ops. Re-fetch on a perceived gap uses capped exponential backoff — no infinite loop.

**F13 — `kal309_ack_materialization` cannot un-stick a conflict-review.** It is scoped by
`op_uuid`; per-op `op_status` transitions are guarded: `accepted → materialized` ONLY. Once
`client_conflict_review`, only the reviewing user's explicit resolution clears it — a late
ack from another client is a no-op (guard in the ack RPC). And the apply RPC BLOCKS (routes
to `review`) any NEW op for a marker that has an open `client_conflict_review`.

**F14 — the matcher guarded-copy drift test runs IN the gate.** Add it to
`scripts/run-node-tests.mjs` so a drift between `src/services/*` and the Edge copy FAILS the
suite, not just an optional script.

**F15 — the Edge matcher copy keeps `.js` extensions, includes `rowIdToken.js`, and HMACs
the EXACT base64 secret string from `kal308a_get_signing_secret`.** (F0 resolved → real.)
Pinned by a round-trip test in the Edge against a known secret.

**F16 (round-1, new) — workbook identity + token validation, not a bare registration id.**
The client sends `workbookId` + `syncToken` (read from the workbook's `_SurveyMetadata`
cells B5/B6 via `readRegistrationFromMetaSheet`) PLUS `documentId` + `templateId`. The Edge
resolves the ACTIVE registration by `workbook_id` (now UNIQUE on active rows), then validates
the token: `token_hash == sha256(syncToken)`, `revoked_at IS NULL`, `token_expiry > now()`.
A `workbookRegistrationId` is NEVER trusted from the client as the authority — it is derived
server-side from the validated registration.

**F17 (round-1, new) — actor-aware role checks under the service role.** Under the
service-role path `auth.uid()` is NULL, so the apply RPC takes `p_actor_id` explicitly and
re-checks editor/owner against `p_actor_id` by querying `document_collaborators` +
`documents.user_id` DIRECTLY — it does NOT call `user_can_access_document` (that keys on
`auth.uid()`). Audit attributes to `p_actor_id`. The Edge first validates the caller's JWT
(`auth.getUser`) → that authenticated user IS `p_actor_id`.

**F18 (round-1, new) — server-side baseline seeding at export.** First import has no trusted
server baseline. A new RPC `kal309_seed_sync_state` upserts `excel_sync_state` for every
exported marker (its fingerprints + `assigned_token`) so the apply RPC has a trusted
Excel-side baseline to diff against. Called from the export flow in `PDFViewer.jsx`
(`handleExportSurveyToExcel`) AFTER `registerWorkbook()` + identity records are built. See A.6 + D.6.

**F19 (round-1, new) — change-set OUTCOMES table for full replay-safety.** New
`excel_sync_changesets` stores the COMPLETE per-row `outcomes` jsonb (every outcome class)
+ `writeback_jobs` jsonb + `request_hash`, UNIQUE on `(document_id, template_id,
client_change_set_id)`. On replay the RPC returns the stored blob verbatim (F7).

**F20 (round-1, new) — atomic create id + signed, persisted Row-ID token BEFORE broadcast.**
For server-created rows the sequence is strict: RPC mints `marker_annotation_id` + persists
the create outcome (token NULL, `pending_rowid_writeback=TRUE`) → Edge signs a Row-ID token
for each created id (HMAC via `rowIdToken.js`, secret from `kal308a_get_signing_secret` over
the frozen `signing_doc_id`) → Edge PERSISTS each token via `kal309_persist_created_token`
(writes `excel_sync_state.assigned_token` + a writeback job into the stored changeset) →
ONLY THEN does the Edge broadcast. No broadcast before the token is durable.

**F21 (round-1, new) — server-readable template for the field whitelist is BEST-EFFORT,
open decision.** A server-side `templates` table exists (`config` JSONB with `entities[].id`
and `modules[].categories[].checklist[].id`), but `excel_workbook_registrations.template_id`
is `TEXT, not FK` and may be a local-only `tpl-…` id, AND that table's RLS is single-owner
(`auth.uid() = user_id`), AND it is NOT in the migrations tree. So the apply RPC validates
checklist-item / entity ids STRUCTURALLY (well-formed, non-empty, present in the
client-declared field set) and, WHEN `template_id` is a resolvable UUID owned by the actor,
ALSO against the loaded template. When it is not, validation is structural only. See B step
6a and the open decision in Round-1 integration notes.

**F22 (round-1, new) — `actor_id` is nullable (never NOT NULL + ON DELETE SET NULL).** The
audit/state/changeset `actor_id` columns are `UUID NULL REFERENCES auth.users(id) ON DELETE
SET NULL`. (A NOT NULL column with ON DELETE SET NULL is self-contradictory — dropping the
user would violate the constraint.)

---

## (A) Migration `supabase/migrations/20260625120000_kal309_excel_sync.sql`

Five new tables (`excel_sync_head`, `excel_sync_state`, `excel_sync_ops`,
`excel_sync_changesets`, `excel_sync_audit`) + ONE additive touch to
`excel_workbook_registrations` (the active-unique index on `workbook_id`) + a
frozen-signing-id column. All new tables: **RLS enabled, REVOKE ALL from
authenticated/anon, zero client policies — service-role + SECURITY DEFINER RPCs
only** (mirrors the 308a table, `20260624120000:54-55`). `CREATE EXTENSION IF NOT
EXISTS pgcrypto;` at top; all crypto via `extensions.*` under `SET search_path =
''` (KAL-307 lesson, `20260611120000:116,181-189`).

> **F1 keying rule for ALL of A.2–A.5:** the three sync tables FK
> `document_id → documents(id) ON DELETE CASCADE` and carry `template_id`,
> `scope_id`, `workbook_generation` as PLAIN columns. They do NOT FK the
> registration `id` (it is swapped on every re-export). The active registration is
> resolved at apply time by `(document_id, template_id) WHERE revoked_at IS NULL`.

### A.1 Additive touches to `excel_workbook_registrations` (F16, Decision 1)

```sql
-- (i) F16: workbook_id must be UNIQUE on ACTIVE rows before the Edge looks up by it.
--     Today it is only a plain index (20260611120000:63-64). Partial-unique on
--     ACTIVE rows only — revoked rows keep old workbook_ids for audit.
CREATE UNIQUE INDEX IF NOT EXISTS excel_workbook_registrations_workbook_id_active_uniq
  ON public.excel_workbook_registrations (workbook_id)
  WHERE revoked_at IS NULL;

-- (ii) Decision 1: store the FROZEN canonical signing-id captured at register/export.
--      Duplicates rowid_signing_secrets.signing_doc_id but lets the Edge resolve
--      registration→signing-id in one read. Populated by the client at register time
--      (D.6); NULL on legacy rows forces re-export (308a legacy-preflight).
ALTER TABLE public.excel_workbook_registrations
  ADD COLUMN IF NOT EXISTS rowid_signing_doc_id TEXT;

-- NOTE: excel_revision is DELIBERATELY NOT added here (F2 — it lives on
-- excel_sync_head, keyed by the stable mirror, not the swappable registration row).
```

> Boundary note: the `kal307_register_workbook` RPC signature + return shape are
> UNCHANGED (PLAN-KAL308 DO NOT CHANGE). `rowid_signing_doc_id` is set by a tiny
> separate additive setter RPC (A.5 #1) the client calls post-register — NOT by
> editing kal307's body.

### A.2 `excel_sync_head` — per-mirror monotonic revision head (F2)

The serialization point + the fetch-since cursor source. Keyed by the STABLE
`(document_id, template_id)` mirror so it survives every re-export.

```sql
CREATE TABLE IF NOT EXISTS public.excel_sync_head (
  document_id    UUID   NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  template_id    TEXT   NOT NULL,
  excel_revision BIGINT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, template_id)
);
```

The apply RPC does `INSERT … ON CONFLICT DO NOTHING` to ensure the head row exists,
then `SELECT excel_revision … FOR UPDATE` to serialize the whole change-set, then
one `UPDATE … SET excel_revision = v_head` at the end of the same txn (F5).

### A.3 `excel_sync_state` — latest-per-marker Excel-side identity + apply bookkeeping (F1, Decision 4)

Mirrors the `excelSync` identity record (`excelIdentityRecord.js`/
`buildMarkerIdentityRecord`) 1:1 + apply bookkeeping + materialization status.
Keyed by the stable mirror `(document_id, template_id, scope_id,
marker_annotation_id)` — NOT the registration id.

```sql
CREATE TABLE IF NOT EXISTS public.excel_sync_state (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id                 UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  template_id                 TEXT        NOT NULL,                 -- F1: plain column
  scope_id                    TEXT        NOT NULL,
  workbook_generation         INTEGER     NOT NULL,                 -- F1: plain column (registration.generation snapshot)
  marker_annotation_id        TEXT        NOT NULL,

  -- excelSync identity record (buildMarkerIdentityRecord), 1:1 column mapping
  identity_version            TEXT        NOT NULL,                 -- record.version
  origin                      TEXT        NOT NULL,                 -- 'import' | 'export'
  last_export_id              TEXT,                                 -- record.lastExportId
  was_written_as_row          BOOLEAN     NOT NULL DEFAULT FALSE,
  assigned_token              TEXT,                                 -- signed Row-ID (sensitive → never returned to clients via fetch_since)
  pending_rowid_writeback     BOOLEAN     NOT NULL DEFAULT FALSE,
  last_seen_row_number        INTEGER,                              -- positional memory
  last_ingest_seq             BIGINT,
  identity_vector_fingerprint TEXT        NOT NULL,
  full_row_fingerprint        TEXT        NOT NULL,
  field_fingerprints          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  copy_of_marker_id           TEXT,
  copy_ordinal                INTEGER,

  -- apply bookkeeping (Decision 0/4)
  last_applied_excel_revision BIGINT      NOT NULL DEFAULT 0,
  last_applied_op_uuid        UUID,                                 -- F8: durable op identity
  materialization_status      TEXT        NOT NULL DEFAULT 'accepted'
                                CHECK (materialization_status IN
                                  ('accepted','materialized','client_conflict_review')),

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- one state row per marker within the stable mirror scope (UPSERT target +
  -- the FOR UPDATE TOCTOU lock key in the apply RPC)
  UNIQUE (document_id, template_id, scope_id, marker_annotation_id)
);

CREATE INDEX IF NOT EXISTS excel_sync_state_mirror_idx
  ON public.excel_sync_state (document_id, template_id);
CREATE INDEX IF NOT EXISTS excel_sync_state_marker_idx
  ON public.excel_sync_state (marker_annotation_id);
CREATE INDEX IF NOT EXISTS excel_sync_state_open_review_idx
  ON public.excel_sync_state (document_id, template_id, marker_annotation_id)
  WHERE materialization_status = 'client_conflict_review';
```

### A.4 `excel_sync_ops` — ordered accepted-op log (Decision 16) — the fetch-since source

```sql
CREATE TABLE IF NOT EXISTS public.excel_sync_ops (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  op_uuid                UUID        NOT NULL DEFAULT gen_random_uuid(),  -- F8: GLOBAL durable op identity
  document_id            UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  template_id            TEXT        NOT NULL,                            -- F1: plain column
  scope_id               TEXT        NOT NULL,                            -- F1: plain column
  workbook_generation    INTEGER     NOT NULL,                           -- F1: snapshot of registration.generation
  excel_revision         BIGINT      NOT NULL,                           -- head value AFTER this op (monotonic per mirror)
  op_id                  TEXT        NOT NULL,                            -- per-change-set row id (idempotency)
  marker_annotation_id   TEXT        NOT NULL,                           -- F3: minted for create, NOT NULL
  op_type                TEXT        NOT NULL CHECK (op_type IN ('apply','create')),
  -- field-level patch the client reducer merges; carries EVERYTHING the client's final
  -- app-vs-Excel check needs (payload contract below). NO tokens, NO secrets.
  patch_payload          JSONB       NOT NULL,
  client_change_set_id   TEXT        NOT NULL,
  op_status              TEXT        NOT NULL DEFAULT 'accepted'
                           CHECK (op_status IN ('accepted','materialized','client_conflict_review','resolved')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- F8: op_uuid is globally unique (durable cross-client cursor identity)
  CONSTRAINT excel_sync_ops_op_uuid_uniq UNIQUE (op_uuid),
  -- idempotency: a replayed change-set row can never double-append
  UNIQUE (document_id, template_id, client_change_set_id, op_id),
  -- F5/F12 ordering key: one op per revision per mirror
  UNIQUE (document_id, template_id, excel_revision)
);

CREATE INDEX IF NOT EXISTS excel_sync_ops_fetch_since_idx
  ON public.excel_sync_ops (document_id, template_id, excel_revision);
CREATE INDEX IF NOT EXISTS excel_sync_ops_marker_idx
  ON public.excel_sync_ops (marker_annotation_id);
CREATE INDEX IF NOT EXISTS excel_sync_ops_changeset_idx
  ON public.excel_sync_ops (document_id, template_id, client_change_set_id);
```

### A.5 `excel_sync_changesets` — full per-changeset outcomes for replay-safety (F7, F19)

The idempotency authority AND the verbatim-replay source. One row per accepted
submission of a `client_change_set_id` for a mirror.

```sql
CREATE TABLE IF NOT EXISTS public.excel_sync_changesets (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id          UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  template_id          TEXT        NOT NULL,                              -- F1: plain column
  actor_id             UUID        REFERENCES auth.users(id) ON DELETE SET NULL,  -- F22: nullable
  client_change_set_id TEXT        NOT NULL,
  request_hash         TEXT        NOT NULL,        -- sha256 of the canonical request body (replay sanity / mismatch detection)
  outcomes             JSONB       NOT NULL,        -- F19: ALL per-row outcomes verbatim (see shape below)
  writeback_jobs       JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- F20: created-row token writeback jobs (filled by the Edge persist step)
  revision_head        BIGINT      NOT NULL,        -- head AFTER this change-set
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- F7: idempotency authority — one stored result per change-set per mirror
  UNIQUE (document_id, template_id, client_change_set_id)
);

CREATE INDEX IF NOT EXISTS excel_sync_changesets_mirror_idx
  ON public.excel_sync_changesets (document_id, template_id);
```

`outcomes` shape (one element per submitted row, EVERY class represented):
```jsonc
[
  { "opId": "...", "markerAnnotationId": "...", "opType": "apply",
    "outcome": "applied", "opUuid": "…", "excelRevision": 42 },
  { "opId": "...", "markerAnnotationId": "<minted>", "opType": "create",
    "outcome": "create", "opUuid": "…", "excelRevision": 43,
    "writebackPending": true },
  { "opId": "...", "markerAnnotationId": "...", "opType": "apply",
    "outcome": "conflict" },                              // stale | conflict | review | unauthorized | locked
  ...
]
```
`writeback_jobs` shape (filled by the Edge AFTER it signs + persists tokens, F20):
```jsonc
[ { "markerAnnotationId": "<minted>", "assignedToken": "rid_…", "scopeId": "…" } ]
```

### A.6 `excel_sync_audit` — content-free, immutable (F4, Decision 7)

```sql
CREATE TABLE IF NOT EXISTS public.excel_sync_audit (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id            UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  template_id            TEXT        NOT NULL,                            -- F1: plain column
  workbook_generation    INTEGER     NOT NULL,                           -- F1: snapshot of registration.generation
  actor_id               UUID        REFERENCES auth.users(id) ON DELETE SET NULL,  -- F22: nullable, never NOT NULL+SET NULL
  capability_tier        TEXT        NOT NULL,
  client_change_set_id   TEXT        NOT NULL,
  marker_annotation_id   TEXT,                              -- nullable: change-set-level rows
  row_outcome            TEXT        NOT NULL,              -- applied|create|conflict|stale|unauthorized|review|locked
  device_hint            TEXT,
  server_ts              TIMESTAMPTZ NOT NULL DEFAULT now() -- AUTH-03: server clock, never client
  -- NO row content. No item/notes/entity/answers. No token.
);

CREATE INDEX IF NOT EXISTS excel_sync_audit_doc_ts_idx
  ON public.excel_sync_audit (document_id, server_ts DESC);

-- F4: immutability is TRIGGER-enforced (a SECURITY DEFINER RPC runs as table owner and
--     bypasses RLS + privileges, so REVOKE alone is insufficient).
CREATE OR REPLACE FUNCTION public.kal309_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'excel_sync_audit is append-only (% blocked)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS excel_sync_audit_no_update_delete ON public.excel_sync_audit;
CREATE TRIGGER excel_sync_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON public.excel_sync_audit
  FOR EACH ROW EXECUTE FUNCTION public.kal309_audit_immutable();
```

### A.7 RLS + grants for all five tables, plus the helper RPCs

```sql
ALTER TABLE public.excel_sync_head       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.excel_sync_state      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.excel_sync_ops        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.excel_sync_changesets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.excel_sync_audit      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.excel_sync_head, public.excel_sync_state, public.excel_sync_ops,
              public.excel_sync_changesets, public.excel_sync_audit
  FROM authenticated, anon;
-- F4 defense-in-depth on top of the trigger:
REVOKE UPDATE, DELETE ON public.excel_sync_audit FROM PUBLIC;
-- Zero policies = default-deny for client roles. All access is via the SECURITY DEFINER
-- RPCs (owner) or the service role (the Edge; bypasses RLS). KAL-310 surfaces audit
-- read-only; never relaxes this.
```

**Actor-aware access predicate (F17)** — a shared SQL fragment used by the apply RPC
(it runs under the service role, so `auth.uid()` is NULL):

```sql
-- "does p_actor_id have editor-or-owner on p_document_id" WITHOUT auth.uid().
-- (user_can_access_document keys on auth.uid() and CANNOT be reused here.)
--   EXISTS(SELECT 1 FROM public.document_collaborators
--          WHERE document_id = p_document_id AND user_id = p_actor_id
--            AND role IN ('editor','owner') AND status = 'active')
--   OR EXISTS(SELECT 1 FROM public.documents
--             WHERE id = p_document_id AND user_id = p_actor_id)
```

RPCs created in this migration (besides the keystone B):

1. **`kal309_set_registration_signing_id(p_document_id UUID, p_template_id TEXT, p_workbook_id TEXT, p_signing_doc_id TEXT)`** (R2#3)
   — SECURITY DEFINER, `auth.uid()` not null + `user_can_access_document(p_document_id,
   'editor')`. **Derives the active registration row server-side** (`SELECT id FROM
   excel_workbook_registrations WHERE workbook_id = p_workbook_id AND revoked_at IS NULL`;
   verify its `document_id`/`template_id` match the args), then sets `rowid_signing_doc_id`
   only if currently NULL (freeze-once). The client passes `{workbookId}` (from the meta
   sheet / `registerWorkbook` return), NEVER a `registration.id`. `GRANT EXECUTE …
   TO authenticated`. (Client-path RPC → keys on `auth.uid()` is correct here.)

2. **`kal309_seed_sync_state(p_document_id UUID, p_template_id TEXT, p_workbook_id TEXT, p_markers JSONB)`** (F18, R2#3)
   — SECURITY DEFINER, `auth.uid()` not null + editor-gated via
   `user_can_access_document(p_document_id,'editor')`. **Derives `workbook_generation`
   server-side** from `p_workbook_id` (`SELECT generation FROM excel_workbook_registrations
   WHERE workbook_id = p_workbook_id AND revoked_at IS NULL`); the client never sends
   `registration.generation`. `p_markers` is an array of `{ markerAnnotationId, scopeId,
   identityRecord:{…}, assignedToken }` built at export from `buildMarkerIdentityRecord`. For
   each, UPSERT `excel_sync_state` on the stable-mirror unique key with `origin='export'`, the
   fingerprints, `assigned_token`, `was_written_as_row`, `last_export_id`, positional memory,
   the derived `workbook_generation`, `materialization_status='materialized'`,
   `last_applied_excel_revision = (current head, read non-locking)`. Ensures the apply RPC has
   a trusted Excel-side baseline to diff against on the very first import. Idempotent re-export
   overwrites with the newest fingerprints. `GRANT EXECUTE … TO authenticated`.

3. **`kal309_fetch_since(p_document_id UUID, p_template_id TEXT, p_since_revision BIGINT)`** (F11)
   — SECURITY DEFINER, viewer-gated read (`user_can_access_document(p_document_id,'viewer')`),
   returns `excel_sync_ops` rows for that MIRROR with `excel_revision > p_since_revision`
   ascending. **Scoped by `(document_id, template_id)`** (F1 — the stable mirror, not the
   resettable registration). **Redacted projection — returns exactly
   `op_uuid, op_id, excel_revision, marker_annotation_id, op_type, patch_payload, op_status`;
   never `assigned_token`** (the `patch_payload` is token-free by construction in B). NO
   `SELECT *`. `GRANT EXECUTE … TO authenticated`.

4. **`kal309_ack_materialization(p_document_id UUID, p_template_id TEXT, p_op_uuid UUID, p_status TEXT)`** (F8, F13)
   — SECURITY DEFINER, editor-gated. `p_status ∈ {materialized, client_conflict_review}`.
   Scoped by `op_uuid`. GUARDED transitions: from `accepted` → either target; an `accepted →
   materialized` ack is a NO-OP if the op is already `client_conflict_review` (a late ack
   from another client cannot un-stick a conflict). Updates the matching `excel_sync_ops`
   row AND the marker's `excel_sync_state.materialization_status`. `GRANT EXECUTE …
   TO authenticated`.

5. **`kal309_persist_created_token(p_document_id UUID, p_template_id TEXT, p_scope_id TEXT, p_marker_annotation_id TEXT, p_client_change_set_id TEXT, p_assigned_token TEXT)`** (F20)
   — SECURITY DEFINER, **service-role ONLY** (`REVOKE … FROM PUBLIC, authenticated, anon;
   GRANT … TO service_role`). Called by the Edge AFTER it signs a created marker's Row-ID
   token: sets `excel_sync_state.assigned_token = p_assigned_token`,
   `pending_rowid_writeback = TRUE` for that marker, AND appends
   `{markerAnnotationId, assignedToken, scopeId}` to the change-set's
   `excel_sync_changesets.writeback_jobs`. Must complete for ALL created ids BEFORE the Edge
   broadcasts (F20). (Keyed by the stable mirror `(document_id, template_id)` — no registration
   id/generation needed, R2#3.)

6. **`kal309_resolve_materialization_conflict(p_document_id UUID, p_template_id TEXT, p_op_uuid UUID, p_resolution TEXT, p_resolved_fingerprints JSONB)`** (R2#4)
   — SECURITY DEFINER, editor-gated (`auth.uid()` not null +
   `user_can_access_document(p_document_id,'editor')`). **Clears a
   `client_conflict_review`** for the op identified by `op_uuid` (scoped to the mirror).
   `p_resolution ∈ {'keep-app','take-excel','merged'}`:
     • **keep-app** — the app value wins; the Excel-side op is discarded. Transition the op
       `client_conflict_review → resolved` and the marker's
       `excel_sync_state.materialization_status → materialized` WITHOUT changing app fields
       (the client does not re-apply the op).
     • **take-excel** — the Excel value wins; the client WILL re-materialize the op after this
       returns. Transition `client_conflict_review → resolved`; set state
       `materialization_status → accepted` so the reducer re-applies on the next pass (then
       the normal materialized ack flips it).
     • **merged** — the reviewer hand-merged; `p_resolved_fingerprints` (the post-merge
       identity/field fingerprints) is written into `excel_sync_state` so the next TOCTOU
       diff is against the merged baseline; op → `resolved`, state → `materialized`.
   In ALL cases the op leaves `client_conflict_review`, which **UNBLOCKS same-marker ops** held
   by the server pre-gate (B step 7) and the client block-stacking guard (D.4) — later ops for
   that marker can now flow. Audit a `row_outcome='review'` resolution row. `GRANT EXECUTE …
   TO authenticated`. Wired into the client review path (D.4 / `pendingImportReview`).

> NB: #1–#4 and #6 are `authenticated`-callable and re-check the role inside; #5 is
> service-role only. NONE of them is the keystone apply RPC (B), which is service-role only.

---

## (B) The keystone RPC `kal308_apply_changeset` (in the same migration A)

```sql
CREATE OR REPLACE FUNCTION public.kal308_apply_changeset(
  p_actor_id              UUID,    -- F17: validated actor, passed explicitly (NOT auth.uid())
  p_document_id           UUID,
  p_template_id           TEXT,    -- F1: the mirror key
  p_workbook_id           TEXT,    -- R2#3: the server-minted workbook id; generation derived from it
  p_capability_tier       TEXT,
  p_client_change_set_id  TEXT,
  p_request_hash          TEXT,    -- F7/F19: sha256 of the canonical request body
  p_device_hint           TEXT,
  p_template_config       JSONB,   -- F21: best-effort template (entities + checklist ids) OR NULL
  p_rows                  JSONB    -- ordered array of row decisions (payload contract below)
)
RETURNS JSONB                       -- { revision_head, outcomes:[…], writeback_jobs:[…] }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_head        BIGINT;
  v_is_editor   BOOLEAN;
  v_existing    JSONB;
  v_reg_gen     INTEGER;   -- R2#3: registration.generation DERIVED server-side from workbook_id
  ...
BEGIN
  -- STEP ORDER IS LOAD-BEARING (R2#1): AUTH → LOCK → REPLAY. The idempotency short-circuit
  -- returns stored writeback_jobs (token material in the job blob), so it MUST come AFTER the
  -- role check (an unauthorized caller can never read another actor's stored outcomes) AND
  -- under the head lock (so concurrent duplicates of the same change-set serialize cleanly,
  -- never racing past the replay check).

  -- 0. SERVICE-ROLE GATE. EXECUTE is service-role-only (grant below). Defense in depth:
  --    assert current_setting('request.jwt.claim.role', true) = 'service_role' (or the
  --    equivalent) so a future mis-grant can't slip an authenticated caller through.

  -- 1. ACTOR ROLE RE-VALIDATION IN-TXN, FIRST (F17, R2#1 — never auth.uid() under service role).
  --    Nothing is read or written for this change-set until the actor is proven editor/owner.
  v_is_editor :=
       EXISTS (SELECT 1 FROM public.document_collaborators
                WHERE document_id = p_document_id AND user_id = p_actor_id
                  AND role IN ('editor','owner') AND status = 'active')
    OR EXISTS (SELECT 1 FROM public.documents
                WHERE id = p_document_id AND user_id = p_actor_id);
  IF NOT v_is_editor THEN
    -- generation not yet resolved (registration lookup is step 2) → 0 in the audit snapshot.
    INSERT INTO public.excel_sync_audit(document_id, template_id, workbook_generation,
      actor_id, capability_tier, client_change_set_id, row_outcome)
      VALUES (p_document_id, p_template_id, 0, p_actor_id,
              p_capability_tier, p_client_change_set_id, 'unauthorized');
    RETURN jsonb_build_object('error','unauthorized','outcomes','[]'::jsonb);
  END IF;

  -- 2. RESOLVE THE ACTIVE REGISTRATION GENERATION SERVER-SIDE (R2#3). The client only has
  --    {workbookId, syncToken}; it never sends registration.id/generation. Derive the live
  --    generation from the workbook_id (validated by the Edge, re-resolved here for the audit
  --    snapshot). Use the resolved value as workbook_generation everywhere below.
  SELECT generation INTO v_reg_gen
    FROM public.excel_workbook_registrations
   WHERE workbook_id = p_workbook_id AND revoked_at IS NULL;   -- workbook_id UNIQUE on active rows (A.1)
  IF NOT FOUND THEN
    INSERT INTO public.excel_sync_audit(document_id, template_id, workbook_generation,
      actor_id, capability_tier, client_change_set_id, row_outcome)
      VALUES (p_document_id, p_template_id, 0, p_actor_id, p_capability_tier,
              p_client_change_set_id, 'unauthorized');
    RETURN jsonb_build_object('error','no_active_registration','outcomes','[]'::jsonb);
  END IF;

  -- 3. DOCUMENT LOCK GATE (Codex #20). kal49_document_is_locked is auth-independent (UUID arg).
  IF public.kal49_document_is_locked(p_document_id) THEN
    -- audit change-set-level row_outcome='locked', ZERO writes
    RETURN jsonb_build_object('error','locked','outcomes','[]'::jsonb);
  END IF;

  -- 4. SERIALIZE ON THE STABLE MIRROR HEAD (F2, F5, R2#1). Ensure the head row exists, then
  --    LOCK it BEFORE the replay check so concurrent duplicate submits of the same change-set
  --    serialize (the second waits on the lock, then hits the committed replay row in step 5).
  INSERT INTO public.excel_sync_head(document_id, template_id)
    VALUES (p_document_id, p_template_id) ON CONFLICT DO NOTHING;
  SELECT excel_revision INTO v_head
    FROM public.excel_sync_head
   WHERE document_id = p_document_id AND template_id = p_template_id
   FOR UPDATE;   -- serializes the whole change-set (creates included) against concurrent submits

  -- 5. F7/F19 IDEMPOTENCY / REPLAY CHECK — NOW (AFTER auth + UNDER the head lock, R2#1).
  --    SELECT outcomes, writeback_jobs, revision_head INTO v_existing
  --      FROM excel_sync_changesets
  --      WHERE document_id=p_document_id AND template_id=p_template_id
  --        AND client_change_set_id=p_client_change_set_id;
  --    IF FOUND → return that stored blob VERBATIM (all outcomes, incl. created ids + their
  --    writeback jobs). No mint, no head bump, no second insert. (request_hash mismatch is
  --    logged as a warning but the stored result still wins — same change-set id is the
  --    contract.) Holding the head lock here means a concurrent first-submit of the SAME
  --    change-set cannot interleave: it blocks on the lock, and once we commit it reads the
  --    stored row. (OPTIONAL hardening: INSERT a 'processing' placeholder changeset row under
  --    the lock so even a crash mid-apply leaves a detectable in-flight marker; the
  --    final step-8 UPSERT promotes it to the committed outcomes.)

  -- 6. CONSERVATIVE SHARED-DOC GATE (Decision 8): if active collaborators > 1 AND
  --    capability_tier is not business-with-matching-graph-metadata → route ALL rows to
  --    'review', zero writes, store the changeset outcomes, return. (NOT KAL-311's full registry.)

  -- 7. PER ROW, in array order. Accumulate v_outcomes JSONB + v_writeback (token NULL here).
  FOR each row IN p_rows LOOP
    --   PRE-GATE (F13): if this marker has an OPEN client_conflict_review in
    --     excel_sync_state → outcome 'review', NO write. (Block-stacking guard, server side.)

    --   a. op_type='apply':
    --      • SELECT … FOR UPDATE the excel_sync_state row by
    --        (document_id, template_id, scope_id, marker_annotation_id).
    --      • If absent → 'review' (no trusted server baseline; e.g. legacy/no seed). Decisions 9,12.
    --      • TOCTOU re-validate (Codex #4, F6): compare STORED base fingerprints
    --        (identity_vector_fingerprint / field_fingerprints) against the row's claimed
    --        baseFingerprints. Drift → 'conflict'/'stale', NO write. (Excel-vs-Excel tier
    --        ONLY. App-vs-Excel is the client's job — F6.)
    --      • FIELD WHITELIST (Codex #18, F21): accept ONLY mapped marker fields
    --        (item/name, entity, notes, answers:{checklistItemId}). Validate:
    --          – STRUCTURALLY always (non-empty well-formed ids; keys ∈ the declared set);
    --          – AND, when p_template_config IS NOT NULL, that each entity id ∈
    --            p_template_config->'entities'[*]->>'id' and each checklist item id ∈ the
    --            scope's category checklist ids. p_template_config NULL → structural only
    --            (F21 open decision). Unknown keys are ignored, not failed.
    --   b. op_type='create':
    --      • Mint marker_annotation_id := extensions.gen_random_uuid()::text (F3/F8 — minted
    --        ONCE, embedded in patch_payload + state + outcomes so every client materializes
    --        the SAME marker; never regenerated on replay because of the F1 idempotency row).
    --      • State row created with assigned_token NULL, pending_rowid_writeback=TRUE
    --        (F20 — the Edge signs + persists the token AFTER this RPC commits).
    --      • Outcome 'create' with writebackPending:true.
    --   c. candidateDelete rows → outcome 'review' only (F10). No server delete.
    --   d. legacy/no-Row-ID/schema-diff/foreign-token rows → outcome 'review' (Decisions 9,12).

    --   e. ATOMIC for an ACCEPTED apply/create row (F5, all in THIS txn):
    --      v_head := v_head + 1;
    --      INSERT INTO excel_sync_ops (op_uuid DEFAULT, document_id, template_id, scope_id,
    --        workbook_generation=v_reg_gen, excel_revision=v_head, op_id, marker_annotation_id,
    --        op_type, patch_payload, client_change_set_id, op_status='accepted')
    --        ON CONFLICT (document_id, template_id, client_change_set_id, op_id) DO NOTHING
    --        RETURNING op_uuid;            -- F7: a stray duplicate row never double-appends
    --      INSERT … ON CONFLICT (document_id, template_id, scope_id, marker_annotation_id)
    --        DO UPDATE  -- full identity UPSERT into excel_sync_state (workbook_generation=v_reg_gen),
    --        materialization_status='accepted', last_applied_excel_revision=v_head,
    --        last_applied_op_uuid=<op_uuid>;
    --      INSERT INTO excel_sync_audit (..., workbook_generation=v_reg_gen, actor_id=p_actor_id,
    --        row_outcome='applied'/'create', server_ts=now());
    --      append {opId, opUuid, markerAnnotationId, opType, outcome, excelRevision} to v_outcomes.
    --    For NON-accepted rows: audit the outcome, append it to v_outcomes, NO ops/state write.
  END LOOP;

  -- 8. PERSIST THE BUMPED HEAD ONCE (F5, same txn).
  UPDATE public.excel_sync_head SET excel_revision = v_head, updated_at = now()
    WHERE document_id = p_document_id AND template_id = p_template_id;

  -- 9. STORE THE CHANGE-SET OUTCOMES (F7/F19) — the replay authority. UPSERT so an OPTIONAL
  --    step-5 'processing' placeholder is promoted to the committed result.
  INSERT INTO public.excel_sync_changesets (document_id, template_id, actor_id,
    client_change_set_id, request_hash, outcomes, writeback_jobs, revision_head)
    VALUES (p_document_id, p_template_id, p_actor_id, p_client_change_set_id,
            p_request_hash, v_outcomes, '[]'::jsonb, v_head)
    ON CONFLICT (document_id, template_id, client_change_set_id)
      DO UPDATE SET outcomes = EXCLUDED.outcomes, revision_head = EXCLUDED.revision_head;
    -- writeback_jobs starts empty; the Edge fills it via kal309_persist_created_token (F20).

  -- 10. RETURN { revision_head: v_head, outcomes: v_outcomes, writeback_jobs: [] }.
  --    Outcomes say 'applied'/'create' (accepted), NOT 'materialized' (materialize is the
  --    client's job; F8 ack flips it later).
END;
$$;

-- Service-role ONLY (Codex #5). Clients reach it only via the Edge Function.
REVOKE ALL ON FUNCTION public.kal308_apply_changeset(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.kal308_apply_changeset(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)
  TO service_role;
```

**Patch payload contract (per `p_rows[i]` AND per `excel_sync_ops.patch_payload`):**
```jsonc
{
  "opId": "...",                    // per-change-set row id (idempotency key)
  "opType": "apply",                // "apply" | "create" | "candidateDelete"
  "markerAnnotationId": "...",      // for apply; OMITTED/ignored for create (server mints)
  "scopeId": "...",
  "templateId": "...",
  "fields": { "item": "...", "entity": "...|null", "notes": "...",
              "answers": { "<checklistItemId>": "..." } },
  "changedFieldKeys": ["entity", "notes", "answer:<checklistItemId>"],  // matcher's excelChangedFields
  "baseFingerprints": { "identityVector": "...", "fields": { "<key>": "..." } }
  // NO assigned_token, NO secret. (Created rows get markerAnnotationId stamped by the RPC.)
}
```
The whole-marker write is FORBIDDEN: `changedFieldKeys` is the merge whitelist the
client reducer (D.3) applies field-by-field, preserving concurrent app edits to
untouched fields (F9). The server NEVER persists a token into `patch_payload`.

---

## (C) Edge Function `supabase/functions/excel-apply-changeset/index.ts`

Follows the existing function shape (`send-email/index.ts`: `Deno.serve`,
`auth.getUser`, `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`). esm.sh imports with
`?target=deno`.

```
supabase/functions/excel-apply-changeset/
├── index.ts
└── services/                      # GUARDED COPY (deno-matcher Option B) of:
    ├── rowIdToken.js              #   byte-identical to src/services/*; keep .js extensions (F15)
    ├── rowFingerprint.js
    ├── excelConflictDetect.js
    ├── excelIdentityRecord.js
    ├── rowImportMatcher.js
    └── buildScopeImportPlans.js
```

**Why guarded copy, not relative import:** Deno Edge Functions are isolated module
contexts; `../../../src/services/*.js` is not reliably resolvable at deploy. Sync the
copy via a pre-deploy script + a drift test that runs IN the gate (F14). All 6 files are
Deno-portable as-is (SubtleCrypto + TextEncoder only; no Node/browser deps). The Edge HMACs
the EXACT base64 `secret_b64` string from `kal308a_get_signing_secret`, pinned by a
round-trip test against a known secret (F15).

**Sync script** `scripts/sync-matcher-to-edge.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
SRC=src/services; DST=supabase/functions/excel-apply-changeset/services
mkdir -p "$DST"
cp "$SRC"/{rowIdToken,rowFingerprint,excelConflictDetect,excelIdentityRecord,rowImportMatcher,buildScopeImportPlans}.js "$DST/"
```
Add `tests/excel-edge-matcher-drift.test.mjs` that diffs each pair and FAILS on mismatch,
plus a Deno bundle smoke test that imports `buildScopeImportPlans` from the Edge copy and
runs one fixture. **Wire BOTH into `scripts/run-node-tests.mjs` (F14).**

**`index.ts` request flow:**
```ts
Deno.serve(async (req) => {
  // 1. AUTH (F17). Authorization: Bearer JWT → anonClient.auth.getUser(token); reject anon.
  //    The authenticated user.id IS p_actor_id passed to the RPC. (send-email/index.ts:11;
  //    reference_edge_function_auth_pattern.)

  // 2. WORKBOOK IDENTITY + TOKEN VALIDATION (F16). Body carries
  //    { documentId, templateId, workbookId, syncToken, worksheetDataList, surveyMarkers,
  //      appValuesByMarkerId, ingestSeq, clientChangeSetId, capabilityTier, deviceHint }.
  //    Using the service-role client:
  //      • SELECT * FROM excel_workbook_registrations
  //          WHERE workbook_id = body.workbookId AND revoked_at IS NULL  (UNIQUE → ≤1 row).
  //      • Validate it matches body.documentId + body.templateId; else 409 'workbook-mismatch'.
  //      • token_hash check: encode(sha256(body.syncToken)) === registration.token_hash; else 403.
  //      • token_expiry > now(); else 409 're-export required'.
  //    The Edge passes body.workbookId (NOT a client registration id/generation) to the RPC,
  //    which re-resolves the live generation server-side (R2#3). A bare workbookRegistrationId
  //    from the client is NEVER accepted as authority.

  // 3. ROLE (defense in depth; the RPC re-checks against p_actor_id). service-role client:
  //    user_can_access_document is auth.uid()-keyed and useless here, so check the actor
  //    DIRECTLY: SELECT against document_collaborators (user_id=user.id, role IN editor/owner,
  //    status='active') OR documents.user_id=user.id. Reject viewer/none with 403.

  // 4. SIGNING SECRET + ROW-ID VERIFY (F15, F16).
  //    • signing_doc_id := registration.rowid_signing_doc_id (Decision 1); NULL → 409
  //      'legacy-unsigned, re-export required' (308a legacy-preflight).
  //    • secret := kal308a_get_signing_secret(documentId) (service-role) → secret_b64 string.
  //    • resolveSecret(keyId) → secret_b64. Pass to the matcher so classifyRowIdToken verifies
  //      each Row-ID against the STORED signing_doc_id — never a client-supplied documentId.
  //      Token mismatch → that row → 'review'.

  // 5. TEMPLATE LOAD FOR WHITELIST (F21, best-effort). If body.templateId is a UUID, attempt
  //    SELECT config FROM templates WHERE id = body.templateId (service-role bypasses the
  //    single-owner RLS) → p_template_config. If templateId is a local 'tpl-…' id OR not found
  //    → p_template_config = null (RPC validates structurally only). NOTE: open decision — see
  //    Round-1 integration notes; the client should ALSO send the resolved template config in
  //    the body so the Edge can pass it through even when the row is local-only.

  // 6. RUN MATCHER (advisory). buildScopeImportPlans({ worksheetDataList, surveyMarkers,
  //      templateToUse, documentId: signing_doc_id, resolveSecret, appValuesByMarkerId,
  //      ingestSeq }) → scopePlans (Map). surveyMarkers + appValuesByMarkerId come from the
  //      CLIENT body — the server cannot read live Yjs (Decision 0). The Edge tier is actor-role
  //      + Row-ID verify + Excel-vs-Excel drift, NOT app-vs-Excel.

  // 7. FLATTEN decisions → p_rows JSONB (apply/create/review/candidate-delete), preserving order;
  //    attach matcher changedFields → changedFieldKeys and base fingerprints. Compute
  //    request_hash := sha256(canonical(body)).

  // 8. CALL RPC. serviceClient.rpc('kal308_apply_changeset', { p_actor_id: user.id,
  //      p_document_id, p_template_id, p_workbook_id: body.workbookId, p_capability_tier,
  //      p_client_change_set_id, p_request_hash, p_device_hint, p_template_config, p_rows }).
  //    The RPC DERIVES workbook_generation from p_workbook_id (R2#3) and RE-VALIDATES
  //    (role, lock, TOCTOU, whitelist) — Edge checks are advisory.
  //    → { revision_head, outcomes, writeback_jobs: [] }.

  // 9. SIGN + PERSIST CREATED-ROW TOKENS (F20), BEFORE any broadcast. For each outcome with
  //    outcome:'create': sign a Row-ID token for its minted markerAnnotationId via
  //    generateRowIdToken (rowIdToken.js) over signing_doc_id with secret_b64, then call
  //    kal309_persist_created_token(documentId, templateId, scopeId, markerAnnotationId,
  //    clientChangeSetId, assignedToken). This persists assigned_token + the writeback job.
  //    Collect the jobs into the response. If ANY token persist fails → do NOT broadcast;
  //    return the outcomes WITHOUT the writeback jobs and let the client retry the change-set
  //    (idempotent — F7 replays the stored outcomes; the persist step re-runs for still-NULL
  //    tokens). No broadcast before every created token is durable.

  // 10. BROADCAST a content-free HINT on channel `yjs:${documentId}`, event
  //     'excel_sync_applied', payload { documentId, templateId, revisionHead }.
  //     (SupabaseYjsProvider.js sendBroadcast; NO row content; under 600KB cap.) POST-commit (F12).

  // 11. RETURN per-row outcomes JSON to the submitter (applied / conflict / stale / unauthorized /
  //     review / create-with-writeback-job), plus revisionHead. Cap rows-per-set + cell sizes;
  //     rate-limit per actor/document/workbook (Decision 15).
});
```

**Observability (Decision 14):** structured content-free logs — auth pass/fail,
token-verify outcome counts, conflict/stale/review tallies, created-token persist
successes/failures, apply latency, replay hits. No row content ever in logs.

---

## (D) Client cutover

Touches the import-apply call site + the export block ONLY in `src/PDFViewer.jsx`.
Zoom/canvas/render invariants untouched.

### D.1 New service `src/services/excelSyncClient.js`

- `submitChangeSet({ documentId, templateId, workbookId, syncToken, capabilityTier,
  worksheetDataList, surveyMarkers, appValuesByMarkerId, templateConfig, ingestSeq,
  clientChangeSetId, deviceHint })`
  → `supabase.functions.invoke('excel-apply-changeset', { body })`. `clientChangeSetId`
  = `crypto.randomUUID()` per submission, **persisted for retry** (a retry reuses the SAME
  id → F7 replay returns the stored outcomes). `workbookId` + `syncToken` are read from the
  workbook's `_SurveyMetadata` B5/B6 via `readRegistrationFromMetaSheet` (F16).
- `fetchSince({ documentId, templateId, sinceRevision })`
  → `supabase.rpc('kal309_fetch_since', …)`.
- `ackMaterialization({ documentId, templateId, opUuid, status })`
  → `supabase.rpc('kal309_ack_materialization', …)`.
- `resolveMaterializationConflict({ documentId, templateId, opUuid, resolution,
  resolvedFingerprints })` → `supabase.rpc('kal309_resolve_materialization_conflict', …)`
  (R2#4; called from the review surface, D.4).
- `seedSyncState({ documentId, templateId, workbookId, markers })`
  → `supabase.rpc('kal309_seed_sync_state', …)` (called from the export block, D.6).
  Takes `workbookId` (NOT `registration.generation`) — the RPC derives the generation
  server-side (R2#3).
- `setRegistrationSigningId({ documentId, templateId, workbookId, signingDocId })`
  → `supabase.rpc('kal309_set_registration_signing_id', …)` (R2#3; called from the export
  block, D.6). Takes `workbookId` (NOT `registration.id`).

### D.2 Build the change set from the EXISTING import flow (do NOT re-implement matching)

At the PDFViewer call site (the two `buildScopeImportPlans` runs, ~`13680` manual /
~`14302` auto), the client currently runs the matcher locally then applies decisions inline
(`13751-13948`). The cutover: keep the local run for the UI PREVIEW only, but instead of
applying inline, **package the raw inputs** (`worksheetDataList`, `newSurveyMarkers` as
`surveyMarkers`, `buildAppValuesByMarkerId(...)`, `ingestSeq`, the resolved `templateConfig`,
and `workbookId`+`syncToken` from the meta sheet) and send them to the Edge via
`submitChangeSet`. The server is the authority; the local plan is advisory/preview only. The
per-row apply/create writes at `13751-13948` are REMOVED from the authoritative path —
replaced by materializing accepted ops (D.3).

### D.3 Materialize accepted ops via per-marker READ-MERGE-WRITE under an in-memory lock (F9)

On the Edge response (and on every `fetchSince` page), run the **idempotent reducer**. It
NEVER calls `applySurveyMarkers` with a full merged map.

The reducer processes ops in STRICT ascending `excel_revision` order and stops at the first
op it cannot fully HANDLE (apply or definitively route to review), so the frontier below never
skips a revision.

```js
// frontier := getMetaValue(doc, `excelSyncFrontier:${templateId}`)?.revision ?? 0   // R2#2 single cursor
// reviewMeta := getMetaValue(doc, `excelSyncReview:${templateId}`) ?? {}             // durable handled/review set, keyed by op_uuid
// for each op in ascending excel_revision (only ops with excel_revision > frontier):
//   acquire per-marker in-memory lock (markerAnnotationId)         // F9
//   re-read current := annotationDocSync.getSurveyMarkers()[op.markerAnnotationId]
//   FINAL app-vs-Excel check (client tier): for each key in op.changedFieldKeys, if the live
//     marker field differs from op.baseFingerprints AND from op.fields → genuine app-vs-Excel
//     conflict:
//       reviewMeta[op.op_uuid] = { revision: op.excelRevision, markerAnnotationId, status:'client_conflict_review' };
//       setMetaValue(doc, `excelSyncReview:${templateId}`, reviewMeta, 'excel-import');  // DURABLE (survives reload)
//       ackMaterialization({opUuid: op.op_uuid, status:'client_conflict_review'});
//       release lock;
//       BREAK the loop — this op is "handled but UNRESOLVED"; it HALTS the frontier at its
//       revision so later ops (incl. same-marker ops) are NOT applied on top (R2#2/F13).
//   else overlay ONLY op.changedFieldKeys onto a CLONE of current (never whole-marker):
//     next = structuredClone(current ?? {});  apply item/entity/notes/answers[changedKeys];
//     stamp next.excelSync from op identity; (create → next is a NEW marker with the minted id)
//     // F9 retry guard: re-read just before write; if current changed since the read, retry under lock.
//     annotationDocSync.applySurveyMarkers({ [op.markerAnnotationId]: next }, { origin: 'excel-import' });
//     ackMaterialization({opUuid: op.op_uuid, status:'materialized'});
//     // advance the SINGLE frontier ONLY because this op is fully handled AND contiguous:
//     setMetaValue(doc, `excelSyncFrontier:${templateId}`, { revision: op.excelRevision, at: Date.now() }, 'excel-import');
//   release per-marker lock
```
`applySurveyMarkers` with `origin:'excel-import'` is minimal-diff
(`annotationDocStore.js:102` `syncSurveyMarkersToDoc`) and still persists durably (origin
passes the `update` observer at `annotationDocSync.js:158` → enqueueAppend + snapshot).
`origin:'excel-import'` only disables DELETION of omitted keys (F10) — NOT persistence.
**Residual risk (F9, honest):** the per-marker lock is in-process advisory only; a concurrent
local edit that interleaves with the single-marker Yjs write can still be clobbered for the
overlaid fields. Accepted for V1 — the conflict-review + reconcile backstop covers it; true
field-level CRDT is the op-log rebuild (KAL-263/270). FLAGGED to Codex.

**ONE cursor: `excelSyncFrontier:${templateId}` (Decision 0, F8/F11, R2#2).** There is a
SINGLE frontier concept stored in the existing `META_MAP` (`annotationDocStore.js:23,54`) via
`setMetaValue`, holding the highest CONTIGUOUSLY-HANDLED revision for the mirror. There is NO
second "max-applied-revision" derivation. The frontier advances only when an op is fully
materialized AND every prior op was too. A `client_conflict_review` op is "handled but
unresolved": it is recorded durably in `excelSyncReview:${templateId}` and HALTS the frontier
at its revision — so on reopen/reconnect the client re-fetches FROM the frontier and never
skips the conflicted revision. The frontier only moves past a conflicted revision after
`kal309_resolve_materialization_conflict` clears it (D.4).

### D.4 Reconcile path (convergence + offline recovery)

- Subscribe the open client to the `excel_sync_applied` broadcast (new handler in
  `SupabaseYjsProvider.js`: `.on('broadcast', { event: 'excel_sync_applied' }, …)`). On hint
  → `fetchSince(frontierRevision)` → run the D.3 reducer (which advances/halts the single
  frontier) → on failure retry with capped exponential backoff (F12 — never an infinite loop).
- On document open, `fetchSince(frontierRevision)` replays any ops missed offline.
  `frontierRevision = getMetaValue(doc, ` + "`excelSyncFrontier:${templateId}`" + `)?.revision ?? 0` —
  the SINGLE persisted cursor (R2#2), never a recomputed max.
- **Conflict resolution path (R2#4).** A `client_conflict_review` op halts the frontier and
  appears in the existing review surface (`pendingImportReview` / the review UI). When the
  reviewer picks keep-app / take-excel / merged, the client calls
  `kal309_resolve_materialization_conflict({ documentId, templateId, opUuid, resolution,
  resolvedFingerprints })`, removes the op from `excelSyncReview:${templateId}` meta, then
  re-runs the D.3 reducer from the frontier — which now flows PAST the resolved revision
  (take-excel re-materializes the op; keep-app/merged just advances). Without this call a
  conflict is a PERMANENT frontier blocker — which is exactly the round-2 gap this closes.

### D.5 Row-ID writeback (Decision 11, F20)

Server-created rows return verified writeback jobs (the Edge already signed + persisted the
token via `kal309_persist_created_token` BEFORE broadcasting, so the job's `assignedToken` is
durable). The client flushes them via the existing `rowIdWritebackQueue`;
`excel_sync_state.pending_rowid_writeback` tracks completion (cleared via a future ack — out
of this slice's write path, surfaced only).

### D.6 Export-time server baseline seeding (F18)

In `handleExportSurveyToExcel` (`PDFViewer.jsx`, the export block 12121–12865), AFTER
`registerWorkbook()` (12188; returns `{ workbookId, syncToken }` — NO id/generation, R2#3) and
AFTER `buildMarkerIdentityRecords()` (12687) but on the SUCCESS path (alongside
`markExcelExportSynced` at 12829). The ONLY registration handle the client has is
`workbookId`; every RPC below derives the registration row server-side from it (R2#3):
1. Call `seedSyncState({ documentId, templateId, workbookId, markers })` where `markers` is
   built from the per-marker identity records (fingerprints + `assigned_token` + scopeId +
   markerAnnotationId). The RPC derives `workbook_generation` from `workbookId` and UPSERTs
   `excel_sync_state` so the apply RPC has a trusted Excel-side baseline on the very FIRST
   import — without it, the RPC would route every first-import apply to 'review' for lack of a
   server baseline.
2. Call `setRegistrationSigningId({ documentId, templateId, workbookId, signingDocId })` so the
   Edge can resolve the frozen signing id in one read (A.1 (ii); freeze-once). The RPC derives
   the registration row from `workbookId` (R2#3). `signingDocId` is the `signing_doc_id`
   returned by `fetchOrCreateSigningSecret` (12248).

These are additive calls in the export success path; they do not touch zoom/canvas/render.
**No client-side use of `registration.id` or `registration.generation` anywhere (R2#3).**

---

## (E) The riskiest decisions to flag to Codex BEFORE coding

1. **`assigned_token` leakage surface.** It lives in `excel_sync_state` (sensitive Row-ID
   material). The plan keeps it out of `excel_sync_ops.patch_payload` and `kal309_fetch_since`
   BY CONSTRUCTION — `fetch_since` projects an explicit redacted column list, never `SELECT *`.
   The token reaches the client ONLY via the dedicated writeback-job channel (D.5 / the Edge
   response after `kal309_persist_created_token`). Confirm `fetch_since` physically cannot
   project it and that the Edge response separates "ops to materialize" (no token) from
   "writeback jobs" (token).

2. **Create-id minting vs. idempotency replay (F3/F7/F19).** Creates mint `gen_random_uuid()`
   inside the RPC. On a replay of the same `client_change_set_id`, step 1 returns the STORED
   `excel_sync_changesets.outcomes` (with the prior minted ids + writeback jobs) BEFORE the
   per-row loop can mint again. Confirm the replay short-circuit reads the stored blob first
   and that a retried submit can never spawn duplicate markers.

3. **`excel_revision` as both per-mirror head AND op ordering, with rejected rows leaving NO
   gaps.** The RPC increments `v_head` ONLY for accepted apply/create rows, so a 10-row set
   with 3 conflicts consumes 7 contiguous revisions (no gaps — rejected rows never claim a
   revision). Confirm fetch-since ordering + the client cursor are per-mirror
   `(document_id, template_id)` (F1/F2) and that the client never treats a conflict/review row
   as a "missing op" and infinitely re-fetches (the contiguous-revision invariant + capped
   backoff, F12).

4. **Two-tier conflict split correctness (F6).** The server only sees client-supplied
   `surveyMarkers`/`appValuesByMarkerId` (it cannot read Yjs), so its TOCTOU check is
   Excel-vs-stored-fingerprint ONLY; the authoritative app-vs-Excel check is the client reducer
   (D.3). A malicious editor could doctor `appValuesByMarkerId` to dodge a conflict — but the
   actor is an authorized editor with full write rights anyway, so the actor-role wall (F17) is
   the security boundary, and the client check is a data-safety (not security) mechanism.
   Confirm Codex accepts this for V1.

5. **Materialization ack races (F8/F13).** Two open clients both materialize the same op and
   both call `kal309_ack_materialization`. Transitions are guarded `accepted → {materialized |
   client_conflict_review}`, scoped by `op_uuid`; an `accepted → materialized` ack is a NO-OP
   once the op is `client_conflict_review` (conflict-review is sticky). Confirm the transition
   is monotonic, not last-writer-wins.

6. **Best-effort template whitelist (F21) — OPEN DECISION.** `excel_workbook_registrations.
   template_id` is `TEXT, not FK`; it may be a local `tpl-…` id; the `templates` table is
   single-owner-RLS and absent from the migrations tree. So the entity/checklist-id whitelist
   is structural-only when the template is not server-resolvable. Decide: (a) accept
   structural-only validation for local templates (current plan); (b) require the CLIENT to
   send the resolved template config in the request body (the Edge passes it to
   `p_template_config`) so the RPC always validates against the real template; or (c) add a
   proper server-side template store + FK as a precondition. The plan currently does (a)+(b).

7. **Guarded-copy drift + Deno bundle smoke test (F14/F15).** Six matcher files are copied into
   the Edge. The drift test AND a Deno import/deploy smoke test (the Edge bundle loads
   `buildScopeImportPlans` and runs one fixture) are BOTH required gates wired into
   `run-node-tests.mjs` — a silent drift reintroduces the KAL-307 inline-copy bug class.

---

## Acceptance criteria (inherited from KAL-308, mapped to this plan's artifacts)

All of PLAN-KAL308's acceptance bullets apply unchanged. Per-artifact mapping:
editor-applies-durably → B step 6e + D.3 + browser second-client check;
viewer-rejected → C steps 1/3 + B step 2; idempotent → B step 1 + the
`excel_sync_changesets` UNIQUE (A.5) + the two op UNIQUEs (A.4); TOCTOU → B step 6a;
app-vs-Excel both-changed → D.3 `client_conflict_review`; forged token → C step 4 → 'review';
shared-doc non-business → B step 5; locked doc → B step 3; create writeback → B step 6b + C
step 9 + D.5; broadcast-fails recovery → D.4; first-import baseline → D.6 + A.5 #2; gates →
`npx vite build` + `node scripts/run-node-tests.mjs` clean (report baseline first).

## Verification

- Migration + RPC: integration tests on **survey-test only** (never production —
  `survey_test_supabase_project`), mirroring the KAL-307 harness, covering TOCTOU,
  idempotency/replay (stored-outcomes verbatim), viewer-reject (via `p_actor_id`),
  forged-token, shared-doc, lock, create-id-replay, seed→first-import baseline, ack-race
  conflict-stickiness, and the F22 actor_id null-on-user-delete case.
- Matcher parity: ported Edge copy ≡ in-app decisions on shared fixtures + the drift test +
  the Deno bundle smoke test (both in the gate, F14).
- Token round-trip: Edge signs + verifies a Row-ID against a known `secret_b64` (F15);
  created-token persist-before-broadcast ordering proven (F20).
- Convergence + reconcile: browser-verified multi-client (`verify_in_app_before_reporting`,
  `adversarial_verify_realtime` ≥2 passes + code review on the realtime path).
- Latency p95 measured + recorded.

## DO NOT CHANGE (boundaries — inherited)

- `PLAN.md`, `PLAN-EXCEL-SECURITY-V1.md`, `PLAN-KAL308.md` — governing contracts.
- Matcher BEHAVIOR (`rowImportMatcher.js`, `buildScopeImportPlans.js`,
  `excelConflictDetect.js`, `rowFingerprint.js`, `rowIdToken.js`,
  `excelIdentityRecord.js`) — the Edge gets a byte-identical COPY; no behavior edits.
  KAL-308a already moved the secret.
- `kal307_register_workbook` RPC signature + return — UNCHANGED; only the additive
  active-unique index + `rowid_signing_doc_id` column on its table (A.1). `excel_revision` is
  NOT added to the registration (F2).
- `user_can_access_document` — UNCHANGED; the apply RPC does NOT call it (it keys on
  `auth.uid()`); the apply RPC checks `p_actor_id` directly (F17).
- Standing high-risk files (`PDFViewer.jsx`, `PageAnnotationLayer.jsx`, `viewerShared.js`,
  Fabric canvases, `SVGAnnotationLayer.jsx`) — cutover touches the import-apply call site +
  the export success path in PDFViewer ONLY; container-aware sizing, `zoomGeneration`,
  SVG-viewBox invariants untouched.
- Production Supabase — read-only; migration lands on survey-test; production apply is a
  separate owner-gated batch.
- Out-of-slice: KAL-310/311/312/314, Excel add-in (V2), server-side Yjs authority.

---

## Verified anchors (ground-truth, 2026-06-24)

- `excelIdentityRecord.js` — `buildMarkerIdentityRecord({values, exportId, origin,
  assignedToken, pendingRowIdWriteback, lastSeenRowNumber, lastIngestSeq})` returns
  `{version, origin, lastExportId, wasWrittenAsRow, assignedToken, pendingRowIdWriteback,
  lastSeenRowNumber, lastIngestSeq, identityVectorFingerprint, fullRowFingerprint,
  fieldFingerprints}` → A.3 column mapping + D.6 seed payload.
- `rowIdToken.js` exports `generateRowIdToken`, `parseRowIdToken`, `verifyRowIdSignature`,
  `classifyRowIdToken` → C step 4 verify + C step 9 sign.
- `buildScopeImportPlans.js:76-95` — async, params `{worksheetDataList, surveyMarkers,
  templateToUse, documentId, resolveSecret, appValuesByMarkerId, ingestSeq, logger}`; reads
  the template via `resolveUpdatedCategory(templateToUse, matchedCategory).checklist` (each
  `{id, text}`) → C step 6 invocation + F21 checklist-id source.
- `workbookRegistration.js` — `readRegistrationFromMetaSheet(metaSheetValues)` returns
  `{workbookId, syncToken}` from `_SurveyMetadata` B5/B6 (`WORKBOOK_REGISTRATION_CELLS`
  B5=workbook_id, B6=sync_token) → F16 client read. `registerWorkbook` returns
  `{workbookId, syncToken}` (raw token returned ONCE).
- `annotationDocStore.js:71,73,78,102` — `SURVEY_MARKERS_MAP='surveyMarkers'`,
  `getSurveyMarkersMap`, `docToSurveyMarkers`, `syncSurveyMarkersToDoc` (minimal-diff,
  origin-gated, `allowDeletes = origin !== 'excel-import'`) → D.3.
- `annotationDocStore.js:23,46,54` — `META_MAP='annoMeta'`, `getMetaValue`, `setMetaValue` →
  the single `excelSyncFrontier:${templateId}` cursor + durable `excelSyncReview:${templateId}`
  meta in D.3 (R2#2).
- `annotationDocSync.js:158,360,363` — observer skips `REMOTE/HYDRATE/idb` origins (so
  `'excel-import'` DOES persist), `getSurveyMarkers`, `applySurveyMarkers(markers, opts)` → D.3.
- `20260624120000_kal308a_rowid_signing_secrets.sql` — `kal308a_get_signing_secret`
  (read, editor-gated) + `kal308a_get_or_create_signing_secret` (export, mints) + frozen
  `signing_doc_id` + `secret_b64` exact base64 string → C steps 4/9, D.6.
- `20260611120000_kal307_workbook_registrations.sql` — `workbook_id` currently PLAIN index
  (lines 63-64; A.1 adds active-UNIQUE); `template_id TEXT NOT NULL, not FK` (line 29);
  `token_hash` = `encode(digest(token,'sha256'),'hex')` (line 189); `token_expiry` (line 34);
  `generation` (line 49); `revoked_at` (line 37). RPC body uses `extensions.gen_random_bytes/
  digest` under `search_path=''`. `excel_revision`/`rowid_signing_doc_id` absent (A.1 adds the
  signing-id; A.2 puts the revision on `excel_sync_head`, NOT here).
- `20260527130000_restore_user_can_access_helpers.sql:26-66` — `user_can_access_document(doc,
  role)` keys on `auth.uid()` internally (cannot take an explicit actor) → F17 rationale.
- `document_collaborators` (20241230000002): `(document_id, user_id, role IN
  ('viewer','editor','owner'), status IN ('pending','active','revoked'))`; `documents.user_id`
  is the owner column → F17 actor-aware predicate (A.7).
- `templates` table (Supabase-UI-created, NOT in migrations): `(id UUID, user_id, name, config
  JSONB)`; `config.entities[].id`, `config.modules[].categories[].checklist[].id`; RLS
  single-owner `auth.uid() = user_id` → F21 best-effort whitelist + open decision.
- `20260522000000_kal49_document_lock_state.sql:39` — `kal49_document_is_locked(UUID)`
  (auth-independent) → B step 3.
- `send-email/index.ts` — `Deno.serve`, `auth.getUser`,
  `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`, esm.sh imports → C shape.
- `SupabaseYjsProvider.js` — channel `yjs:${documentId}`, `sendBroadcast(channel, event,
  payload)`, `.on('broadcast', {event}, …)`, 600KB cap → C step 10, D.4.
- `PDFViewer.jsx` — `handleExportSurveyToExcel` (12121–12865): `registerWorkbook()` at 12188,
  `embedRegistrationIntoMetaSheet` at 12195, `fetchOrCreateSigningSecret` at 12248,
  `buildMarkerIdentityRecords()` at 12687, `writeBuffer()` at 12701, `markExcelExportSynced`
  at 12829 → D.6 seed call sites. `buildScopeImportPlans` call sites at 13680 (manual) /
  14302 (auto), `buildAppValuesByMarkerId` at 13564, `candidateDeletes` at 13995/14629,
  `setPendingImportReview` at 13613/14238/14869 → D.2 cutover targets.
- `rowIdServerSecretClient.js` — `fetchOrCreateSigningSecret(documentId, signingIdSeed)` →
  `{keyId, secret, signingDocId}`, `fetchSigningSecret(documentId)`, `hasServerSigningKey` →
  C step 4, D.6.

---

## Round-1 integration notes (what changed vs. the prior body, and open decisions)

**Rewritten to match the resolutions + Codex round-1 findings:**

1. **Schema re-keyed to the stable mirror, not the registration row (F1/F2, finding #1).**
   All three sync tables now FK `documents(id) ON DELETE CASCADE` and carry `template_id`,
   `scope_id`, `workbook_generation` as plain columns. Added `excel_sync_head(document_id,
   template_id, excel_revision, PK(document_id, template_id))`. Removed `excel_revision` from
   `excel_workbook_registrations` (the prior A.1 (iii) ALTER is gone). The apply RPC locks
   `excel_sync_head FOR UPDATE` and bumps it in the same txn as the op inserts.

2. **Workbook identity + token validation (finding #2).** The Edge now resolves the active
   registration by `workbook_id` (UNIQUE on active rows) and validates `token_hash ==
   sha256(syncToken)`, not revoked, not expired — using the client-sent `workbookId` +
   `syncToken` from `_SurveyMetadata` B5/B6 + `documentId`/`templateId`. A bare
   `workbookRegistrationId` is never trusted; `workbook_generation` is derived server-side.

3. **Actor-aware role checks (finding #3, F17).** The apply RPC takes `p_actor_id` and checks
   `document_collaborators` + `documents.user_id` DIRECTLY (never `user_can_access_document`,
   which keys on `auth.uid()` and is NULL under the service role). Audit attributes to
   `p_actor_id`. The Edge validates the JWT first; that user is `p_actor_id`.

4. **Server-side baseline seeding at export (finding #4, F18).** Added
   `kal309_seed_sync_state` and wired it into the export success path in
   `handleExportSurveyToExcel` (D.6), so the apply RPC has a trusted Excel-side baseline on
   first import. Also wired `kal309_set_registration_signing_id` there (freeze-once).

5. **Change-set OUTCOMES table (finding #5, F19).** Added `excel_sync_changesets` with
   `outcomes` + `writeback_jobs` jsonb, UNIQUE `(document_id, template_id,
   client_change_set_id)`. The RPC's idempotency short-circuit now returns the stored blob
   verbatim — ALL outcome classes, not just accepted ops.

6. **Atomic create id + signed, persisted Row-ID token before broadcast (finding #6, F20).**
   The RPC mints + persists the create outcome (token NULL). The Edge then signs each created
   token (HMAC, secret from `kal308a_get_signing_secret` over frozen `signing_doc_id`) and
   persists it via the new service-role-only `kal309_persist_created_token` BEFORE
   broadcasting. Strict sequence documented in C step 9.

7. **Materialize without data loss (finding #7, F9).** D.3 is now per-marker READ-MERGE-WRITE
   under an in-memory lock with a re-read retry guard, never a full-map `applySurveyMarkers`.
   Residual risk stated honestly (the lock is in-process advisory; a concurrent edit inside
   the single-marker write can still clobber overlaid fields).

8. **Globally-unique op UUID (finding #8, F8).** Added `op_uuid UUID` with a GLOBAL UNIQUE on
   `excel_sync_ops` as the durable cross-client op identity. (The client cursor itself is the
   single `excelSyncFrontier` — see R2#2 below — not a per-op `excelApplied` set.)

9. **Ack + conflict blocking (finding #9, F13).** `kal309_ack_materialization` is scoped by
   `op_uuid`, transitions `accepted → materialized` only, and a late ack cannot clear
   `client_conflict_review`. The apply RPC pre-gates any NEW op for a marker with an open
   review → 'review'.

10. **Audit immutability in concrete DDL (finding #11, F4).** Added the
    `kal309_audit_immutable` function + `BEFORE UPDATE OR DELETE` trigger on
    `excel_sync_audit` (plus REVOKE defense-in-depth).

11. **`actor_id` nullability (finding #12, F22).** All `actor_id` columns are `UUID NULL
    REFERENCES auth.users(id) ON DELETE SET NULL` — never `NOT NULL` + `ON DELETE SET NULL`.

**OPEN DECISIONS for Codex (finding #10, F21 — the template source):**

- **Server-readable template store is PARTIAL.** A `templates` table exists with the data we
  need (`config.entities[].id`, `config.modules[].categories[].checklist[].id`), BUT: (a)
  `excel_workbook_registrations.template_id` is `TEXT, not FK` and may be a local-only
  `tpl-…` id with no server row; (b) the `templates` table is single-owner RLS
  (`auth.uid() = user_id`) — a collaborator-editor who is not the template owner cannot read
  it under their own auth (the service-role Edge CAN read it, which is why we load it
  server-side); (c) the `templates` table is NOT in the migrations tree (Supabase-UI created),
  so we cannot add a FK without first importing/owning its DDL.
- **Plan's current stance:** the apply RPC validates entity/checklist ids STRUCTURALLY always,
  and against the real template WHEN `p_template_config` is non-NULL. The Edge loads the
  template via the service role when `template_id` is a UUID; the client ALSO sends the
  resolved `templateConfig` in the body so even local-only templates can be validated. If
  Codex wants hard validation always, the precondition is option (c): bring the `templates`
  DDL into migrations and add a FK / a server template-by-id loader — out of this slice.
- **Recommendation:** ship with structural + best-effort-template validation (the actor-role
  wall is the real security boundary; the whitelist is data-hygiene), and file the
  `templates`-into-migrations + FK work as a follow-up ticket.

**Other notes:**
- The keystone RPC signature changed (added `p_actor_id`, `p_template_id`, `p_workbook_id`,
  `p_request_hash`, `p_template_config`; the GRANT/REVOKE signature list is the 10-arg form
  `UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB`). It is still service-role only.
- `kal309_fetch_since` is scoped by `(document_id, template_id)` (the stable mirror), not a
  registration id, and returns `op_uuid` in its redacted projection.

---

## Round-2 fixes (Codex round-2 narrowed to 4 blockers — applied 2026-06-24)

**R2#1 — apply-RPC step order is now AUTH → LOCK → REPLAY (section B).** The idempotency /
replay short-circuit returns stored `writeback_jobs` (token material), so it was a leak to run
it before the role check. Reordered: (1) actor authenticated + editor/owner re-check against
`p_actor_id` FIRST; (2) resolve active-registration generation from `workbook_id`; (3) lock
gate; (4) `excel_sync_head FOR UPDATE`; (5) replay check UNDER the head lock (returns stored
outcomes verbatim if seen). The step-9 changeset store is now an UPSERT so an OPTIONAL step-5
`'processing'` placeholder row (documented as the duplicate-serialization hardening) promotes
to the committed result. No unauthorized caller can read stored outcomes; concurrent
duplicates serialize on the lock.

**R2#2 — ONE contiguous frontier, not two cursor concepts (D.3 / D.4).** Removed the
"max-applied-revision over the `excelApplied` set" derivation entirely. There is now a SINGLE
persisted `excelSyncFrontier:${templateId}` (Yjs meta) holding the highest contiguously-handled
revision. The reducer walks ops in strict ascending revision and advances the frontier ONLY
over fully-handled contiguous ops. A `client_conflict_review` op is "handled but unresolved":
it is recorded durably in `excelSyncReview:${templateId}` and HALTS the frontier at its
revision (BREAK), so reopen re-fetches from the frontier and never skips a conflicted revision.
One frontier, internally consistent.

**R2#3 — registration id/generation derived server-side from `workbook_id` (everywhere).**
`kal307_register_workbook`'s return shape is UNCHANGED — it returns `{ workbookId, syncToken }`
ONLY (no id/generation). So the apply RPC takes `p_workbook_id` (not
`p_workbook_generation`) and derives the live `generation` via `SELECT … WHERE workbook_id = …
AND revoked_at IS NULL`. `kal309_seed_sync_state`, `kal309_set_registration_signing_id`, and
`kal309_persist_created_token` likewise take `workbook_id` (or the stable mirror key) and
resolve the row server-side. ALL client-side uses of `registration.id` /
`registration.generation` removed (D.1, D.6, the Edge call).

**R2#4 — conflict-resolve path added (`kal309_resolve_materialization_conflict`).** New
authenticated, `op_uuid`-scoped RPC (A.5 #6) that clears a `client_conflict_review` with
choices keep-app / take-excel / merged(`resolvedFingerprints`), transitions the op out of
conflict-review (`→ resolved`) and sets the marker's state so same-marker ops UNBLOCK and the
frontier can advance past the resolved revision. Wired into the client review surface
(`pendingImportReview` / D.4) via `resolveMaterializationConflict` in `excelSyncClient.js`
(D.1). Without it, a conflict was a permanent frontier blocker.

**Build notes confirmed standing:**
- **F21 (best-effort template whitelist) — still OK for V1.** The entity/checklist-id whitelist
  is structural-always + real-template-when-resolvable; the actor-role wall is the security
  boundary. The open decision (bring `templates` DDL into migrations + FK, or always pass the
  client-resolved config) is unchanged and still flagged.
- **F9 (materialize residual race) — still honestly scoped.** Per-marker READ-MERGE-WRITE under
  an in-process advisory lock with a re-read retry; a concurrent local edit interleaving the
  single-marker Yjs write can still clobber overlaid fields. Accepted for V1; conflict-review +
  reconcile backstop covers it; true field-level CRDT is the KAL-263/270 op-log rebuild.

## Codex build notes (round-3 APPROVED — honor during implementation)
1. In the apply RPC, when deriving the active registration generation from `p_workbook_id`, RE-VERIFY it matches `p_document_id`/`p_template_id` (reject mismatches).
2. `kal309_persist_created_token` must be idempotent and dedupe `writeback_jobs`.
3. For the `take-excel` conflict resolution, ensure reload-safe re-materialize: set the op back to `accepted` OR persist the resolution intent so a reopen re-applies it.
4. Edge tests use the live-verified KAL-308a secret-read pattern exactly (`kal308a_get_signing_secret` → base64 secret string → HMAC).
Accepted V1 risks: F21 best-effort template whitelist; F9 residual in-process Yjs materialize race (covered by conflict-review + reconcile; true field-CRDT is the op-log rebuild).
