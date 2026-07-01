-- Project + Template sharing — extends the proven KAL-31 document-invite
-- pattern to projects and templates, and closes two live RLS gaps found by
-- direct prod inspection on 2026-07-01:
--   * projects SELECT never consulted project_collaborators (a collaborator
--     could not even see the shared project row);
--   * documents UPDATE/DELETE were hard-coded to the original creator, so a
--     promoted co-owner could not rename/delete; and project membership did
--     not flow through to a project's documents at all.
--
-- Notes vs the older kal31 migration FILE (which drifted from prod):
--   * tier lookups read public.user_subscriptions (the live table), NOT
--     public.subscriptions (stale name in the old migration file — prod's
--     live copy of kal31_accept_document_invite was already fixed by hand).
--   * role vocabulary and free-tier downgrade semantics mirror the locked
--     KAL-31 spec exactly (viewer | editor | owner; free accepts as viewer,
--     intended role preserved with upgrade_required=true).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. project_invites (mirror of document_invites)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.project_invites (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    token          TEXT NOT NULL UNIQUE,
    role           TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'owner')),
    target_email   TEXT,                            -- NULL means link-only
    intended_role  TEXT NOT NULL CHECK (intended_role IN ('viewer', 'editor', 'owner')),
    created_by     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL,
    revoked_at     TIMESTAMPTZ,
    accepted_at    TIMESTAMPTZ,
    accepted_by    UUID REFERENCES auth.users(id),
    accepted_role  TEXT CHECK (accepted_role IN ('viewer', 'editor', 'owner'))
);

CREATE INDEX IF NOT EXISTS idx_project_invites_project_id  ON public.project_invites(project_id);
CREATE INDEX IF NOT EXISTS idx_project_invites_token       ON public.project_invites(token);
CREATE INDEX IF NOT EXISTS idx_project_invites_target_email ON public.project_invites(target_email);

ALTER TABLE public.project_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_invites_owner_select ON public.project_invites;
CREATE POLICY project_invites_owner_select
    ON public.project_invites FOR SELECT
    USING (public.user_can_access_project(project_id, 'owner'));

DROP POLICY IF EXISTS project_invites_owner_insert ON public.project_invites;
CREATE POLICY project_invites_owner_insert
    ON public.project_invites FOR INSERT
    WITH CHECK (
        public.user_can_access_project(project_id, 'owner')
        AND created_by = auth.uid()
    );

DROP POLICY IF EXISTS project_invites_owner_update ON public.project_invites;
CREATE POLICY project_invites_owner_update
    ON public.project_invites FOR UPDATE
    USING (public.user_can_access_project(project_id, 'owner'))
    WITH CHECK (public.user_can_access_project(project_id, 'owner'));

-- ---------------------------------------------------------------------------
-- 2. template_collaborators + access helper + template_invites
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.template_collaborators (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id  UUID NOT NULL REFERENCES public.templates(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    invited_by   UUID REFERENCES auth.users(id),
    role         TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'owner')),
    email        TEXT,
    status       TEXT DEFAULT 'active',
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE (template_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_template_collaborators_template ON public.template_collaborators(template_id);
CREATE INDEX IF NOT EXISTS idx_template_collaborators_user     ON public.template_collaborators(user_id);

CREATE OR REPLACE FUNCTION public.user_can_access_template(tpl_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    tpl_owner_id UUID;
    user_role TEXT;
BEGIN
    SELECT user_id INTO tpl_owner_id
      FROM public.templates
     WHERE id = tpl_id;

    IF tpl_owner_id IS NULL THEN
        RETURN FALSE;
    END IF;

    IF tpl_owner_id = auth.uid() THEN
        RETURN TRUE;
    END IF;

    SELECT role INTO user_role
      FROM public.template_collaborators
     WHERE template_id = tpl_id
       AND user_id = auth.uid()
       AND status = 'active';

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    CASE required_role
        WHEN 'viewer' THEN RETURN user_role IN ('viewer', 'editor', 'owner');
        WHEN 'editor' THEN RETURN user_role IN ('editor', 'owner');
        WHEN 'owner'  THEN RETURN user_role = 'owner';
        ELSE RETURN FALSE;
    END CASE;
END;
$$;

ALTER TABLE public.template_collaborators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS template_collaborators_select ON public.template_collaborators;
CREATE POLICY template_collaborators_select
    ON public.template_collaborators FOR SELECT
    USING (public.user_can_access_template(template_id, 'viewer'));

DROP POLICY IF EXISTS template_collaborators_insert ON public.template_collaborators;
CREATE POLICY template_collaborators_insert
    ON public.template_collaborators FOR INSERT
    WITH CHECK (public.user_can_access_template(template_id, 'owner'));

DROP POLICY IF EXISTS template_collaborators_update ON public.template_collaborators;
CREATE POLICY template_collaborators_update
    ON public.template_collaborators FOR UPDATE
    USING (public.user_can_access_template(template_id, 'owner'))
    WITH CHECK (public.user_can_access_template(template_id, 'owner'));

DROP POLICY IF EXISTS template_collaborators_delete ON public.template_collaborators;
CREATE POLICY template_collaborators_delete
    ON public.template_collaborators FOR DELETE
    USING (
        public.user_can_access_template(template_id, 'owner')
        OR user_id = auth.uid()   -- a collaborator may remove themselves
    );

CREATE TABLE IF NOT EXISTS public.template_invites (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id    UUID NOT NULL REFERENCES public.templates(id) ON DELETE CASCADE,
    token          TEXT NOT NULL UNIQUE,
    role           TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'owner')),
    target_email   TEXT,
    intended_role  TEXT NOT NULL CHECK (intended_role IN ('viewer', 'editor', 'owner')),
    created_by     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL,
    revoked_at     TIMESTAMPTZ,
    accepted_at    TIMESTAMPTZ,
    accepted_by    UUID REFERENCES auth.users(id),
    accepted_role  TEXT CHECK (accepted_role IN ('viewer', 'editor', 'owner'))
);

CREATE INDEX IF NOT EXISTS idx_template_invites_template_id  ON public.template_invites(template_id);
CREATE INDEX IF NOT EXISTS idx_template_invites_token        ON public.template_invites(token);
CREATE INDEX IF NOT EXISTS idx_template_invites_target_email ON public.template_invites(target_email);

ALTER TABLE public.template_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS template_invites_owner_select ON public.template_invites;
CREATE POLICY template_invites_owner_select
    ON public.template_invites FOR SELECT
    USING (public.user_can_access_template(template_id, 'owner'));

DROP POLICY IF EXISTS template_invites_owner_insert ON public.template_invites;
CREATE POLICY template_invites_owner_insert
    ON public.template_invites FOR INSERT
    WITH CHECK (
        public.user_can_access_template(template_id, 'owner')
        AND created_by = auth.uid()
    );

DROP POLICY IF EXISTS template_invites_owner_update ON public.template_invites;
CREATE POLICY template_invites_owner_update
    ON public.template_invites FOR UPDATE
    USING (public.user_can_access_template(template_id, 'owner'))
    WITH CHECK (public.user_can_access_template(template_id, 'owner'));

-- ---------------------------------------------------------------------------
-- 3. Acceptance / resend / revoke RPCs (project + template)
--    Same statuses and free-tier downgrade semantics as kal31 documents.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.kal31_accept_project_invite(invite_token TEXT)
RETURNS TABLE (
    status           TEXT,
    project_id       UUID,
    effective_role   TEXT,
    intended_role    TEXT,
    upgrade_required BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_invite       public.project_invites%ROWTYPE;
    v_caller_email TEXT;
    v_caller_tier  TEXT;
    v_final_role   TEXT;
    v_needs_upg    BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'kal31_accept_project_invite: must be authenticated';
    END IF;

    SELECT * INTO v_invite FROM public.project_invites WHERE token = invite_token LIMIT 1;

    IF NOT FOUND THEN
        status := 'invalid'; project_id := NULL; effective_role := NULL;
        intended_role := NULL; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF v_invite.revoked_at IS NOT NULL THEN
        status := 'revoked'; project_id := v_invite.project_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF v_invite.expires_at < now() THEN
        status := 'expired'; project_id := v_invite.project_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF v_invite.accepted_at IS NOT NULL THEN
        status := 'already_accepted'; project_id := v_invite.project_id;
        effective_role := v_invite.accepted_role; intended_role := v_invite.intended_role;
        upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    SELECT email::TEXT INTO v_caller_email FROM auth.users WHERE id = auth.uid();
    IF v_invite.target_email IS NOT NULL AND LOWER(v_invite.target_email) <> LOWER(v_caller_email) THEN
        status := 'wrong_account'; project_id := v_invite.project_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    SELECT COALESCE(s.tier::TEXT, 'free') INTO v_caller_tier
      FROM public.user_subscriptions s
     WHERE s.user_id = auth.uid()
     LIMIT 1;
    v_caller_tier := COALESCE(v_caller_tier, 'free');

    IF v_invite.intended_role IN ('editor', 'owner') AND v_caller_tier = 'free' THEN
        v_final_role := 'viewer';
        v_needs_upg := TRUE;
    ELSE
        v_final_role := v_invite.intended_role;
    END IF;

    INSERT INTO public.project_collaborators (project_id, user_id, email, role, status, invited_by)
    VALUES (v_invite.project_id, auth.uid(), v_caller_email, v_final_role, 'active', v_invite.created_by)
    ON CONFLICT (project_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           status = 'active';

    UPDATE public.project_invites
       SET accepted_at = now(), accepted_by = auth.uid(), accepted_role = v_final_role
     WHERE id = v_invite.id;

    status := 'accepted';
    project_id := v_invite.project_id;
    effective_role := v_final_role;
    intended_role := v_invite.intended_role;
    upgrade_required := v_needs_upg;
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal31_accept_project_invite(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.kal31_resend_project_invite(invite_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_invite public.project_invites%ROWTYPE;
    v_new_expiry TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_invite FROM public.project_invites WHERE id = invite_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'kal31_resend_project_invite: invite not found';
    END IF;
    IF NOT public.user_can_access_project(v_invite.project_id, 'owner') THEN
        RAISE EXCEPTION 'kal31_resend_project_invite: only owners can resend';
    END IF;
    IF v_invite.accepted_at IS NOT NULL THEN
        RAISE EXCEPTION 'kal31_resend_project_invite: invite already accepted';
    END IF;
    v_new_expiry := now() + INTERVAL '7 days';
    UPDATE public.project_invites
       SET expires_at = v_new_expiry, revoked_at = NULL
     WHERE id = invite_id;
    RETURN v_new_expiry;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal31_resend_project_invite(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.kal31_revoke_project_invite(invite_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_invite public.project_invites%ROWTYPE;
BEGIN
    SELECT * INTO v_invite FROM public.project_invites WHERE id = invite_id;
    IF NOT FOUND THEN RETURN FALSE; END IF;
    IF NOT public.user_can_access_project(v_invite.project_id, 'owner') THEN
        RAISE EXCEPTION 'kal31_revoke_project_invite: only owners can revoke';
    END IF;
    UPDATE public.project_invites
       SET revoked_at = now()
     WHERE id = invite_id AND accepted_at IS NULL;
    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal31_revoke_project_invite(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.kal31_accept_template_invite(invite_token TEXT)
RETURNS TABLE (
    status           TEXT,
    template_id      UUID,
    effective_role   TEXT,
    intended_role    TEXT,
    upgrade_required BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_invite       public.template_invites%ROWTYPE;
    v_caller_email TEXT;
    v_caller_tier  TEXT;
    v_final_role   TEXT;
    v_needs_upg    BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'kal31_accept_template_invite: must be authenticated';
    END IF;

    SELECT * INTO v_invite FROM public.template_invites WHERE token = invite_token LIMIT 1;

    IF NOT FOUND THEN
        status := 'invalid'; template_id := NULL; effective_role := NULL;
        intended_role := NULL; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF v_invite.revoked_at IS NOT NULL THEN
        status := 'revoked'; template_id := v_invite.template_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF v_invite.expires_at < now() THEN
        status := 'expired'; template_id := v_invite.template_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF v_invite.accepted_at IS NOT NULL THEN
        status := 'already_accepted'; template_id := v_invite.template_id;
        effective_role := v_invite.accepted_role; intended_role := v_invite.intended_role;
        upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    SELECT email::TEXT INTO v_caller_email FROM auth.users WHERE id = auth.uid();
    IF v_invite.target_email IS NOT NULL AND LOWER(v_invite.target_email) <> LOWER(v_caller_email) THEN
        status := 'wrong_account'; template_id := v_invite.template_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    SELECT COALESCE(s.tier::TEXT, 'free') INTO v_caller_tier
      FROM public.user_subscriptions s
     WHERE s.user_id = auth.uid()
     LIMIT 1;
    v_caller_tier := COALESCE(v_caller_tier, 'free');

    IF v_invite.intended_role IN ('editor', 'owner') AND v_caller_tier = 'free' THEN
        v_final_role := 'viewer';
        v_needs_upg := TRUE;
    ELSE
        v_final_role := v_invite.intended_role;
    END IF;

    INSERT INTO public.template_collaborators (template_id, user_id, email, role, status, invited_by)
    VALUES (v_invite.template_id, auth.uid(), v_caller_email, v_final_role, 'active', v_invite.created_by)
    ON CONFLICT (template_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           status = 'active';

    UPDATE public.template_invites
       SET accepted_at = now(), accepted_by = auth.uid(), accepted_role = v_final_role
     WHERE id = v_invite.id;

    status := 'accepted';
    template_id := v_invite.template_id;
    effective_role := v_final_role;
    intended_role := v_invite.intended_role;
    upgrade_required := v_needs_upg;
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal31_accept_template_invite(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.kal31_resend_template_invite(invite_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_invite public.template_invites%ROWTYPE;
    v_new_expiry TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_invite FROM public.template_invites WHERE id = invite_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'kal31_resend_template_invite: invite not found';
    END IF;
    IF NOT public.user_can_access_template(v_invite.template_id, 'owner') THEN
        RAISE EXCEPTION 'kal31_resend_template_invite: only owners can resend';
    END IF;
    IF v_invite.accepted_at IS NOT NULL THEN
        RAISE EXCEPTION 'kal31_resend_template_invite: invite already accepted';
    END IF;
    v_new_expiry := now() + INTERVAL '7 days';
    UPDATE public.template_invites
       SET expires_at = v_new_expiry, revoked_at = NULL
     WHERE id = invite_id;
    RETURN v_new_expiry;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal31_resend_template_invite(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.kal31_revoke_template_invite(invite_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_invite public.template_invites%ROWTYPE;
BEGIN
    SELECT * INTO v_invite FROM public.template_invites WHERE id = invite_id;
    IF NOT FOUND THEN RETURN FALSE; END IF;
    IF NOT public.user_can_access_template(v_invite.template_id, 'owner') THEN
        RAISE EXCEPTION 'kal31_revoke_template_invite: only owners can revoke';
    END IF;
    UPDATE public.template_invites
       SET revoked_at = now()
     WHERE id = invite_id AND accepted_at IS NULL;
    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal31_revoke_template_invite(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Close the live RLS gaps
-- ---------------------------------------------------------------------------

-- 4a. Project membership flows through to the project's documents, and the
--     project creator is implicitly owner of documents inside their project.
--     Direct document_collaborators role (if any) takes precedence.
CREATE OR REPLACE FUNCTION public.user_can_access_document(doc_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    doc_owner_id UUID;
    doc_project_id UUID;
    user_role TEXT;
BEGIN
    SELECT user_id, project_id INTO doc_owner_id, doc_project_id
      FROM public.documents
     WHERE id = doc_id;

    IF doc_owner_id IS NULL THEN
        RETURN FALSE;
    END IF;

    IF doc_owner_id = auth.uid() THEN
        RETURN TRUE;
    END IF;

    SELECT role INTO user_role
      FROM public.document_collaborators
     WHERE document_id = doc_id
       AND user_id = auth.uid()
       AND status = 'active';

    -- No direct document role: fall back to project membership.
    IF user_role IS NULL AND doc_project_id IS NOT NULL THEN
        SELECT role INTO user_role
          FROM public.project_collaborators
         WHERE project_id = doc_project_id
           AND user_id = auth.uid()
           AND status = 'active';

        IF user_role IS NULL THEN
            SELECT CASE WHEN user_id = auth.uid() THEN 'owner' END INTO user_role
              FROM public.projects
             WHERE id = doc_project_id;
        END IF;
    END IF;

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    CASE required_role
        WHEN 'viewer' THEN RETURN user_role IN ('viewer', 'editor', 'owner');
        WHEN 'editor' THEN RETURN user_role IN ('editor', 'owner');
        WHEN 'owner'  THEN RETURN user_role = 'owner';
        ELSE RETURN FALSE;
    END CASE;
END;
$$;

-- 4b. Collaborators can SEE shared projects.
DROP POLICY IF EXISTS "Users can view own projects" ON public.projects;
CREATE POLICY "Users can view own projects"
    ON public.projects FOR SELECT
    USING (
        auth.uid() = user_id
        OR public.user_can_access_project(id, 'viewer')
    );

-- 4c. Project editors can update the project row; the creator keeps the
--     existing tier-gated clause unchanged (collaborator clause is
--     restricted to non-creators so it cannot bypass the creator tier gate).
DROP POLICY IF EXISTS "Users can update own projects" ON public.projects;
CREATE POLICY "Users can update own projects"
    ON public.projects FOR UPDATE
    USING (
        (
            auth.uid() = user_id
            AND (
                public.get_user_tier(auth.uid()) = ANY (ARRAY['pro'::subscription_tier, 'enterprise'::subscription_tier, 'developer'::subscription_tier])
                OR public.is_project_accessible(id, auth.uid())
            )
        )
        OR (auth.uid() <> user_id AND public.user_can_access_project(id, 'editor'))
    );

-- 4d. Promoted co-owners can delete the project.
DROP POLICY IF EXISTS "Users can delete own projects" ON public.projects;
CREATE POLICY "Users can delete own projects"
    ON public.projects FOR DELETE
    USING (
        auth.uid() = user_id
        OR public.user_can_access_project(id, 'owner')
    );

-- 4e. Documents: promoted co-owners (direct or via project) can rename/delete.
DROP POLICY IF EXISTS "Users can update own documents" ON public.documents;
CREATE POLICY "Users can update own documents"
    ON public.documents FOR UPDATE
    USING (
        auth.uid() = user_id
        OR public.user_can_access_document(id, 'owner')
    );

DROP POLICY IF EXISTS "Users can delete own documents" ON public.documents;
CREATE POLICY "Users can delete own documents"
    ON public.documents FOR DELETE
    USING (
        auth.uid() = user_id
        OR public.user_can_access_document(id, 'owner')
    );

-- 4f. Templates: collaborators can see shared templates; editors can edit
--     (creator keeps the existing feature-gated clause); owner-collaborators
--     can delete.
DROP POLICY IF EXISTS "Users can view own templates" ON public.templates;
CREATE POLICY "Users can view own templates"
    ON public.templates FOR SELECT
    USING (
        auth.uid() = user_id
        OR public.user_can_access_template(id, 'viewer')
    );

DROP POLICY IF EXISTS "Only Pro users can edit templates" ON public.templates;
CREATE POLICY "Only Pro users can edit templates"
    ON public.templates FOR UPDATE
    USING (
        (
            auth.uid() = user_id
            AND public.has_feature_access(auth.uid(), 'templates')
        )
        OR (auth.uid() <> user_id AND public.user_can_access_template(id, 'editor'))
    );

DROP POLICY IF EXISTS "Users can delete own templates" ON public.templates;
CREATE POLICY "Users can delete own templates"
    ON public.templates FOR DELETE
    USING (
        auth.uid() = user_id
        OR public.user_can_access_template(id, 'owner')
    );

COMMIT;
