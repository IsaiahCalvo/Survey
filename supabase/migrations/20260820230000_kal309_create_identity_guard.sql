-- 20260820230000_kal309_create_identity_guard.sql
-- P2-10 / P2-21: create ops skipped fingerprint dedup and the apply-path field
-- whitelist. Body is the 20260626180000 live definition with the create branch
-- hardened. Unique index is a belt-and-suspenders guard for non-empty fingerprints.

CREATE UNIQUE INDEX IF NOT EXISTS excel_sync_state_identity_fingerprint_uidx
  ON public.excel_sync_state (document_id, template_id, scope_id, identity_vector_fingerprint)
  WHERE identity_vector_fingerprint IS NOT NULL
    AND identity_vector_fingerprint <> '';

CREATE OR REPLACE FUNCTION public.kal308_apply_changeset(p_actor_id uuid, p_document_id uuid, p_template_id text, p_workbook_id text, p_capability_tier text, p_client_change_set_id text, p_request_hash text, p_device_hint text, p_template_config jsonb, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- OUT/declared names never collide with bare column refs in this body, but we keep the
-- column-preference pragma so any future ON CONFLICT/RETURNING bare ref resolves to the
-- column (the ambiguity that bit KAL-308a in live testing).
#variable_conflict use_column
DECLARE
  v_head         BIGINT;
  v_is_editor    BOOLEAN;
  v_reg_gen      INTEGER;            -- R2#3: registration.generation DERIVED from workbook_id
  v_reg_doc      UUID;
  v_reg_tpl      TEXT;
  v_reg_tier     TEXT;               -- Fix 6: capability tier DERIVED from the registration, never the client
  v_reg_drive    TEXT;               -- Fix 6: graph_drive_id from the registration
  v_reg_item     TEXT;               -- Fix 6: graph_item_id from the registration
  v_existing     RECORD;
  v_outcomes     JSONB := '[]'::jsonb;
  v_row          JSONB;
  v_op_type      TEXT;
  v_op_id        TEXT;
  v_scope_id     TEXT;
  v_marker_id    TEXT;
  v_claimed_id   TEXT;
  v_op_uuid      UUID;
  v_state        RECORD;
  v_base_iv      TEXT;
  v_base_fields  JSONB;
  v_active_count INTEGER;
  v_business_ok  BOOLEAN;
  v_id_version   TEXT;
  v_outcome      TEXT;
  v_inserted_uuid UUID;
  v_dup_revision BIGINT;   -- recovered revision of a duplicate op_id within the same change-set
  v_emit_revision BIGINT;  -- revision reported in this row's outcome
  v_changed_keys JSONB;    -- the row's changedFieldKeys array (the merge whitelist)
  v_key          TEXT;     -- loop var over changedFieldKeys / field-fingerprint keys
  v_field_base   TEXT;     -- client-claimed per-field base fingerprint
  v_field_stored TEXT;     -- server-stored per-field fingerprint (excel_sync_state)
  v_payload      JSONB;    -- sanitized (token-stripped) patch payload actually persisted
  v_checklist_id TEXT;     -- checklist id parsed from an 'answer:<id>' changed key
  v_entity_val   TEXT;     -- the patch's changed entity value (validated vs template entity ids)
BEGIN
  -- 0. SERVICE-ROLE GATE (defense in depth).  EXECUTE is service-role-only (grant below).
  --    If a future mis-grant lets an authenticated caller in, fail closed.
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    -- Allow the local/owner test harness (no jwt claim, runs as table owner) through:
    -- only block when a non-service authenticated role claim is explicitly present.
    IF current_setting('request.jwt.claim.role', true) IS NOT NULL THEN
      RAISE EXCEPTION 'kal309: service-role required';
    END IF;
  END IF;

  -- 1. ACTOR ROLE RE-VALIDATION IN-TXN, FIRST (F17, R2#1 — never auth.uid() under service role).
  --    Nothing is read or written for this change-set until the actor is proven editor/owner.
  v_is_editor :=
       EXISTS (SELECT 1 FROM public.document_collaborators dc
                WHERE dc.document_id = p_document_id AND dc.user_id = p_actor_id
                  AND dc.role IN ('editor','owner') AND dc.status = 'active')
    OR EXISTS (SELECT 1 FROM public.documents d
                WHERE d.id = p_document_id AND d.user_id = p_actor_id);
  IF NOT v_is_editor THEN
    -- generation not yet resolved (registration lookup is step 2) → 0 in the audit snapshot.
    INSERT INTO public.excel_sync_audit(document_id, template_id, workbook_generation,
      actor_id, capability_tier, client_change_set_id, row_outcome)
      VALUES (p_document_id, p_template_id, 0, p_actor_id,
              p_capability_tier, p_client_change_set_id, 'unauthorized');
    RETURN jsonb_build_object('error','unauthorized','outcomes','[]'::jsonb);
  END IF;

  -- 2. RESOLVE THE ACTIVE REGISTRATION GENERATION SERVER-SIDE (R2#3 + Codex build note 1).
  --    The client only has {workbookId, syncToken}; it never sends registration.id/generation.
  --    Derive the live generation from workbook_id AND re-verify the registration's
  --    document_id/template_id match the args (build note 1 — reject mismatches).
  -- Fix 6: also pull capability_tier + graph ids from the registration — the SERVER-SIDE
  -- source of truth for the business gate; never trust the client p_capability_tier.
  SELECT r.generation, r.document_id, r.template_id,
         r.capability_tier, r.graph_drive_id, r.graph_item_id
    INTO v_reg_gen, v_reg_doc, v_reg_tpl,
         v_reg_tier, v_reg_drive, v_reg_item
    FROM public.excel_workbook_registrations r
   WHERE r.workbook_id = p_workbook_id AND r.revoked_at IS NULL;   -- workbook_id UNIQUE on active rows (A.1)
  IF NOT FOUND THEN
    INSERT INTO public.excel_sync_audit(document_id, template_id, workbook_generation,
      actor_id, capability_tier, client_change_set_id, row_outcome)
      VALUES (p_document_id, p_template_id, 0, p_actor_id, p_capability_tier,
              p_client_change_set_id, 'unauthorized');
    RETURN jsonb_build_object('error','no_active_registration','outcomes','[]'::jsonb);
  END IF;
  IF v_reg_doc IS DISTINCT FROM p_document_id OR v_reg_tpl IS DISTINCT FROM p_template_id THEN
    -- Codex build note 1: the resolved registration must match the document/template args.
    INSERT INTO public.excel_sync_audit(document_id, template_id, workbook_generation,
      actor_id, capability_tier, client_change_set_id, row_outcome)
      VALUES (p_document_id, p_template_id, v_reg_gen, p_actor_id, v_reg_tier,
              p_client_change_set_id, 'unauthorized');
    RETURN jsonb_build_object('error','workbook_mismatch','outcomes','[]'::jsonb);
  END IF;

  -- 3. DOCUMENT LOCK GATE (Codex #20).  kal49_document_is_locked is auth-independent (UUID arg).
  IF public.kal49_document_is_locked(p_document_id) THEN
    INSERT INTO public.excel_sync_audit(document_id, template_id, workbook_generation,
      actor_id, capability_tier, client_change_set_id, row_outcome)
      VALUES (p_document_id, p_template_id, v_reg_gen, p_actor_id, v_reg_tier,
              p_client_change_set_id, 'locked');
    RETURN jsonb_build_object('error','locked','outcomes','[]'::jsonb);
  END IF;

  -- 4. SERIALIZE ON THE STABLE MIRROR HEAD (F2, F5, R2#1).  Ensure the head row exists, then
  --    LOCK it BEFORE the replay check so concurrent duplicate submits of the same change-set
  --    serialize (the second waits on the lock, then hits the committed replay row in step 5).
  INSERT INTO public.excel_sync_head(document_id, template_id)
    VALUES (p_document_id, p_template_id) ON CONFLICT DO NOTHING;
  SELECT h.excel_revision INTO v_head
    FROM public.excel_sync_head h
   WHERE h.document_id = p_document_id AND h.template_id = p_template_id
   FOR UPDATE;   -- serializes the whole change-set (creates included) against concurrent submits

  -- 5. F7/F19 IDEMPOTENCY / REPLAY CHECK — NOW (AFTER auth + UNDER the head lock, R2#1).
  --    Return the stored blob VERBATIM if this change-set was already processed.
  SELECT cs.outcomes, cs.writeback_jobs, cs.revision_head
    INTO v_existing
    FROM public.excel_sync_changesets cs
   WHERE cs.document_id = p_document_id
     AND cs.template_id = p_template_id
     AND cs.client_change_set_id = p_client_change_set_id;
  IF FOUND THEN
    -- request_hash mismatch is informational only; the stored result still wins
    -- (same change-set id is the contract — F7).  No mint, no head bump, no second insert.
    RETURN jsonb_build_object(
      'revision_head', v_existing.revision_head,
      'outcomes',      v_existing.outcomes,
      'writeback_jobs',v_existing.writeback_jobs,
      'replayed',      true
    );
  END IF;

  -- 6. CONSERVATIVE SHARED-DOC GATE (Decision 8).  If >1 active collaborator AND the
  --    capability tier is not business-with-matching-graph-metadata → route ALL rows to
  --    'review', zero writes, store the change-set outcomes, return.
  -- Fix 6: the business decision uses the SERVER-DERIVED registration tier + graph ids,
  --    NEVER the client-supplied p_capability_tier (which an attacker could set to 'business').
  SELECT count(*) INTO v_active_count
    FROM public.document_collaborators dc
   WHERE dc.document_id = p_document_id AND dc.status = 'active';
  v_business_ok := (v_reg_tier = 'business'
                    AND v_reg_drive IS NOT NULL AND v_reg_drive <> ''
                    AND v_reg_item  IS NOT NULL AND v_reg_item  <> '');
  IF v_active_count > 1 AND NOT v_business_ok THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
      v_op_id     := v_row->>'opId';
      v_op_type   := v_row->>'opType';
      v_claimed_id := v_row->>'markerAnnotationId';
      INSERT INTO public.excel_sync_audit(document_id, template_id, workbook_generation,
        actor_id, capability_tier, client_change_set_id, marker_annotation_id, row_outcome)
        VALUES (p_document_id, p_template_id, v_reg_gen, p_actor_id, v_reg_tier,
                p_client_change_set_id,
                NULLIF(btrim(v_claimed_id), ''),
                'review');
      v_outcomes := v_outcomes || jsonb_build_object(
        'opId', v_op_id, 'markerAnnotationId', v_claimed_id,
        'opType', v_op_type, 'outcome', 'review');
    END LOOP;
    INSERT INTO public.excel_sync_changesets (document_id, template_id, actor_id,
      client_change_set_id, request_hash, outcomes, writeback_jobs, revision_head)
      VALUES (p_document_id, p_template_id, p_actor_id, p_client_change_set_id,
              p_request_hash, v_outcomes, '[]'::jsonb, v_head)
      ON CONFLICT (document_id, template_id, client_change_set_id)
        DO UPDATE SET outcomes = EXCLUDED.outcomes, revision_head = EXCLUDED.revision_head;
    RETURN jsonb_build_object('revision_head', v_head, 'outcomes', v_outcomes,
                              'writeback_jobs', '[]'::jsonb);
  END IF;

  -- 7. PER ROW, in array order.  Accumulate v_outcomes JSONB (token NULL here — the Edge
  --    signs + persists created-row tokens AFTER this commits).
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    v_op_id      := v_row->>'opId';
    v_op_type    := v_row->>'opType';
    v_scope_id   := v_row->>'scopeId';
    v_claimed_id := v_row->>'markerAnnotationId';
    v_outcome    := NULL;
    v_op_uuid    := NULL;

    -- candidateDelete rows → REVIEW ONLY (F10).  No server delete.
    IF v_op_type = 'candidateDelete' THEN
      v_outcome := 'review';

    ELSIF v_op_type = 'apply' THEN
      -- Fix 9: strict UUID parse — UUID-shaped junk no longer aborts the RPC, it routes to review.
      v_marker_id := NULLIF(btrim(v_claimed_id), '');
      IF v_marker_id IS NULL THEN
        v_outcome := 'review';   -- legacy/no-Row-ID/foreign-token/malformed (Decisions 9,12)
      ELSE
        -- PRE-GATE (F13): block any NEW op for a marker with an OPEN client_conflict_review.
        SELECT s.* INTO v_state
          FROM public.excel_sync_state s
         WHERE s.document_id = p_document_id AND s.template_id = p_template_id
           AND s.scope_id = v_scope_id AND s.marker_annotation_id = v_marker_id
         FOR UPDATE;   -- TOCTOU lock on the state row

        IF NOT FOUND THEN
          -- no trusted server baseline (e.g. legacy / not seeded) → review (Decisions 9,12)
          v_outcome := 'review';
        ELSIF v_state.materialization_status = 'client_conflict_review' THEN
          v_outcome := 'review';   -- block-stacking guard (F13)
        ELSE
          v_outcome := 'applied';   -- provisional; the checks below can downgrade it

          -- Fix 2 (round-3): an 'apply' op MUST carry changedFieldKeys as a JSON array — without
          -- a known change set we cannot validate or safely merge.  Missing / non-array → review.
          v_changed_keys := v_row -> 'changedFieldKeys';
          IF v_changed_keys IS NULL OR jsonb_typeof(v_changed_keys) <> 'array' THEN
            v_outcome := 'review';
          ELSE
            -- Fix 5: FIELD-KEY WHITELIST.  changedFieldKeys is the merge whitelist the client
            -- reducer will overlay.  Allowed KEYS: the fixed marker fields + answer/checklist
            -- keys ('answer:<id>').  Anything else → review the whole row.
            -- Fix 3 (round-3): when p_template_config is non-NULL, ALSO validate values against
            -- it — each answer's checklist id must exist in the template, and a changed entity
            -- value must be a template entity id.  When NULL, structural-only (F21 fallback).
            FOR v_key IN SELECT jsonb_array_elements_text(v_changed_keys) LOOP
              IF v_key NOT IN ('changedBy','changedDate','item','entity','notes')
                 AND v_key NOT LIKE 'answer:%'
                 AND v_key NOT LIKE 'answer.%' THEN
                v_outcome := 'review';   -- non-whitelisted key
                EXIT;
              END IF;

              IF p_template_config IS NOT NULL THEN
                -- answer:<checklistItemId> — the checklist id must exist in the template.
                IF v_key LIKE 'answer:%' OR v_key LIKE 'answer.%' THEN
                  v_checklist_id := substr(v_key, position(
                    CASE WHEN v_key LIKE 'answer:%' THEN ':' ELSE '.' END IN v_key) + 1);
                  IF v_checklist_id = '' OR NOT EXISTS (
                    SELECT 1
                      FROM jsonb_array_elements(COALESCE(p_template_config->'modules','[]'::jsonb)) m,
                           jsonb_array_elements(COALESCE(m->'categories','[]'::jsonb)) c,
                           jsonb_array_elements(COALESCE(c->'checklist','[]'::jsonb)) ci
                     WHERE ci->>'id' = v_checklist_id
                  ) THEN
                    v_outcome := 'review';   -- unknown checklist id for this template
                    EXIT;
                  END IF;
                -- entity — a CHANGED entity value must be one of the template's entity ids
                -- (skip when the entity is being cleared to null/empty).
                ELSIF v_key = 'entity' THEN
                  v_entity_val := v_row #>> '{fields,entity}';
                  IF v_entity_val IS NOT NULL AND v_entity_val <> '' AND NOT EXISTS (
                    SELECT 1
                      FROM jsonb_array_elements(COALESCE(p_template_config->'entities','[]'::jsonb)) e
                     WHERE e->>'id' = v_entity_val OR e->>'name' = v_entity_val
                  ) THEN
                    v_outcome := 'review';   -- entity value not in the template
                    EXIT;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;

          IF v_outcome = 'applied' THEN
            -- TOCTOU re-validate Excel-side base fingerprints (Excel-vs-Excel ONLY, F6).
            v_base_iv     := v_row #>> '{baseFingerprints,identityVector}';
            v_base_fields := v_row #> '{baseFingerprints,fields}';
            IF v_base_iv IS NOT NULL
               AND v_base_iv IS DISTINCT FROM v_state.identity_vector_fingerprint THEN
              v_outcome := 'conflict';   -- identity-vector drift since baseline; no write
            ELSIF v_base_fields IS NOT NULL AND jsonb_typeof(v_base_fields) = 'object' THEN
              -- Fix 4: per-field Excel-vs-Excel drift.  For every claimed base field fingerprint,
              -- compare against the server-stored field_fingerprints.  Any mismatch on a field
              -- the client believes it is editing means the Excel side moved under it → stale.
              FOR v_key IN SELECT jsonb_object_keys(v_base_fields) LOOP
                v_field_base   := v_base_fields ->> v_key;
                v_field_stored := v_state.field_fingerprints ->> v_key;
                IF v_field_stored IS NOT NULL
                   AND v_field_base IS DISTINCT FROM v_field_stored THEN
                  v_outcome := 'stale';   -- field-level Excel drift; no write
                  EXIT;
                END IF;
              END LOOP;
            END IF;
          END IF;
        END IF;
      END IF;

    ELSIF v_op_type = 'create' THEN
      -- P2-21: create must pass the same field/template whitelist apply enforces.
      -- Missing changedFieldKeys falls back to the keys of `fields` (a new row
      -- often has no change set). Empty/absent fields is structurally ok.
      v_changed_keys := v_row -> 'changedFieldKeys';
      IF v_changed_keys IS NULL OR jsonb_typeof(v_changed_keys) <> 'array' THEN
        IF jsonb_typeof(v_row -> 'fields') = 'object' THEN
          SELECT COALESCE(jsonb_agg(k), '[]'::jsonb)
            INTO v_changed_keys
            FROM jsonb_object_keys(v_row -> 'fields') AS k;
        ELSE
          v_changed_keys := '[]'::jsonb;
        END IF;
      END IF;

      v_outcome := 'create';
      FOR v_key IN SELECT jsonb_array_elements_text(v_changed_keys) LOOP
        IF v_key NOT IN ('changedBy','changedDate','item','entity','notes')
           AND v_key NOT LIKE 'answer:%'
           AND v_key NOT LIKE 'answer.%' THEN
          v_outcome := 'review';   -- non-whitelisted key
          EXIT;
        END IF;

        IF p_template_config IS NOT NULL THEN
          IF v_key LIKE 'answer:%' OR v_key LIKE 'answer.%' THEN
            v_checklist_id := substr(v_key, position(
              CASE WHEN v_key LIKE 'answer:%' THEN ':' ELSE '.' END IN v_key) + 1);
            IF v_checklist_id = '' OR NOT EXISTS (
              SELECT 1
                FROM jsonb_array_elements(COALESCE(p_template_config->'modules','[]'::jsonb)) m,
                     jsonb_array_elements(COALESCE(m->'categories','[]'::jsonb)) c,
                     jsonb_array_elements(COALESCE(c->'checklist','[]'::jsonb)) ci
               WHERE ci->>'id' = v_checklist_id
            ) THEN
              v_outcome := 'review';   -- unknown checklist id for this template
              EXIT;
            END IF;
          ELSIF v_key = 'entity' THEN
            v_entity_val := v_row #>> '{fields,entity}';
            IF v_entity_val IS NOT NULL AND v_entity_val <> '' AND NOT EXISTS (
              SELECT 1
                FROM jsonb_array_elements(COALESCE(p_template_config->'entities','[]'::jsonb)) e
               WHERE e->>'id' = v_entity_val OR e->>'name' = v_entity_val
            ) THEN
              v_outcome := 'review';   -- entity value not in the template
              EXIT;
            END IF;
          END IF;
        END IF;
      END LOOP;

      IF v_outcome = 'create' THEN
        -- P2-10: reuse the existing marker when this (document, template, scope)
        -- already has the same non-empty identity fingerprint. Empty fingerprints
        -- never match — two blank imports still mint independently.
        v_base_iv := COALESCE(
          v_row #>> '{identityRecord,identityVectorFingerprint}',
          v_row #>> '{baseFingerprints,identityVector}',
          ''
        );
        IF v_base_iv IS NOT NULL AND v_base_iv <> '' THEN
          SELECT s.* INTO v_state
            FROM public.excel_sync_state s
           WHERE s.document_id = p_document_id
             AND s.template_id = p_template_id
             AND s.scope_id = v_scope_id
             AND s.identity_vector_fingerprint = v_base_iv
           ORDER BY s.updated_at ASC
           LIMIT 1
           FOR UPDATE;
          IF FOUND THEN
            v_marker_id := v_state.marker_annotation_id;
            IF v_state.materialization_status = 'client_conflict_review' THEN
              v_outcome := 'review';
            ELSE
              -- Convert create → apply-against-existing (same marker, no second mint).
              v_outcome := 'applied';
              v_op_type := 'apply';
            END IF;
          ELSE
            v_marker_id := gen_random_uuid()::text;
            v_outcome := 'create';
          END IF;
        ELSE
          v_marker_id := gen_random_uuid()::text;
          v_outcome := 'create';
        END IF;
      END IF;

    ELSE
      -- legacy/unknown op_type → review (Decisions 9,12)
      v_outcome := 'review';
    END IF;

    -- ATOMIC for an ACCEPTED apply/create row (F5, all in THIS txn).
    IF v_outcome IN ('applied','create') THEN
      v_head := v_head + 1;

      -- Fix 2: persist a SANITIZED payload (strips assignedToken / token / secret / identityRecord;
      --        KEEPS baseFingerprints + changedFieldKeys for the client's app-vs-Excel check) —
      --        kal309_fetch_since returns patch_payload to clients.
      -- Fix 3: stamp the (minted-for-create) marker id into the payload so every client
      --        materializes the SAME marker id.
      v_payload := public.kal309_sanitize_payload(v_row);
      v_payload := jsonb_set(v_payload, '{markerAnnotationId}', to_jsonb(v_marker_id::text), true);

      INSERT INTO public.excel_sync_ops (
        document_id, template_id, scope_id, workbook_generation, excel_revision,
        op_id, marker_annotation_id, op_type, patch_payload, client_change_set_id, op_status)
        VALUES (
          p_document_id, p_template_id, v_scope_id, v_reg_gen, v_head,
          v_op_id, v_marker_id, v_op_type, v_payload, p_client_change_set_id, 'accepted')
        ON CONFLICT (document_id, template_id, client_change_set_id, op_id) DO NOTHING
        RETURNING op_uuid INTO v_inserted_uuid;

      IF v_inserted_uuid IS NULL THEN
        -- A stray duplicate op_id WITHIN this same change-set (the (…,client_change_set_id,
        -- op_id) idempotency key already has a row): do not double-append and do not consume a
        -- revision.  Roll back the speculative v_head bump and recover the EXISTING op's
        -- op_uuid + revision for the outcome record (use a separate var so the running head
        -- counter is never rewound — that would corrupt later rows' revisions).
        v_head := v_head - 1;
        SELECT o.op_uuid, o.excel_revision, o.marker_annotation_id
          INTO v_op_uuid, v_dup_revision, v_marker_id
          FROM public.excel_sync_ops o
         WHERE o.document_id = p_document_id AND o.template_id = p_template_id
           AND o.client_change_set_id = p_client_change_set_id AND o.op_id = v_op_id;
        v_emit_revision := v_dup_revision;
      ELSE
        v_op_uuid := v_inserted_uuid;
        v_emit_revision := v_head;

        -- Full identity UPSERT into excel_sync_state.
        v_id_version := COALESCE(v_row #>> '{identityRecord,version}', 'v1');
        INSERT INTO public.excel_sync_state (
          document_id, template_id, scope_id, workbook_generation, marker_annotation_id,
          identity_version, origin, last_export_id, was_written_as_row, assigned_token,
          pending_rowid_writeback, last_seen_row_number, last_ingest_seq,
          identity_vector_fingerprint, full_row_fingerprint, field_fingerprints,
          copy_of_marker_id, copy_ordinal,
          last_applied_excel_revision, last_applied_op_uuid,
          materialization_status, op_status, updated_at)
        VALUES (
          p_document_id, p_template_id, v_scope_id, v_reg_gen, v_marker_id,
          v_id_version,
          COALESCE(v_row #>> '{identityRecord,origin}', 'import'),
          v_row #>> '{identityRecord,lastExportId}',
          COALESCE((v_row #>> '{identityRecord,wasWrittenAsRow}')::boolean, FALSE),
          CASE WHEN v_op_type = 'create' THEN NULL
               ELSE v_row #>> '{identityRecord,assignedToken}' END,
          CASE WHEN v_op_type = 'create' THEN TRUE
               ELSE COALESCE((v_row #>> '{identityRecord,pendingRowIdWriteback}')::boolean, FALSE) END,
          NULLIF(v_row #>> '{identityRecord,lastSeenRowNumber}', '')::integer,
          NULLIF(v_row #>> '{identityRecord,lastIngestSeq}', '')::bigint,
          COALESCE(v_row #>> '{identityRecord,identityVectorFingerprint}',
                   v_row #>> '{baseFingerprints,identityVector}', ''),
          COALESCE(v_row #>> '{identityRecord,fullRowFingerprint}', ''),
          COALESCE(v_row #> '{identityRecord,fieldFingerprints}',
                   v_row #> '{baseFingerprints,fields}', '{}'::jsonb),
          v_row #>> '{identityRecord,copyOfMarkerId}',
          NULLIF(v_row #>> '{identityRecord,copyOrdinal}', '')::integer,
          v_head, v_op_uuid, 'accepted', 'accepted', now())
        ON CONFLICT (document_id, template_id, scope_id, marker_annotation_id) DO UPDATE SET
          workbook_generation         = EXCLUDED.workbook_generation,
          identity_version            = EXCLUDED.identity_version,
          origin                      = EXCLUDED.origin,
          last_export_id              = EXCLUDED.last_export_id,
          was_written_as_row          = EXCLUDED.was_written_as_row,
          pending_rowid_writeback     = EXCLUDED.pending_rowid_writeback,
          last_seen_row_number        = EXCLUDED.last_seen_row_number,
          last_ingest_seq             = EXCLUDED.last_ingest_seq,
          identity_vector_fingerprint = EXCLUDED.identity_vector_fingerprint,
          full_row_fingerprint        = EXCLUDED.full_row_fingerprint,
          field_fingerprints          = EXCLUDED.field_fingerprints,
          copy_of_marker_id           = EXCLUDED.copy_of_marker_id,
          copy_ordinal                = EXCLUDED.copy_ordinal,
          last_applied_excel_revision = EXCLUDED.last_applied_excel_revision,
          last_applied_op_uuid        = EXCLUDED.last_applied_op_uuid,
          materialization_status      = 'accepted',
          op_status                   = 'accepted',
          updated_at                  = now();

        INSERT INTO public.excel_sync_audit(document_id, template_id, workbook_generation,
          actor_id, capability_tier, client_change_set_id, marker_annotation_id, row_outcome,
          device_hint)
          VALUES (p_document_id, p_template_id, v_reg_gen, p_actor_id, v_reg_tier,
                  p_client_change_set_id, v_marker_id, v_outcome, p_device_hint);
      END IF;

      v_outcomes := v_outcomes || jsonb_build_object(
        'opId', v_op_id,
        'opUuid', v_op_uuid,
        'markerAnnotationId', v_marker_id::text,
        'opType', v_op_type,
        'outcome', v_outcome,
        'excelRevision', v_emit_revision,
        'writebackPending', (v_op_type = 'create'));

    ELSE
      -- NON-accepted row: audit the outcome, append it, NO ops/state write.
      INSERT INTO public.excel_sync_audit(document_id, template_id, workbook_generation,
        actor_id, capability_tier, client_change_set_id, marker_annotation_id, row_outcome,
        device_hint)
        VALUES (p_document_id, p_template_id, v_reg_gen, p_actor_id, v_reg_tier,
                p_client_change_set_id,
                NULLIF(btrim(v_claimed_id), ''),
                v_outcome, p_device_hint);
      v_outcomes := v_outcomes || jsonb_build_object(
        'opId', v_op_id, 'markerAnnotationId', v_claimed_id,
        'opType', v_op_type, 'outcome', v_outcome);
    END IF;
  END LOOP;

  -- 8. PERSIST THE BUMPED HEAD ONCE (F5, same txn).
  UPDATE public.excel_sync_head SET excel_revision = v_head, updated_at = now()
    WHERE document_id = p_document_id AND template_id = p_template_id;

  -- 9. STORE THE CHANGE-SET OUTCOMES (F7/F19) — the replay authority.  UPSERT so an OPTIONAL
  --    step-5 'processing' placeholder is promoted to the committed result.
  INSERT INTO public.excel_sync_changesets (document_id, template_id, actor_id,
    client_change_set_id, request_hash, outcomes, writeback_jobs, revision_head)
    VALUES (p_document_id, p_template_id, p_actor_id, p_client_change_set_id,
            p_request_hash, v_outcomes, '[]'::jsonb, v_head)
    ON CONFLICT (document_id, template_id, client_change_set_id)
      DO UPDATE SET outcomes = EXCLUDED.outcomes, revision_head = EXCLUDED.revision_head;
    -- writeback_jobs starts empty; the Edge fills it via kal309_persist_created_token (F20).

  -- 10. RETURN.  Outcomes say 'applied'/'create' (accepted), NOT 'materialized' (materialize
  --     is the client's job; F8 ack flips it later).
  RETURN jsonb_build_object(
    'revision_head', v_head,
    'outcomes', v_outcomes,
    'writeback_jobs', '[]'::jsonb);
END;
$function$;
