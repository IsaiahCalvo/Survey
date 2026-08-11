-- KAL-431: 30-day Archive auto-cleanup.
--
-- KAL-426 built the Archive: deleting a document, project or template moves it
-- there with a `user_archive_expires_at` 30 days out, and `purge_archived_*`
-- permanently removes one item. Nothing ever ran those purges, so expired items
-- sat in the Archive forever. This migration adds the sweep that does.
--
-- Shape (mirrors KAL-313's `sweep_annotation_trash_events`, the existing
-- retention-sweep precedent in this schema): a SECURITY DEFINER function granted
-- to service_role only, driven by pg_cron. It is NOT callable by app clients.
--
-- Non-negotiables encoded below:
--   * Purging goes through the existing purge_archived_* RPCs — never ad-hoc
--     DELETEs. Those RPCs own cascade behaviour and work out which stored PDF
--     paths became unreferenced. Re-implementing that is how files get orphaned.
--   * A project purges as ONE group. `archive_project` stamps the project and
--     every child document with the same archive_group_id and the same expiry,
--     so children look individually due; they are deliberately skipped and left
--     to the project's own purge. A document with ANY surviving parent project
--     row is never touched, whatever its own expiry says.
--   * Bounded per run (p_limit, hard-capped) AND bounded across runs: an item
--     that keeps failing is quarantined after MAX_ATTEMPTS so it can never
--     occupy the batch window forever and starve healthy rows.
--   * Idempotent + re-runnable. Overlapping runs are serialised by a
--     transaction-scoped advisory lock; the purge RPCs already report
--     `already: true` for a vanished row.
--   * Per-item failure isolation: each purge runs in its own subtransaction, so
--     one unpurgeable item is recorded and skipped, never aborting the run.
--   * Observable: every run writes a row to public.archive_purge_runs recording
--     what was purged, what was skipped and why.
--   * p_dry_run reports exactly what WOULD be purged and deletes nothing.
--
-- Retention comes from public.archive_retention_interval() via the expiry column
-- that archive_* already stamped. Nothing here hardcodes 30.
--
-- Stored-PDF bytes: the purge RPCs return `orphaned_paths` — the file_paths no
-- surviving document row references — but do NOT delete the objects, exactly as
-- the client services do (the RPC reports, the caller unlinks). The sweep
-- aggregates those paths and returns them; the `archive-purge-sweep` Edge
-- Function removes them through the Storage API so the S3 bytes actually go.
-- Deleting storage.objects rows from SQL would strand the bytes forever.
--
-- ⚠️ KNOWN UPSTREAM DEFECT this sweep refuses to trigger (see the project
-- candidate guard below): KAL-426's `purge_archived_project` deletes children
-- with `DELETE FROM documents WHERE project_id = p_project_id` — no owner and no
-- archived filter — while `archive_project` only archives children
-- `WHERE ... AND user_id = v_owner`. A document a collaborator added to a shared
-- project, or one added after the project was archived, is therefore LIVE but
-- would still be deleted by the project's purge. A human clicking "delete
-- forever" once is one thing; an unattended nightly job doing it is another, so
-- the sweep will not purge a project that still holds a non-archived document.
-- Fixing the RPC itself is an owner decision — see
-- docs/KAL-431-archive-auto-cleanup.md.

-- ============================================================================
-- 1. RUN LOG — observability
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.archive_purge_runs (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at         TIMESTAMPTZ,
    batch_limit         INTEGER     NOT NULL,
    dry_run             BOOLEAN     NOT NULL DEFAULT false,
    -- NULL finished_at + skipped_lock = a run that found another run in flight.
    skipped_lock        BOOLEAN     NOT NULL DEFAULT false,
    projects_purged     INTEGER     NOT NULL DEFAULT 0,
    documents_purged    INTEGER     NOT NULL DEFAULT 0,
    templates_purged    INTEGER     NOT NULL DEFAULT 0,
    failed_count        INTEGER     NOT NULL DEFAULT 0,
    skipped_count       INTEGER     NOT NULL DEFAULT 0,
    -- Eligible items that did not fit this batch; the next run takes them.
    over_limit_count    INTEGER     NOT NULL DEFAULT 0,
    -- file_paths that became unreferenced; the Edge Function unlinks these.
    orphaned_paths      TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- Written back by the Edge Function once Storage has actually been cleaned,
    -- so a stranded object is visible rather than silently lost.
    storage_unlinked_at TIMESTAMPTZ,
    unlinked_count      INTEGER,
    unlink_failed_paths TEXT[],
    -- Per-item audit: [{kind, id, outcome, reason?, error?}, ...]. Capped so a
    -- huge deferred backlog cannot inflate one row without bound.
    details             JSONB       NOT NULL DEFAULT '[]'::JSONB
);

COMMENT ON TABLE public.archive_purge_runs IS
    'KAL-431: one row per Archive auto-cleanup run — what was purged, what was skipped and why.';

CREATE INDEX IF NOT EXISTS idx_archive_purge_runs_started
    ON public.archive_purge_runs(started_at DESC);

-- ============================================================================
-- 2. FAILURE LEDGER — stops one bad row wedging the job forever
-- ============================================================================
-- Selection is "oldest expiry first", so without this an item that can never be
-- purged is re-selected first on every run. Enough of them fill the batch window
-- and no healthy row is ever reached again. Recording attempts lets the sweep
-- quarantine a persistent failure and keep draining everything else.

CREATE TABLE IF NOT EXISTS public.archive_purge_failures (
    kind            TEXT        NOT NULL CHECK (kind IN ('project', 'document', 'template')),
    item_id         UUID        NOT NULL,
    attempts        INTEGER     NOT NULL DEFAULT 0,
    first_failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_failed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error      TEXT,
    PRIMARY KEY (kind, item_id)
);

COMMENT ON TABLE public.archive_purge_failures IS
    'KAL-431: items whose purge keeps failing. At MAX_ATTEMPTS the sweep quarantines them so they '
    'cannot starve healthy rows. Investigate and DELETE the row to re-queue an item.';

-- Operators read these through the service role / SQL editor only. No app client
-- has any business reading other users'' purge history.
ALTER TABLE public.archive_purge_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_purge_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.archive_purge_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.archive_purge_failures FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.archive_purge_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.archive_purge_failures TO service_role;

-- ============================================================================
-- 3. THE SWEEP
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sweep_expired_archives(
    p_limit   INTEGER DEFAULT 50,
    p_dry_run BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    LOCK_KEY     CONSTANT BIGINT  := 431431431;
    MAX_LIMIT    CONSTANT INTEGER := 500;
    -- After this many failed attempts an item is quarantined out of selection.
    MAX_ATTEMPTS CONSTANT INTEGER := 5;
    -- Cap on per-item audit entries so one run cannot write an unbounded blob.
    MAX_DETAIL   CONSTANT INTEGER := 200;

    v_limit       INTEGER;
    v_run_id      BIGINT;
    v_rec         RECORD;
    v_result      JSONB;
    v_details     JSONB := '[]'::JSONB;
    v_detail_n    INTEGER := 0;
    v_orphaned    TEXT[] := ARRAY[]::TEXT[];
    v_paths       TEXT[];
    v_projects    INTEGER := 0;
    v_documents   INTEGER := 0;
    v_templates   INTEGER := 0;
    v_failed      INTEGER := 0;
    v_skipped     INTEGER := 0;
    v_over_limit  INTEGER := 0;
    v_eligible    INTEGER := 0;
    v_still_due   BOOLEAN;
    v_ok          BOOLEAN;
BEGIN
    v_limit := COALESCE(p_limit, 50);
    IF v_limit < 1 THEN v_limit := 50; END IF;
    IF v_limit > MAX_LIMIT THEN v_limit := MAX_LIMIT; END IF;

    -- Transaction-scoped: released automatically on COMMIT *and* on ROLLBACK, so
    -- a statement_timeout or a cancelled query cannot leave the lock held and
    -- wedge every future run. (A session-scoped lock would survive the abort,
    -- and plpgsql's WHEN OTHERS does not catch query_canceled, so there would be
    -- no chance to release it.)
    IF NOT pg_try_advisory_xact_lock(LOCK_KEY) THEN
        RAISE LOG 'KAL-431 sweep: another run holds the lock; standing down';
        RETURN jsonb_build_object(
            'ok', true, 'run_id', NULL, 'skipped_lock', true, 'dry_run', p_dry_run,
            'projects_purged', 0, 'documents_purged', 0, 'templates_purged', 0,
            'failed', 0, 'skipped', 0, 'over_limit', 0,
            'orphaned_paths', '[]'::JSONB, 'details', '[]'::JSONB);
    END IF;

    INSERT INTO public.archive_purge_runs(batch_limit, dry_run)
    VALUES (v_limit, p_dry_run)
    RETURNING id INTO v_run_id;

    -- ── Candidate set ──────────────────────────────────────────────────────
    -- ONE globally-ordered pool across all three kinds, not three independent
    -- passes. Three passes with their own limits would let a large project
    -- backlog permanently starve documents and templates. Oldest expiry first,
    -- kind only as a tie-break so a project still purges before its own group's
    -- children on an equal timestamp. This is the same ordering the pure mirror
    -- in src/services/archiveSweepSelection.js implements and tests.
    CREATE TEMP TABLE IF NOT EXISTS kal431_candidates (
        kind TEXT, item_id UUID, owner_id UUID, expires_at TIMESTAMPTZ, kind_rank INT
    ) ON COMMIT DROP;
    -- TRUNCATE, not an unfiltered DELETE: hosted Supabase runs pg-safeupdate on
    -- the PostgREST path, which rejects any DELETE without a WHERE — even on a
    -- scratch temp table. Caught on the first Edge-Function invoke 2026-08-11.
    TRUNCATE pg_temp.kal431_candidates;

    INSERT INTO pg_temp.kal431_candidates (kind, item_id, owner_id, expires_at, kind_rank)
    SELECT * FROM (
        -- Projects. Refuse any project that still holds a NON-archived document:
        -- purge_archived_project would delete it even though it is live and may
        -- belong to a collaborator (see the header note).
        SELECT 'project'::TEXT, p.id, p.user_id, p.user_archive_expires_at, 0
          FROM public.projects p
         WHERE p.user_archived_at IS NOT NULL
           AND p.user_archive_expires_at IS NOT NULL
           AND p.user_archive_expires_at <= now()
           AND NOT EXISTS (SELECT 1 FROM public.documents d
                            WHERE d.project_id = p.id
                              AND d.user_archived_at IS NULL)
        UNION ALL
        -- Documents. Two guards, both biased toward keeping data:
        --   * an existing project row owns this archive group → the project's
        --     purge takes the document as one group;
        --   * ANY surviving project row is this document's parent → never purge
        --     a child out from under a project, archived or live. (Checking for
        --     any parent, not just a live one, also covers an archived project
        --     whose archive_group_id was lost to a manual backfill.)
        SELECT 'document'::TEXT, d.id, d.user_id, d.user_archive_expires_at, 1
          FROM public.documents d
         WHERE d.user_archived_at IS NOT NULL
           AND d.user_archive_expires_at IS NOT NULL
           AND d.user_archive_expires_at <= now()
           AND NOT EXISTS (SELECT 1 FROM public.projects p
                            WHERE p.archive_group_id IS NOT NULL
                              AND p.archive_group_id = d.archive_group_id)
           AND NOT EXISTS (SELECT 1 FROM public.projects p2
                            WHERE p2.id = d.project_id)
        UNION ALL
        SELECT 'template'::TEXT, t.id, t.user_id, t.user_archive_expires_at, 2
          FROM public.templates t
         WHERE t.user_archived_at IS NOT NULL
           AND t.user_archive_expires_at IS NOT NULL
           AND t.user_archive_expires_at <= now()
    ) AS c(kind, item_id, owner_id, expires_at, kind_rank)
    -- Quarantined items drop out of selection entirely so they cannot occupy the
    -- batch window run after run.
    WHERE NOT EXISTS (
        SELECT 1 FROM public.archive_purge_failures f
         WHERE f.kind = c.kind AND f.item_id = c.item_id AND f.attempts >= MAX_ATTEMPTS);

    SELECT count(*) INTO v_eligible FROM pg_temp.kal431_candidates;
    v_over_limit := GREATEST(v_eligible - v_limit, 0);

    -- ── Purge loop ─────────────────────────────────────────────────────────
    FOR v_rec IN
        SELECT kind, item_id, owner_id
          FROM pg_temp.kal431_candidates
         ORDER BY expires_at, kind_rank, item_id
         LIMIT v_limit
    LOOP
        BEGIN
            -- The purge RPCs are owner-enforced via auth.uid(). A cron run has
            -- no JWT, so we adopt the row owner's identity for exactly this
            -- call. set_config(..., true) is transaction-local and is
            -- overwritten on the next iteration. This keeps the shipped,
            -- production-proven RPCs byte-identical instead of loosening their
            -- ownership check for a background caller.
            PERFORM set_config('request.jwt.claim.sub', v_rec.owner_id::TEXT, true);
            PERFORM set_config('request.jwt.claims',
                               json_build_object('sub', v_rec.owner_id::TEXT)::TEXT, true);

            -- Re-verify under a row lock. The candidate set is a snapshot; a user
            -- can restore an item and re-archive it while this run is working,
            -- which resets the clock. The RPCs re-check ownership and archived
            -- state but NOT expiry, so without this a freshly re-archived item
            -- would be deleted 30 days early.
            v_still_due := false;
            IF v_rec.kind = 'project' THEN
                SELECT (user_archived_at IS NOT NULL
                        AND user_archive_expires_at IS NOT NULL
                        AND user_archive_expires_at <= now())
                  INTO v_still_due
                  FROM public.projects WHERE id = v_rec.item_id FOR UPDATE;
            ELSIF v_rec.kind = 'document' THEN
                SELECT (user_archived_at IS NOT NULL
                        AND user_archive_expires_at IS NOT NULL
                        AND user_archive_expires_at <= now())
                  INTO v_still_due
                  FROM public.documents WHERE id = v_rec.item_id FOR UPDATE;
            ELSE
                SELECT (user_archived_at IS NOT NULL
                        AND user_archive_expires_at IS NOT NULL
                        AND user_archive_expires_at <= now())
                  INTO v_still_due
                  FROM public.templates WHERE id = v_rec.item_id FOR UPDATE;
            END IF;

            IF NOT COALESCE(v_still_due, false) THEN
                v_skipped := v_skipped + 1;
                IF v_detail_n < MAX_DETAIL THEN
                    v_details := v_details || jsonb_build_object(
                        'kind', v_rec.kind, 'id', v_rec.item_id,
                        'outcome', 'skipped', 'reason', 'no_longer_due');
                    v_detail_n := v_detail_n + 1;
                END IF;
                RAISE LOG 'KAL-431 sweep: % % no longer due (run %)', v_rec.kind, v_rec.item_id, v_run_id;
                CONTINUE;
            END IF;

            IF p_dry_run THEN
                -- Report only. Nothing is deleted and no failure state changes.
                IF v_detail_n < MAX_DETAIL THEN
                    v_details := v_details || jsonb_build_object(
                        'kind', v_rec.kind, 'id', v_rec.item_id, 'outcome', 'would_purge');
                    v_detail_n := v_detail_n + 1;
                END IF;
                IF    v_rec.kind = 'project'  THEN v_projects  := v_projects  + 1;
                ELSIF v_rec.kind = 'document' THEN v_documents := v_documents + 1;
                ELSE                               v_templates := v_templates + 1;
                END IF;
                CONTINUE;
            END IF;

            IF    v_rec.kind = 'project'  THEN v_result := public.purge_archived_project(v_rec.item_id);
            ELSIF v_rec.kind = 'document' THEN v_result := public.purge_archived_document(v_rec.item_id);
            ELSE                               v_result := public.purge_archived_template(v_rec.item_id);
            END IF;

            v_ok := COALESCE((v_result->>'ok')::BOOLEAN, false);

            IF v_ok THEN
                -- Collect freed storage paths BEFORE touching counters, so the
                -- two can never disagree if a later statement in this block were
                -- ever to throw (the subtransaction rolls back the DELETE but
                -- NOT these plpgsql variables).
                SELECT COALESCE(array_agg(p), ARRAY[]::TEXT[]) INTO v_paths
                  FROM jsonb_array_elements_text(
                         COALESCE(v_result->'orphaned_paths', '[]'::JSONB)) AS p;
                v_orphaned := v_orphaned || v_paths;

                IF    v_rec.kind = 'project'  THEN v_projects  := v_projects  + 1;
                ELSIF v_rec.kind = 'document' THEN v_documents := v_documents + 1;
                ELSE                               v_templates := v_templates + 1;
                END IF;

                -- Recovered: clear any prior failure record.
                DELETE FROM public.archive_purge_failures
                 WHERE kind = v_rec.kind AND item_id = v_rec.item_id;

                IF v_detail_n < MAX_DETAIL THEN
                    v_details := v_details || jsonb_build_object(
                        'kind', v_rec.kind, 'id', v_rec.item_id, 'outcome', 'purged',
                        'already', COALESCE(v_result->'already', 'false'::JSONB));
                    v_detail_n := v_detail_n + 1;
                END IF;
                RAISE LOG 'KAL-431 sweep: purged % % (run %)', v_rec.kind, v_rec.item_id, v_run_id;
            ELSE
                v_failed := v_failed + 1;
                INSERT INTO public.archive_purge_failures(kind, item_id, attempts, last_error)
                VALUES (v_rec.kind, v_rec.item_id, 1, COALESCE(v_result->>'reason', 'unknown'))
                ON CONFLICT (kind, item_id) DO UPDATE
                   SET attempts = public.archive_purge_failures.attempts + 1,
                       last_failed_at = now(),
                       last_error = EXCLUDED.last_error;
                IF v_detail_n < MAX_DETAIL THEN
                    v_details := v_details || jsonb_build_object(
                        'kind', v_rec.kind, 'id', v_rec.item_id, 'outcome', 'failed',
                        'reason', COALESCE(v_result->>'reason', 'unknown'));
                    v_detail_n := v_detail_n + 1;
                END IF;
                RAISE LOG 'KAL-431 sweep: % % refused (%) (run %)',
                    v_rec.kind, v_rec.item_id, COALESCE(v_result->>'reason', 'unknown'), v_run_id;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Own subtransaction: this item rolls back, the run continues.
            v_failed := v_failed + 1;
            IF v_detail_n < MAX_DETAIL THEN
                v_details := v_details || jsonb_build_object(
                    'kind', v_rec.kind, 'id', v_rec.item_id, 'outcome', 'error',
                    'error', left(SQLERRM, 500), 'sqlstate', SQLSTATE);
                v_detail_n := v_detail_n + 1;
            END IF;
            RAISE LOG 'KAL-431 sweep: % % errored: % (run %)',
                v_rec.kind, v_rec.item_id, SQLERRM, v_run_id;
            -- Recorded outside the failed subtransaction's rolled-back work by
            -- running after it: this INSERT is in the parent transaction.
            BEGIN
                INSERT INTO public.archive_purge_failures(kind, item_id, attempts, last_error)
                VALUES (v_rec.kind, v_rec.item_id, 1, left(SQLERRM, 500))
                ON CONFLICT (kind, item_id) DO UPDATE
                   SET attempts = public.archive_purge_failures.attempts + 1,
                       last_failed_at = now(),
                       last_error = EXCLUDED.last_error;
            EXCEPTION WHEN OTHERS THEN
                NULL; -- bookkeeping must never abort the run
            END;
        END;
    END LOOP;

    -- ── Skipped accounting ─────────────────────────────────────────────────
    -- Expired items we deliberately refused to select, with the reason. This is
    -- what makes "nothing was due" distinguishable from "something was due and
    -- we left it alone on purpose". Counted exactly; detailed only up to
    -- MAX_DETAIL so a huge deferred backlog cannot bloat the row.
    FOR v_rec IN
        SELECT kind, item_id, reason FROM (
            SELECT 'document'::TEXT AS kind, d.id AS item_id,
                   CASE
                     WHEN EXISTS (SELECT 1 FROM public.projects p
                                   WHERE p.archive_group_id IS NOT NULL
                                     AND p.archive_group_id = d.archive_group_id)
                       THEN 'deferred_to_project_group'
                     ELSE 'parent_project_survives'
                   END AS reason
              FROM public.documents d
             WHERE d.user_archived_at IS NOT NULL
               AND d.user_archive_expires_at IS NOT NULL
               AND d.user_archive_expires_at <= now()
               AND EXISTS (SELECT 1 FROM public.projects p3
                            WHERE p3.archive_group_id = d.archive_group_id
                               OR p3.id = d.project_id)
            UNION ALL
            -- A project held back because it still contains a live document.
            SELECT 'project'::TEXT, p.id, 'project_holds_live_document'
              FROM public.projects p
             WHERE p.user_archived_at IS NOT NULL
               AND p.user_archive_expires_at IS NOT NULL
               AND p.user_archive_expires_at <= now()
               AND EXISTS (SELECT 1 FROM public.documents d2
                            WHERE d2.project_id = p.id
                              AND d2.user_archived_at IS NULL)
            UNION ALL
            -- Quarantined after repeated failures; needs a human.
            SELECT f.kind, f.item_id, 'quarantined_after_repeated_failure'
              FROM public.archive_purge_failures f
             WHERE f.attempts >= MAX_ATTEMPTS
        ) AS s(kind, item_id, reason)
    LOOP
        v_skipped := v_skipped + 1;
        IF v_detail_n < MAX_DETAIL THEN
            v_details := v_details || jsonb_build_object(
                'kind', v_rec.kind, 'id', v_rec.item_id,
                'outcome', 'skipped', 'reason', v_rec.reason);
            v_detail_n := v_detail_n + 1;
        END IF;
    END LOOP;

    IF v_over_limit > 0 AND v_detail_n < MAX_DETAIL THEN
        v_details := v_details || jsonb_build_object(
            'outcome', 'over_batch_limit', 'count', v_over_limit);
    END IF;

    -- Reset the adopted identity so nothing downstream in this session inherits it.
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);

    UPDATE public.archive_purge_runs
       SET finished_at      = now(),
           projects_purged  = v_projects,
           documents_purged = v_documents,
           templates_purged = v_templates,
           failed_count     = v_failed,
           skipped_count    = v_skipped,
           over_limit_count = v_over_limit,
           orphaned_paths   = v_orphaned,
           details          = v_details
     WHERE id = v_run_id;

    RAISE LOG 'KAL-431 sweep run % (dry_run=%): projects=% documents=% templates=% failed=% skipped=% over_limit=% orphaned=%',
        v_run_id, p_dry_run, v_projects, v_documents, v_templates, v_failed, v_skipped, v_over_limit,
        COALESCE(array_length(v_orphaned, 1), 0);

    RETURN jsonb_build_object(
        'ok', true,
        'run_id', v_run_id,
        'skipped_lock', false,
        'dry_run', p_dry_run,
        'batch_limit', v_limit,
        'eligible', v_eligible,
        'projects_purged', v_projects,
        'documents_purged', v_documents,
        'templates_purged', v_templates,
        'failed', v_failed,
        'skipped', v_skipped,
        'over_limit', v_over_limit,
        -- A dry run never reports paths to unlink: nothing was deleted.
        'orphaned_paths', to_jsonb(v_orphaned),
        'details', v_details);
END;
$$;

-- Hosted Supabase auto-grants EXECUTE on new public functions to anon /
-- authenticated via ALTER DEFAULT PRIVILEGES, so revoking PUBLIC alone is not
-- enough there (caught on production 2026-08-11: both roles held X). Name them.
REVOKE ALL ON FUNCTION public.sweep_expired_archives(INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_expired_archives(INTEGER, BOOLEAN) TO service_role;

COMMENT ON FUNCTION public.sweep_expired_archives(INTEGER, BOOLEAN) IS
    'KAL-431: purge Archive items whose user_archive_expires_at has passed, via the '
    'purge_archived_* RPCs. Bounded by p_limit, idempotent, per-item failure isolation, '
    'repeat failures quarantined. Projects purge as one group with their documents; a project '
    'still holding a live document is refused. p_dry_run reports without deleting. Returns '
    'orphaned storage paths for the caller to unlink. service_role only — call via pg_cron or '
    'the archive-purge-sweep Edge Function. Retention comes from archive_retention_interval().';
