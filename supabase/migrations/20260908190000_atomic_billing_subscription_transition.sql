-- Service-only commit boundary for an EXISTING linked subscription. The caller
-- must read its full expected row BEFORE fetching current provider state, then
-- retry that entire read/fetch/apply cycle on stale, 55P03, 40P01 or 40001.
-- This primitive does not order Stripe snapshots, provision checkout bindings,
-- send email, or replace the webhook until its reconciliation caller is ready.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS survey_private.billing_transition_receipts (
  event_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  subscription_id text NOT NULL,
  event_type text NOT NULL,
  event_digest text NOT NULL,
  result jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE survey_private.billing_transition_receipts OWNER TO postgres;
ALTER TABLE survey_private.billing_transition_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.billing_transition_receipts FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX IF NOT EXISTS billing_transition_receipts_user_idx ON survey_private.billing_transition_receipts(user_id);
COMMENT ON COLUMN survey_private.billing_transition_receipts.event_digest IS
  'SHA-256 of canonical immutable signed event identity and data, excluding delivery headers and mutable pending_webhooks; never a hash of the freshly fetched subscription snapshot.';

CREATE OR REPLACE FUNCTION public.apply_billing_subscription_transition(
  p_user_id uuid, p_customer_id text, p_subscription_id text,
  p_expected jsonb, p_patch jsonb,
  p_event_id text, p_event_type text, p_event_digest text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
SET timezone = 'UTC'
SET lock_timeout = '2s'
AS $$
DECLARE
  caller_name text;
  trusted_caller boolean;
  saved survey_private.billing_transition_receipts%ROWTYPE;
  current_row public.user_subscriptions%ROWTYPE;
  expected_row public.user_subscriptions%ROWTYPE;
  next_row public.user_subscriptions%ROWTYPE;
  next_metadata jsonb;
  subscription_changed boolean;
  cancel_at timestamptz;
  project_ids uuid[] := ARRAY[]::uuid[];
  document_ids uuid[] := ARRAY[]::uuid[];
  applied jsonb;
BEGIN
  -- Grants plus trusted SQL role state: never authorize from a JWT role field.
  caller_name := COALESCE(NULLIF(NULLIF(current_setting('role', true), 'none'), ''), session_user);
  SELECT r.rolsuper OR r.rolbypassrls INTO trusted_caller FROM pg_catalog.pg_roles r WHERE r.rolname=caller_name;
  IF NOT COALESCE(trusted_caller,false) THEN
    RAISE EXCEPTION 'Billing transitions require a trusted service role' USING ERRCODE='42501';
  END IF;
  IF p_user_id IS NULL OR p_customer_id IS NULL OR p_subscription_id IS NULL
     OR p_customer_id !~ '^cus_[A-Za-z0-9_]+$' OR length(p_customer_id)>255
     OR p_subscription_id !~ '^sub_[A-Za-z0-9_]+$' OR length(p_subscription_id)>255
     OR p_event_id IS NULL OR p_event_id !~ '^evt_[A-Za-z0-9_]+$' OR length(p_event_id)>255
     OR p_event_type IS NULL OR p_event_type NOT IN ('customer.subscription.created','customer.subscription.updated',
       'customer.subscription.deleted','checkout.session.completed','invoice.payment_succeeded','invoice.payment_failed')
     OR p_event_digest IS NULL OR p_event_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid billing event binding' USING ERRCODE='22023';
  END IF;

  -- A lost commit reply is resolved without replaying the plan/archive writes.
  SELECT * INTO saved FROM survey_private.billing_transition_receipts WHERE event_id=p_event_id;
  IF FOUND THEN
    IF saved.user_id IS DISTINCT FROM p_user_id OR saved.customer_id IS DISTINCT FROM p_customer_id
       OR saved.subscription_id IS DISTINCT FROM p_subscription_id OR saved.event_type IS DISTINCT FROM p_event_type
       OR saved.event_digest IS DISTINCT FROM p_event_digest THEN
      RAISE EXCEPTION 'Billing event receipt binding changed' USING ERRCODE='22023';
    END IF;
    RETURN saved.result || jsonb_build_object('outcome','duplicate');
  END IF;

  IF jsonb_typeof(p_expected) IS DISTINCT FROM 'object' OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
     OR NOT (p_patch ?& ARRAY['tier','status','stripe_subscription_id','stripe_price_id','trial_ends_at',
       'current_period_start','current_period_end','cancel_at'])
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN ('tier','status','stripe_subscription_id',
       'stripe_price_id','trial_ends_at','current_period_start','current_period_end','cancel_at')) THEN
    RAISE EXCEPTION 'Invalid billing snapshot or patch' USING ERRCODE='22023';
  END IF;
  expected_row := jsonb_populate_record(NULL::public.user_subscriptions,p_expected);
  next_row := jsonb_populate_record(NULL::public.user_subscriptions,p_patch-'cancel_at');
  IF expected_row.user_id IS DISTINCT FROM p_user_id OR expected_row.stripe_customer_id IS DISTINCT FROM p_customer_id
     OR expected_row.stripe_subscription_id IS DISTINCT FROM p_subscription_id
     OR next_row.tier IS NULL OR next_row.status IS NULL
     OR (next_row.stripe_subscription_id IS NOT NULL AND next_row.stripe_subscription_id<>p_subscription_id)
     OR (next_row.stripe_subscription_id IS NULL AND (next_row.tier<>'free' OR next_row.status<>'canceled'
       OR next_row.stripe_price_id IS NOT NULL OR next_row.trial_ends_at IS NOT NULL))
     OR (next_row.status='canceled' AND next_row.stripe_subscription_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Billing patch does not match its subscription' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_patch->'cancel_at') NOT IN ('null','string') THEN
    RAISE EXCEPTION 'Invalid cancellation time' USING ERRCODE='22023';
  END IF;
  cancel_at := (p_patch->>'cancel_at')::timestamptz;
  IF (cancel_at IS NOT NULL AND NOT isfinite(cancel_at))
     OR (next_row.trial_ends_at IS NOT NULL AND NOT isfinite(next_row.trial_ends_at))
     OR (next_row.current_period_start IS NOT NULL AND NOT isfinite(next_row.current_period_start))
     OR (next_row.current_period_end IS NOT NULL AND NOT isfinite(next_row.current_period_end)) THEN
    RAISE EXCEPTION 'Billing timestamps must be finite' USING ERRCODE='22023';
  END IF;

  -- Guard rows and receipts reference auth.users. Protect that parent BEFORE
  -- taking a guard so an account DELETE cannot hold it while cascading into our
  -- guard, then deadlock with creation of a different missing guard's FK.
  PERFORM u.id FROM auth.users u WHERE u.id=p_user_id FOR KEY SHARE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','stale','user_id',p_user_id); END IF;

  -- Match all active-allocation guards. Actual writes reject stale RR/Serializable
  -- snapshots as well as serializing READ COMMITTED callers. No provider I/O here.
  INSERT INTO survey_private.project_quota_guards AS g(user_id,revision) VALUES(p_user_id,1)
    ON CONFLICT(user_id) DO UPDATE SET revision=g.revision+1;
  INSERT INTO survey_private.document_quota_guards AS g(user_id,revision) VALUES(p_user_id,1)
    ON CONFLICT(user_id) DO UPDATE SET revision=g.revision+1;
  INSERT INTO survey_private.storage_quota_guards AS g(owner_id,revision) VALUES(p_user_id,1)
    ON CONFLICT(owner_id) DO UPDATE SET revision=g.revision+1;

  -- A concurrent delivery may have committed while this request waited.
  SELECT * INTO saved FROM survey_private.billing_transition_receipts WHERE event_id=p_event_id;
  IF FOUND THEN
    IF saved.user_id IS DISTINCT FROM p_user_id OR saved.customer_id IS DISTINCT FROM p_customer_id
       OR saved.subscription_id IS DISTINCT FROM p_subscription_id OR saved.event_type IS DISTINCT FROM p_event_type
       OR saved.event_digest IS DISTINCT FROM p_event_digest THEN
      RAISE EXCEPTION 'Billing event receipt binding changed' USING ERRCODE='22023';
    END IF;
    RETURN saved.result || jsonb_build_object('outcome','duplicate');
  END IF;

  IF next_row.tier='free' THEN
    -- Restore UPDATEs lock tuples before their BEFORE quota trigger. Waiting here
    -- would reverse that order and deadlock. NOWAIT aborts the WHOLE transaction,
    -- releases its guards, and lets the caller retry after fresh reads.
    PERFORM p.id FROM public.projects p WHERE p.user_id=p_user_id AND p.archived=false ORDER BY p.id FOR UPDATE NOWAIT;
    PERFORM d.id FROM public.documents d WHERE d.user_id=p_user_id AND d.archived=false ORDER BY d.id FOR UPDATE NOWAIT;
  END IF;
  SELECT * INTO current_row FROM public.user_subscriptions WHERE user_id=p_user_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR current_row.stripe_customer_id IS DISTINCT FROM p_customer_id
     OR current_row.stripe_subscription_id IS DISTINCT FROM p_subscription_id
     OR current_row IS DISTINCT FROM expected_row THEN
    RETURN jsonb_build_object('outcome','stale','user_id',p_user_id);
  END IF;
  IF current_row.metadata IS NOT NULL AND jsonb_typeof(current_row.metadata)<>'object' THEN
    RAISE EXCEPTION 'Existing subscription metadata needs repair' USING ERRCODE='22023';
  END IF;
  next_metadata := COALESCE(current_row.metadata,'{}'::jsonb)-'cancel_at';
  IF cancel_at IS NOT NULL THEN next_metadata := next_metadata || jsonb_build_object('cancel_at',cancel_at); END IF;
  subscription_changed := ROW(current_row.tier,current_row.status,current_row.stripe_subscription_id,
    current_row.stripe_price_id,current_row.trial_ends_at,current_row.current_period_start,current_row.current_period_end,current_row.metadata)
    IS DISTINCT FROM ROW(next_row.tier,next_row.status,next_row.stripe_subscription_id,
      next_row.stripe_price_id,next_row.trial_ends_at,next_row.current_period_start,next_row.current_period_end,next_metadata);
  -- Distinct events can describe the same state. Keep their receipts without
  -- rewriting an unchanged subscription or advancing its updated_at signal.
  IF subscription_changed THEN
    UPDATE public.user_subscriptions SET tier=next_row.tier,status=next_row.status,
      stripe_subscription_id=next_row.stripe_subscription_id,stripe_price_id=next_row.stripe_price_id,
      trial_ends_at=next_row.trial_ends_at,current_period_start=next_row.current_period_start,
      current_period_end=next_row.current_period_end,metadata=next_metadata
      WHERE id=current_row.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Subscription update did not persist' USING ERRCODE='40001';
    END IF;
  END IF;

  -- Preserve the existing free caps and oldest-first archive policy, with a
  -- stable ID tie-break. Never unarchive on upgrade or touch file bytes/shares.
  IF next_row.tier='free' THEN
    WITH selected AS (
      SELECT id FROM public.projects WHERE user_id=p_user_id AND archived=false
      ORDER BY updated_at ASC NULLS LAST,id ASC
      LIMIT (SELECT GREATEST(count(*)-1,0) FROM public.projects WHERE user_id=p_user_id AND archived=false)
    ), changed AS (
      UPDATE public.projects SET archived=true WHERE id IN (SELECT id FROM selected) RETURNING id
    ) SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO project_ids FROM changed;
    WITH selected AS (
      SELECT id FROM public.documents WHERE user_id=p_user_id AND archived=false
      ORDER BY updated_at ASC NULLS LAST,id ASC
      LIMIT (SELECT GREATEST(count(*)-5,0) FROM public.documents WHERE user_id=p_user_id AND archived=false)
    ), changed AS (
      UPDATE public.documents SET archived=true WHERE id IN (SELECT id FROM selected) RETURNING id
    ) SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO document_ids FROM changed;
  END IF;
  applied := jsonb_build_object('outcome','applied','user_id',p_user_id,
    'subscription_changed',subscription_changed,
    'previous_tier',current_row.tier,'tier',next_row.tier,'status',next_row.status,
    'archived_project_ids',project_ids,'archived_document_ids',document_ids,
    'projects_archived_count',cardinality(project_ids),'documents_archived_count',cardinality(document_ids));
  INSERT INTO survey_private.billing_transition_receipts(event_id,user_id,customer_id,subscription_id,event_type,event_digest,result)
    VALUES(p_event_id,p_user_id,p_customer_id,p_subscription_id,p_event_type,p_event_digest,applied);
  RETURN applied;
END;
$$;
ALTER FUNCTION public.apply_billing_subscription_transition(uuid,text,text,jsonb,jsonb,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_billing_subscription_transition(uuid,text,text,jsonb,jsonb,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_billing_subscription_transition(uuid,text,text,jsonb,jsonb,text,text,text) TO service_role;

COMMENT ON FUNCTION public.apply_billing_subscription_transition(uuid,text,text,jsonb,jsonb,text,text,text) IS
  'Atomic service-only existing-subscription CAS, archive and event receipt. Requires fresh provider reconciliation outside SQL and whole-transaction retries; no webhook routing or checkout provisioning is installed by this migration.';
COMMIT;
