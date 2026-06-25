# PLAN KAL-309 — concrete, file-level implementation of the KAL-308 keystone

_Turns the Codex-APPROVED design in `PLAN-KAL308.md` into a buildable spec.
KAL-308a shipped (`20260624120000_kal308a_rowid_signing_secrets.sql`,
server-held signing secret + `kal308a_get_or_create_signing_secret` /
`kal308a_get_signing_secret` / `kal308a_has_server_key`). This plan is the
"how", section-by-section: (A) migration, (B) RPC, (C) Edge Function,
(D) client cutover, (E) the riskiest decisions to flag to Codex before coding.
Drafted 2026-06-24. Ground-truth verified against live source — see "Verified
anchors" at the end._

> **Build step 0 (still mandatory, unchanged from KAL-308 Decision 0).** Before
> any of A–D, pin by live browser trace that the open client hydrates markers
> from the `annotationDocSync` Y.Doc (`getSurveyMarkers/applySurveyMarkers` at
> `annotationDocSync.js:360,363`; map `surveyMarkers` at `annotationDocStore.js:71`).
> The client materialize target (D) and the `excelApplied` cursor location both
> depend on it. The server never writes Yjs.

---

## Critique resolutions (adversarial pass 2026-06-24 — these SUPERSEDE conflicting detail below)

**F0 — DISMISSED (false alarm).** KAL-308a IS landed + live-verified (`20260624120000`,
6/6 survey-test integration). The critic read a stale worktree; the intro (lines 4–6) is
correct. The Edge token-verify path via `kal308a_get_signing_secret` + frozen
`signing_doc_id` is real.

**F1 — the three `excel_sync_*` tables FK to `documents(id) ON DELETE CASCADE`, NOT to
the registration row.** KAL-307 revokes + inserts a NEW-generation registration row on
every re-export, so FKing the registration `id` pins state to a revoked generation.
Carry `template_id`, `scope_id`, `workbook_generation` as plain columns; resolve the
active registration by `(document_id, template_id) WHERE revoked_at IS NULL` at apply time.

**F2 — `excel_revision` lives on a dedicated per-mirror head table, NOT on the
registration.** New `excel_sync_head (document_id UUID, template_id TEXT, excel_revision
BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (document_id, template_id))` — survives re-export
(keyed by stable mirror identity, not the swappable generation). The apply RPC locks this
row `FOR UPDATE` + increments. Remove `excel_revision` from `excel_workbook_registrations`.

**F3 + F8 — `marker_annotation_id NOT NULL`; create-ids minted server-side ONCE and
persisted.** For `create` ops the RPC mints `marker_annotation_id := gen_random_uuid()`
BEFORE insert and writes it into `excel_sync_ops.patch_payload` + `excel_sync_state` — so
it's never NULL and never regenerated. "Deterministic" = minted on FIRST apply then frozen;
retries reuse the persisted id (F7). No twin-marker bug.

**F4 — `excel_sync_audit` immutability is TRIGGER-enforced, not RLS/REVOKE.** A SECURITY
DEFINER RPC runs as table owner and bypasses RLS AND privileges. Add a `BEFORE UPDATE OR
DELETE` trigger that `RAISE EXCEPTION`s — structurally immutable even against the owner.
(REVOKE UPDATE/DELETE from PUBLIC too, as defense-in-depth.)

**F5 — revision bump + op insert are ONE atomic step.** After locking `excel_sync_head
FOR UPDATE`, compute each op's `excel_revision` from the locked value and INSERT ops +
bump the head in the SAME transaction. A visible head revision therefore always has its
ops committed (this also closes F12). Never a separate post-insert UPDATE.

**F6 — the server validates the EXCEL side ONLY; the client owns the app-vs-Excel merge.**
Drop any claim the RPC re-validates "app now" — marker values live in Yjs, not a server
table. The RPC validates actor role + registration/token + Excel-side base fingerprint
(client-sent vs stored `excel_sync_state`) = Excel-vs-Excel drift. App-vs-Excel field
conflict is the client materialize reducer's job (two-tier model, PLAN-KAL308 Decision 16).
State this trust boundary plainly.

**F7 — retries are pure no-ops; revision never re-derived on retry.** `INSERT INTO
excel_sync_ops … ON CONFLICT (document_id, template_id, client_change_set_id, op_id) DO
NOTHING`. A replay inserts nothing; the RPC returns prior per-op outcomes read back from
`excel_sync_ops`. `excel_revision` is assigned only on the first (non-conflicting) insert.

**F9 — client materialize is READ-MERGE-WRITE per SINGLE marker (field-level overlay),
NOT a full-map `applySurveyMarkers`.** `syncSurveyMarkersToDoc` whole-object `map.set`s
each changed marker, so a full-map call clobbers concurrent edits. Instead: per accepted
op, read the CURRENT marker, overlay ONLY the op's `changedFields` onto a copy, write back
that ONE marker. Residual race (a concurrent edit between read and write) is accepted for
V1 — the conflict-review + reconcile backstop covers it; true field-level CRDT is the
op-log rebuild (KAL-263/270). FLAG to Codex.

**F10 — deletes stay REVIEW-ONLY (PLAN-KAL308 Decision 10); the materialize never
auto-deletes.** So `origin:'excel-import'` suppressing deletes is CORRECT, not a bug.
`candidateDeletes` route to the existing review surface; the materialize applies only
apply/create ops. Drop the draft's "candidate-delete trashing to materialize" in D.3.

**F11 — `excelApplied:${op_id}` cursor + `fetchSince(sinceRevision)` keyed off the STABLE
head (F2).** A cold client reads the Y.Doc snapshot + the `excelApplied` meta set, skips
any op already in the meta, and fetches missing ops by the stable `excel_sync_head`
revision (not the resettable registration). No replay-from-zero.

**F12 — broadcast fires POST-COMMIT; fetch reads only committed ops; capped backoff.**
The Edge calls the RPC (commits) THEN broadcasts a content-free hint. `fetchSince` reads
`excel_sync_ops` (committed rows only) up to the committed head; F5 guarantees head ≤
committed ops. Re-fetch on a perceived gap uses capped exponential backoff — no infinite loop.

**F13 — `kal309_ack_materialization` cannot un-stick a conflict-review.** Per-op
`op_status` transitions are guarded: `accepted → materialized` only; once
`client_conflict_review`, only the reviewing user's explicit resolution clears it — a late
ack from another client is a no-op (guard in the ack RPC).

**F14 — the matcher guarded-copy drift test runs IN the gate.** Add it to
`scripts/run-node-tests.mjs` so a drift between `src/services/*` and the Edge copy FAILS
the suite, not just an optional script.

**F15 — the Edge matcher copy keeps `.js` extensions, includes `rowIdToken.js`, and HMACs
the EXACT base64 secret string from `kal308a_get_signing_secret`.** (F0 resolved → real.)
Pinned by a round-trip test in the Edge against a known secret.

---

## (A) Migration `supabase/migrations/20260625120000_kal309_excel_sync.sql`

Three new tables + two additive touches to `excel_workbook_registrations`. All
new tables: **RLS enabled, REVOKE ALL from authenticated/anon, zero client
policies — service-role + SECURITY DEFINER RPCs only** (mirrors the 308a table,
`20260624120000:54-55`). `CREATE EXTENSION IF NOT EXISTS pgcrypto;` at top; all
crypto via `extensions.*` under `SET search_path = ''` (KAL-307 lesson,
`20260611120000:116,181-189`).

### A.1 Additive touches to `excel_workbook_registrations` (Decision 5, 6)

```sql
-- (i) Decision 6: workbook_id must be UNIQUE before the Edge looks up by it.
--     Today it is only a plain index (20260611120000:63-64). Partial-unique on
--     ACTIVE rows only — revoked rows keep old workbook_ids for audit.
CREATE UNIQUE INDEX IF NOT EXISTS excel_workbook_registrations_workbook_id_active_uniq
  ON public.excel_workbook_registrations (workbook_id)
  WHERE revoked_at IS NULL;

-- (ii) Decision 1: store the FROZEN canonical signing-id captured at register/
--      export. This duplicates rowid_signing_secrets.signing_doc_id but lets the
--      Edge resolve registration→signing-id in one read without a second lookup.
--      Populated by the client at register time (see D); NULL on legacy rows
--      forces re-export (308a legacy-preflight).
ALTER TABLE public.excel_workbook_registrations
  ADD COLUMN IF NOT EXISTS rowid_signing_doc_id TEXT;

-- (iii) Decision 5: per-registration monotonic revision head. The apply RPC locks
--       this FOR UPDATE to serialize a whole change-set (incl. creates) and is the
--       fetch-since cursor. Default 0 = no ops applied yet.
ALTER TABLE public.excel_workbook_registrations
  ADD COLUMN IF NOT EXISTS excel_revision BIGINT NOT NULL DEFAULT 0;
```

> Boundary note: the `kal307_register_workbook` RPC signature + return shape are
> UNCHANGED (PLAN-KAL308 DO NOT CHANGE). `rowid_signing_doc_id` is set by a tiny
> separate additive setter RPC (A.5) the client calls post-register, OR folded
> into the export path — NOT by editing kal307's body.

### A.2 `excel_sync_state` — latest-per-marker identity (Decision 4)

Mirrors the `excelSync` identity record EXACTLY
(`excelIdentityRecord.js:38-73`) + apply bookkeeping + materialization status.
Keyed by registration FK + template + scope + marker (NOT bare workbook_generation).

```sql
CREATE TABLE IF NOT EXISTS public.excel_sync_state (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id                UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  workbook_registration_id   UUID        NOT NULL REFERENCES public.excel_workbook_registrations(id) ON DELETE CASCADE,
  template_id                TEXT        NOT NULL,
  scope_id                   TEXT        NOT NULL,
  marker_annotation_id       TEXT        NOT NULL,

  -- excelSync identity record (excelIdentityRecord.js:38-73), 1:1 column mapping
  identity_version           TEXT        NOT NULL,           -- record.version
  origin                     TEXT        NOT NULL,           -- 'import' | 'export'
  last_export_id             TEXT,                           -- record.lastExportId
  was_written_as_row         BOOLEAN     NOT NULL DEFAULT FALSE,
  assigned_token             TEXT,                           -- the signed Row-ID (sensitive → never returned to clients)
  pending_rowid_writeback    BOOLEAN     NOT NULL DEFAULT FALSE,
  last_seen_row_number       INTEGER,                        -- positional memory
  last_ingest_seq            BIGINT,
  identity_vector_fingerprint TEXT       NOT NULL,
  full_row_fingerprint       TEXT        NOT NULL,
  field_fingerprints         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  copy_of_marker_id          TEXT,
  copy_ordinal               INTEGER,

  -- apply bookkeeping (Decision 0/4)
  last_applied_excel_revision BIGINT     NOT NULL DEFAULT 0,
  last_applied_op_id         TEXT,
  materialization_status     TEXT        NOT NULL DEFAULT 'accepted'
                               CHECK (materialization_status IN
                                 ('accepted','materialized','client_conflict_review')),

  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- one state row per marker within a registration scope (the UPSERT target +
  -- the FOR UPDATE TOCTOU lock key in the RPC)
  UNIQUE (workbook_registration_id, template_id, scope_id, marker_annotation_id)
);

CREATE INDEX IF NOT EXISTS excel_sync_state_reg_template_idx
  ON public.excel_sync_state (workbook_registration_id, template_id);
CREATE INDEX IF NOT EXISTS excel_sync_state_marker_idx
  ON public.excel_sync_state (marker_annotation_id);
CREATE INDEX IF NOT EXISTS excel_sync_state_doc_idx
  ON public.excel_sync_state (document_id);
```

### A.3 `excel_sync_ops` — ordered accepted-op log (Decision 16) — the fetch-since source

```sql
CREATE TABLE IF NOT EXISTS public.excel_sync_ops (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id                UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  workbook_registration_id   UUID        NOT NULL REFERENCES public.excel_workbook_registrations(id) ON DELETE CASCADE,
  excel_revision             BIGINT      NOT NULL,           -- the head value AFTER this op (monotonic per registration)
  op_id                      TEXT        NOT NULL,           -- stable per-row op id within a change set
  marker_annotation_id       TEXT        NOT NULL,
  op_type                    TEXT        NOT NULL CHECK (op_type IN ('apply','create')),
  -- field-level patch the client reducer merges; carries EVERYTHING the client's
  -- final app-vs-Excel check needs (build-note #5): {fields:{...}, changedFieldKeys:[...],
  -- baseFingerprints:{...}, markerAnnotationId, opId, excelRevision}. NO tokens.
  patch_payload              JSONB       NOT NULL,
  client_change_set_id       TEXT        NOT NULL,
  op_status                  TEXT        NOT NULL DEFAULT 'accepted'   -- build-note #1: per-op history
                               CHECK (op_status IN ('accepted','materialized','client_conflict_review','resolved')),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- idempotency: a replayed change-set row can never double-append
  UNIQUE (workbook_registration_id, client_change_set_id, op_id),
  -- one op per revision per registration (the fetch-since ordering key)
  UNIQUE (workbook_registration_id, excel_revision)
);

CREATE INDEX IF NOT EXISTS excel_sync_ops_fetch_since_idx
  ON public.excel_sync_ops (workbook_registration_id, excel_revision);
CREATE INDEX IF NOT EXISTS excel_sync_ops_marker_idx
  ON public.excel_sync_ops (marker_annotation_id);
```

### A.4 `excel_sync_audit` — content-free, immutable (Decision 7)

```sql
CREATE TABLE IF NOT EXISTS public.excel_sync_audit (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id                UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  workbook_registration_id   UUID        NOT NULL REFERENCES public.excel_workbook_registrations(id) ON DELETE CASCADE,
  actor_id                   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  capability_tier            TEXT        NOT NULL,
  client_change_set_id       TEXT        NOT NULL,
  marker_annotation_id       TEXT,                              -- nullable: change-set-level rows
  row_outcome                TEXT        NOT NULL,              -- applied|conflict|stale|unauthorized|review|create|locked
  device_hint                TEXT,
  server_ts                  TIMESTAMPTZ NOT NULL DEFAULT now() -- AUTH-03: server clock, never client
  -- NO row content. No item/notes/entity/answers. No token.
);

CREATE INDEX IF NOT EXISTS excel_sync_audit_doc_ts_idx
  ON public.excel_sync_audit (document_id, server_ts DESC);
```

### A.5 RLS + grants for all three tables, plus the fetch-since + ack + signing-id setter RPCs

```sql
ALTER TABLE public.excel_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.excel_sync_ops   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.excel_sync_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.excel_sync_state, public.excel_sync_ops, public.excel_sync_audit
  FROM authenticated, anon;
-- Zero policies = default-deny for client roles. Audit immutability is structural:
-- no UPDATE/DELETE policy exists for ANYONE, and the only writer (the RPC, SECURITY
-- DEFINER) only ever INSERTs. KAL-310 surfaces it read-only; never relaxes this.
```

RPCs created in this migration (besides the keystone B):

1. **`kal309_set_registration_signing_id(p_registration_id UUID, p_signing_doc_id TEXT)`**
   — SECURITY DEFINER, `auth.uid()` not null + `user_can_access_document(document_id,'editor')`,
   sets `rowid_signing_doc_id` only if currently NULL (freeze-once). `GRANT EXECUTE … TO authenticated`.
2. **`kal309_fetch_since(p_document_id UUID, p_workbook_registration_id UUID, p_since_revision BIGINT)`**
   — SECURITY DEFINER, viewer-gated read, returns `excel_sync_ops` rows for that
   registration with `excel_revision > p_since_revision` ascending. **Scoped by
   `workbook_registration_id`** (build-note #2 — `document_id + since_revision` is
   ambiguous with multiple template registrations). **Redacted: returns
   `op_id, excel_revision, marker_annotation_id, op_type, patch_payload, op_status`
   — never `assigned_token`** (the patch_payload itself is token-free by construction
   in B). `GRANT EXECUTE … TO authenticated`.
3. **`kal309_ack_materialization(p_document_id UUID, p_op_id TEXT, p_marker_annotation_id TEXT, p_status TEXT)`**
   — SECURITY DEFINER (build-note #4: only this wrapper touches the service-role
   surface; clients never hold it). Editor-gated. `p_status ∈
   {materialized, client_conflict_review}`. Updates the matching `excel_sync_ops.op_status`
   and the `excel_sync_state.materialization_status` for that marker. `GRANT EXECUTE … TO authenticated`.

> NB: `kal309_ack_materialization` is callable by `authenticated` AND re-checks
> the role inside; it is the "authenticated wrapper" build-note #4 asks for. It is
> NOT the service-role-only keystone RPC.

---

## (B) The keystone RPC `kal308_apply_changeset` (in the same migration A)

```sql
CREATE OR REPLACE FUNCTION public.kal308_apply_changeset(
  p_actor_id                 UUID,        -- validated actor, passed explicitly (NOT auth.uid())
  p_document_id              UUID,
  p_workbook_registration_id UUID,
  p_capability_tier          TEXT,
  p_client_change_set_id     TEXT,
  p_device_hint              TEXT,
  p_rows                     JSONB        -- ordered array of row decisions (shape below)
)
RETURNS JSONB                              -- { revision_head, outcomes:[{op_id, marker_annotation_id, outcome, ...}] }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_head        BIGINT;
  v_is_editor   BOOLEAN;
  ...
BEGIN
  -- 0. EXECUTE is service-role-only (grant below). Defense in depth: also assert
  --    the caller is service_role here so a future mis-grant can't slip through.

  -- 1. Re-validate actor role IN-TXN (Codex #6 — never auth.uid() under service role).
  v_is_editor := public.user_can_access_document(p_document_id, 'editor');
  IF NOT v_is_editor THEN
    -- record one change-set-level audit row with row_outcome='unauthorized', return it
    RETURN jsonb_build_object('error','unauthorized', ...);
  END IF;

  -- 2. Document lock gate (Codex #20).
  IF public.kal49_document_is_locked(p_document_id) THEN
    RETURN jsonb_build_object('error','locked', ...);   -- audit row_outcome='locked', zero writes
  END IF;

  -- 3. Idempotency short-circuit (Codex #11): if any excel_sync_ops row already
  --    exists for (workbook_registration_id, client_change_set_id), this is a replay
  --    → re-read its prior op rows + return prior outcomes. No double-apply.

  -- 4. Serialize on the registration head (Codex r2 #8). FIRST lock, so creates
  --    (which have no excel_sync_state row yet) are serialized against concurrent
  --    submissions for the same workbook.
  SELECT excel_revision INTO v_head
    FROM public.excel_workbook_registrations
   WHERE id = p_workbook_registration_id AND revoked_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','no_active_registration', ...); END IF;

  -- 5. Conservative shared-doc gate (Decision 8): if active collaborators > 1 AND
  --    capability_tier is not business-with-matching-graph-metadata → route ALL rows
  --    to 'review', zero writes. (NOT KAL-311's full registry gate.)

  -- 6. Per row, in array order:
  FOR each row IN p_rows LOOP
    --   a. op_type='apply':
    --      • SELECT … FOR UPDATE the excel_sync_state row by
    --        (workbook_registration_id, template_id, scope_id, marker_annotation_id).
    --      • TOCTOU re-validate (Codex #4): compare stored base fingerprints
    --        (identity_vector_fingerprint / field_fingerprints) against the row's
    --        claimed base in the change set. Drift → outcome 'conflict'/'stale', NO write.
    --        (This is the Excel-vs-Excel tier ONLY. App-vs-Excel is the client's job.)
    --      • Field whitelist (Codex #18): accept ONLY mapped marker fields
    --        (item/name, entity, notes, answers:{checklistItemId}). Validate entity id
    --        + checklist-item ids against the template arg. Ignore Excel audit columns.
    --   b. op_type='create':
    --      • Mint marker_annotation_id := gen_random_uuid() (Codex r3 #6 — deterministic,
    --        embedded in patch_payload so every client materializes the SAME marker).
    --      • Return a Row-ID writeback job (Decision 11): pending_rowid_writeback=TRUE.
    --   c. candidateDelete rows → outcome 'review' only (Decision 10). No server delete.
    --   d. legacy/no-Row-ID/schema-diff/foreign-token rows → outcome 'review' (Decisions 9,12).

    --   e. ATOMIC for an accepted apply/create row:
    --      v_head := v_head + 1;
    --      INSERT INTO excel_sync_ops (..., excel_revision=v_head, op_id, marker_annotation_id,
    --        op_type, patch_payload, client_change_set_id, op_status='accepted');
    --      INSERT … ON CONFLICT (workbook_registration_id, template_id, scope_id,
    --        marker_annotation_id) DO UPDATE  -- full identity UPSERT into excel_sync_state,
    --        materialization_status='accepted', last_applied_excel_revision=v_head,
    --        last_applied_op_id=op_id;
    --      INSERT INTO excel_sync_audit (..., row_outcome='applied'/'create', server_ts=now());
  END LOOP;

  -- 7. Persist the bumped head once.
  UPDATE public.excel_workbook_registrations
     SET excel_revision = v_head WHERE id = p_workbook_registration_id;

  -- 8. Return { revision_head: v_head, outcomes: [...] }. Outcomes say
  --    'accepted' for applied/created rows — NOT 'materialized' (build-note #6).
END;
$$;

-- Service-role ONLY (Codex #5). Clients reach it only via the Edge Function.
REVOKE ALL ON FUNCTION public.kal308_apply_changeset(UUID,UUID,UUID,TEXT,TEXT,TEXT,JSONB)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.kal308_apply_changeset(UUID,UUID,UUID,TEXT,TEXT,TEXT,JSONB)
  TO service_role;
```

**Patch payload contract (build-note #5) — what each `excel_sync_ops.patch_payload` holds:**
```jsonc
{
  "markerAnnotationId": "...",     // minted for create
  "opId": "...",
  "excelRevision": 42,
  "opType": "apply",
  "fields": { "item": "...", "entity": "...|null", "notes": "...",
              "answers": { "<checklistItemId>": "..." } },
  "changedFieldKeys": ["entity", "notes", "answer:<id>"],   // matcher's excelChangedFields
  "baseFingerprints": { "identityVector": "...", "fields": { "...": "..." } },
  "scopeId": "...", "templateId": "..."
  // NO assigned_token, NO secret.
}
```
The whole-marker write is FORBIDDEN: `changedFieldKeys` is the merge whitelist the
client reducer (D.3) applies field-by-field, preserving concurrent app edits to
untouched fields (Codex r2 #6).

---

## (C) Edge Function `supabase/functions/excel-apply-changeset/index.ts`

Follows the existing function shape (`send-email/index.ts`: `Deno.serve`,
`auth.getUser`, `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`). esm.sh imports with
`?target=deno`.

```
supabase/functions/excel-apply-changeset/
├── index.ts
└── services/                      # GUARDED COPY (deno-matcher Option B) of:
    ├── rowIdToken.js              #   the 6 matcher files, byte-identical to src/services/*
    ├── rowFingerprint.js
    ├── excelConflictDetect.js
    ├── excelIdentityRecord.js
    ├── rowImportMatcher.js
    └── buildScopeImportPlans.js
```

**Why guarded copy, not relative import:** Deno Edge Functions are isolated module
contexts; `../../../src/services/*.js` is not reliably resolvable at deploy. Sync
the copy via a pre-deploy script + a drift test (Decision 13). All 6 files are
Deno-portable as-is (SubtleCrypto + TextEncoder only; no Node/browser deps).

**Sync script** `scripts/sync-matcher-to-edge.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
SRC=src/services; DST=supabase/functions/excel-apply-changeset/services
mkdir -p "$DST"
cp "$SRC"/{rowIdToken,rowFingerprint,excelConflictDetect,excelIdentityRecord,rowImportMatcher,buildScopeImportPlans}.js "$DST/"
```
Add a node test `tests/excel-edge-matcher-drift.test.mjs` that diffs each pair and
fails on mismatch (KAL-307 inline-copy lesson). Wire into `run-node-tests.mjs`.

**`index.ts` request flow:**
```ts
Deno.serve(async (req) => {
  // 1. AUTH — Authorization: Bearer JWT → anonClient.auth.getUser(token); reject anon.
  //    (send-email/index.ts:11 pattern; reference_edge_function_auth_pattern.)
  // 2. ROLE — service-role client: user_can_access_document(document_id,'editor')
  //    via .rpc(); reject viewer/none with 403 (defense in depth — RPC re-checks too).
  // 3. REGISTRATION + TOKEN VERIFY:
  //    • Look up active registration by workbook_id (now UNIQUE — A.1).
  //    • Resolve canonical signing id := registration.rowid_signing_doc_id (Decision 1);
  //      if NULL → 409 'legacy-unsigned, re-export required' (308a legacy-preflight).
  //    • Resolve secret via kal308a_get_signing_secret(document_id) (service-role).
  //    • Build resolveSecret(keyId) → secret_b64 string. Pass to the matcher so
  //      classifyRowIdToken verifies each Row-ID against the STORED signing id —
  //      never a client-supplied documentId. Token mismatch → that row → 'review'.
  //    • Business tier: best-effort graph_drive_id/graph_item_id equality only
  //      (NOT a server-proven Graph read — Codex r2 #15).
  // 4. RUN MATCHER — buildScopeImportPlans({ worksheetDataList, surveyMarkers (from req),
  //      templateToUse, documentId: signing_doc_id, resolveSecret,
  //      appValuesByMarkerId (from req), ingestSeq }) → scopePlans (Map).
  //    Note: surveyMarkers + appValuesByMarkerId come from the CLIENT in the request
  //    body — the server cannot read live Yjs (per Decision 0). The server's tier is
  //    actor-role + Row-ID verify + Excel-vs-Excel drift, NOT app-vs-Excel.
  // 5. FLATTEN decisions → p_rows JSONB (apply/create/review/candidate-delete), preserving
  //    order; attach matcher's changedFields → changedFieldKeys and base fingerprints.
  // 6. CALL RPC — serviceClient.rpc('kal308_apply_changeset', { p_actor_id: user.id, ... }).
  //    The RPC RE-VALIDATES (role, lock, TOCTOU, whitelist) — Edge checks are advisory.
  // 7. BROADCAST a content-free HINT on channel `yjs:${documentId}`, event
  //    'excel_sync_applied', payload { documentId, workbookRegistrationId, revisionHead }.
  //    (SupabaseYjsProvider.js sendBroadcast pattern; NO row content; under 600KB cap.)
  // 8. RETURN per-row outcomes JSON to the submitter (applied=accepted / conflict /
  //    stale / unauthorized / review / create-with-writeback-job). Cap rows-per-set +
  //    cell sizes; rate-limit per actor/document/workbook (Decision 15).
});
```

**Observability (Decision 14):** structured content-free logs — auth pass/fail,
token-verify outcome counts, conflict/stale/review tallies, apply latency, replay
hits. No row content ever in logs.

---

## (D) Client cutover

Touches the import-apply call site ONLY in `src/PDFViewer.jsx` (two paths: manual
import ~`13680`, auto-sync ~`14302`). Zoom/canvas/render invariants untouched.

### D.1 New service `src/services/excelSyncClient.js`

- `submitChangeSet({ documentId, workbookRegistrationId, capabilityTier,
  worksheetDataList, surveyMarkers, appValuesByMarkerId, ingestSeq, clientChangeSetId })`
  → `supabase.functions.invoke('excel-apply-changeset', { body })`. `clientChangeSetId`
  = `crypto.randomUUID()` per submission (idempotency key; persist for retry so a retry
  reuses the SAME id).
- `fetchSince({ documentId, workbookRegistrationId, sinceRevision })`
  → `supabase.rpc('kal309_fetch_since', …)`.
- `ackMaterialization({ documentId, opId, markerAnnotationId, status })`
  → `supabase.rpc('kal309_ack_materialization', …)`.

### D.2 Build the change set from the EXISTING import flow (do NOT re-implement matching)

At the PDFViewer call site, the client currently runs `buildScopeImportPlans`
locally then applies decisions inline (`13680-14019`). The cutover: keep the local
run for the UI preview, but instead of applying inline, **package the raw inputs**
(`worksheetDataList`, `newSurveyMarkers` as `surveyMarkers`,
`buildAppValuesByMarkerId(...)`, `ingestSeq`) and send them to the Edge via
`submitChangeSet`. The server is the authority; the local plan is advisory/preview
only. The per-row apply/create writes at `13751-13948` are REMOVED from the
authoritative path — replaced by materializing accepted ops (D.3).

### D.3 Materialize accepted ops via field-level `applySurveyMarkers`

On the Edge response (and on every `fetchSince` page), run the **idempotent reducer**:
```js
// for each op in ascending excel_revision:
//   if excelAppliedMap.has(op.op_id) → skip (already materialized; Decision 0 ledger)
//   load current marker := annotationDocSync.getSurveyMarkers()[op.markerAnnotationId]
//   FINAL app-vs-Excel check (client tier): for each key in op.changedFieldKeys, if the
//     live marker field differs from op.baseFingerprints AND from op.fields → genuine
//     app-vs-Excel conflict → ackMaterialization(status:'client_conflict_review'); skip write.
//   else merge ONLY op.changedFieldKeys into the marker (field-level; never whole-marker):
//     next = structuredClone(current); apply item/entity/notes/answers[changedKeys];
//     stamp next.excelSync from op identity; (create → next is a new marker with minted id)
//     annotationDocSync.applySurveyMarkers({ [id]: next }, { origin: 'excel-import' });
//     setMetaValue(doc, `excelApplied:${op.op_id}`, { revision, at: Date.now() }, 'excel-import');
//     ackMaterialization(status:'materialized');
```
`applySurveyMarkers` with `origin:'excel-import'` is minimal-diff
(`annotationDocStore.js:102` `syncSurveyMarkersToDoc`) and still persists durably
(origin passes the `update` observer at `annotationDocSync.js:158` → enqueueAppend +
snapshot). `origin:'excel-import'` only disables deletion of omitted keys — NOT
persistence.

**`excelApplied` cursor in Yjs (Decision 0 / build-note in 308):** store per-op
applied markers in the existing `META_MAP` (`annotationDocStore.js:23,54`) keyed
`excelApplied:${op_id}` via `setMetaValue`. A fresh/lost-cursor client replays
`fetchSince(0)` and the reducer skips any op already in `excelApplied` meta — no
clobber of newer app edits. (Build step 0 confirms this is the same Y.Doc the open
client hydrates markers from.)

### D.4 Reconcile path (convergence + offline recovery)

- Subscribe the open client to the `excel_sync_applied` broadcast (new handler in
  `SupabaseYjsProvider.js`, pattern shown in the realtime findings: `.on('broadcast',
  { event: 'excel_sync_applied' }, …)`). On hint → call `fetchSince(localCursor)` →
  run the D.3 reducer → advance cursor; on failure retry capped backoff.
- On document open, `fetchSince(persistedCursor)` replays any ops missed offline.
  Persisted cursor = max `excel_revision` in the `excelApplied` meta (or a
  per-document local cursor for the fast path).
- Block-stacking guard (build-note #3): if a marker has an open
  `client_conflict_review` op, hold later ops for that marker in review rather than
  applying on top of an unresolved conflict.

### D.5 Row-ID writeback (Decision 11)

Server-created rows return verified writeback jobs (token + pending). The client
flushes them via the existing `rowIdWritebackQueue`;
`excel_sync_state.pending_rowid_writeback` tracks completion (cleared via a future
ack — out of this slice's write path, surfaced only).

---

## (E) The 4–6 riskiest decisions to flag to Codex BEFORE coding

1. **`assigned_token` leakage surface.** It lives in `excel_sync_state` (sensitive
   Row-ID secret material). The plan keeps it out of `excel_sync_ops.patch_payload`
   and `kal309_fetch_since` by construction — but the reducer needs the token for
   writeback. Confirm the token reaches the client ONLY through the dedicated
   writeback-job channel (D.5 / the Edge response), never via `fetch_since`, and that
   `fetch_since`'s SELECT physically cannot project it. **A single accidental
   `SELECT *` defeats Decision 4's "no client read of tokens."**

2. **Determinism of create-id minting vs. the idempotency replay.** Creates mint
   `gen_random_uuid()` inside the RPC. On a replay of the same `client_change_set_id`,
   step 3 must return the PRIOR minted ids from `excel_sync_ops`, not mint new ones —
   otherwise a retried submit spawns duplicate markers on every client. Verify the
   replay short-circuit reads minted ids back from the op log BEFORE the per-row loop
   can mint again.

3. **`excel_revision` as both per-registration head AND global op ordering.** The
   `UNIQUE (workbook_registration_id, excel_revision)` on `excel_sync_ops` assumes one
   op per revision per registration. The RPC increments `v_head` per accepted row, so a
   10-row change set consumes revisions N+1..N+10. Confirm fetch-since ordering + the
   client cursor semantics are per-registration (build-note #2) and that a partially-
   rejected change set (some rows conflict) does not leave revision GAPS the client
   treats as "missing ops" and infinitely re-fetches.

4. **Two-tier conflict split correctness.** The server only sees client-supplied
   `surveyMarkers`/`appValuesByMarkerId` (it cannot read Yjs). So the server's TOCTOU
   check is Excel-vs-stored-fingerprint ONLY; the authoritative app-vs-Excel check is
   the client reducer (D.3). Flag the trust assumption: a malicious editor could send a
   doctored `appValuesByMarkerId` to dodge a conflict — but since the actor is an
   authorized editor with full write rights anyway, the actor-role wall (not the
   conflict check) is the security boundary. Confirm Codex agrees this is acceptable
   for V1 and that the client-side final check is purely a data-safety (not security)
   mechanism.

5. **Materialization ack races.** Two open clients both materialize the same op and
   both call `kal309_ack_materialization`. The op flips accepted→materialized twice;
   one may flip it to `client_conflict_review` while the other says `materialized`.
   Define the precedence (conflict-review should win / be sticky per build-note #3) and
   confirm the ack RPC's status transition is monotonic, not last-writer-wins.

6. **Guarded-copy drift + Deno bundle smoke test (Decision 13).** Six matcher files
   are copied into the Edge function. Flag that the drift test
   (`excel-edge-matcher-drift.test.mjs`) and a Deno import/deploy smoke test (the Edge
   bundle actually loads `buildScopeImportPlans` and runs one fixture) are BOTH
   required gates — a silent drift between `src/services` and the Edge copy reintroduces
   the exact class of bug the KAL-307 inline-copy lesson warns about.

---

## Acceptance criteria (inherited from KAL-308, mapped to this plan's artifacts)

All of PLAN-KAL308's acceptance bullets apply unchanged. Per-artifact mapping:
editor-applies-durably → B step 6e + D.3 + browser second-client check;
viewer-rejected → C step 2 + B step 1; idempotent → B step 3 + the two UNIQUEs in
A.3; TOCTOU → B step 6a; app-vs-Excel both-changed → D.3 `client_conflict_review`;
forged token → C step 3 → 'review'; shared-doc non-business → B step 5; locked doc
→ B step 2; create writeback → B step 6b + D.5; broadcast-fails recovery → D.4;
gates → `npx vite build` + `node scripts/run-node-tests.mjs` clean (report baseline
first).

## Verification

- Migration + RPC: integration tests on **survey-test only** (never production —
  `survey_test_supabase_project`), mirroring the KAL-307 harness, covering TOCTOU,
  idempotency/replay, viewer-reject, forged-token, shared-doc, lock, create-id-replay.
- Matcher parity: ported Edge copy ≡ in-app decisions on shared fixtures + the drift
  test + the Deno bundle smoke test.
- Convergence + reconcile: browser-verified multi-client (`verify_in_app_before_reporting`,
  `adversarial_verify_realtime` ≥2 passes + code review on the realtime path).
- Latency p95 measured + recorded.

## DO NOT CHANGE (boundaries — inherited)

- `PLAN.md`, `PLAN-EXCEL-SECURITY-V1.md`, `PLAN-KAL308.md` — governing contracts.
- Matcher BEHAVIOR (`rowImportMatcher.js`, `buildScopeImportPlans.js`,
  `excelConflictDetect.js`, `rowFingerprint.js`, `rowIdToken.js`) — the Edge gets a
  byte-identical COPY; no behavior edits. KAL-308a already moved the secret.
- `kal307_register_workbook` RPC signature + return — UNCHANGED; only additive
  columns/indices on its table (A.1).
- Standing high-risk files (`PDFViewer.jsx`, `PageAnnotationLayer.jsx`,
  `viewerShared.js`, Fabric canvases, `SVGAnnotationLayer.jsx`) — cutover touches the
  import-apply call site in PDFViewer ONLY; container-aware sizing, `zoomGeneration`,
  SVG-viewBox invariants untouched.
- Production Supabase — read-only; migration lands on survey-test; production apply is
  a separate owner-gated batch.
- Out-of-slice: KAL-310/311/312/314, Excel add-in (V2), server-side Yjs authority.

---

## Verified anchors (ground-truth at draft time, 2026-06-24)

- `excelIdentityRecord.js:38-73` — `buildMarkerIdentityRecord` returns exactly
  `{version, origin, lastExportId, wasWrittenAsRow, assignedToken,
  pendingRowidWriteback, lastSeenRowNumber, lastIngestSeq, identityVectorFingerprint,
  fullRowFingerprint, fieldFingerprints}` → A.2 column mapping.
- `rowIdToken.js` exports `generateRowIdToken` (115), `parseRowIdToken` (135),
  `verifyRowIdSignature` (171), `classifyRowIdToken` (190) → C step 3 verify path.
- `buildScopeImportPlans.js:76-95` — async, params `{worksheetDataList, surveyMarkers,
  templateToUse, documentId, resolveSecret, appValuesByMarkerId, ingestSeq, logger}`
  → C step 4 invocation.
- `annotationDocStore.js:71,73,78,102` — `SURVEY_MARKERS_MAP='surveyMarkers'`,
  `getSurveyMarkersMap`, `docToSurveyMarkers`, `syncSurveyMarkersToDoc` (minimal-diff,
  origin-gated, `allowDeletes = origin !== 'excel-import'`) → D.3.
- `annotationDocStore.js:23,46,54` — `META_MAP='annoMeta'`, `getMetaValue`,
  `setMetaValue` → `excelApplied` cursor in D.3.
- `annotationDocSync.js:158,360,363` — observer skips `REMOTE/HYDRATE/idb` origins
  (so `'excel-import'` DOES persist), `getSurveyMarkers`, `applySurveyMarkers(markers,
  opts)` → D.3.
- `20260624120000_kal308a_rowid_signing_secrets.sql` — `kal308a_get_signing_secret`
  (read, editor-gated) + frozen `signing_doc_id` → C step 3.
- `20260611120000_kal307_workbook_registrations.sql:56-64` — `workbook_id` currently
  PLAIN index (A.1 adds UNIQUE); `excel_revision`/`rowid_signing_doc_id` absent (A.1
  adds). RPC body uses `extensions.gen_random_bytes/digest` under `search_path=''`.
- `20260522000000_kal49_document_lock_state.sql:39` — `kal49_document_is_locked(UUID)`
  → B step 2.
- `20260521000000_kal31_remove_commenter_role.sql` — `user_can_access_document(doc,role)`
  → B step 1, C step 2.
- `send-email/index.ts` — `Deno.serve`, `auth.getUser`,
  `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`, esm.sh imports → C shape.
- `SupabaseYjsProvider.js` — channel `yjs:${documentId}`, `sendBroadcast(channel,
  event, payload)`, `.on('broadcast', {event}, …)`, 600KB cap → C step 7, D.4.
- `PDFViewer.jsx:89,13564,13680,13683,13995,14302,14305,14629,14238` — matcher import,
  `buildAppValuesByMarkerId`, the two `buildScopeImportPlans` call sites,
  `candidateDeletes`, `setPendingImportReview` → D.2 cutover targets.
