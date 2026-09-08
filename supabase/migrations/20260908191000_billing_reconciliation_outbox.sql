-- Atomic provider reconciliation + frozen notification intent. No provider I/O,
-- email send, scheduler, checkout provisioning or raw table grants are installed.
-- Callers re-read the full subscription BEFORE fetching provider state on every
-- stale/55P03/40P01/40001 retry. The previous linked-only RPC remains unchanged.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS survey_private.billing_reconciliation_heads (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK(revision>=0)
);
ALTER TABLE survey_private.billing_reconciliation_heads OWNER TO postgres;
ALTER TABLE survey_private.billing_reconciliation_heads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.billing_reconciliation_heads FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS survey_private.billing_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL REFERENCES survey_private.billing_transition_receipts(event_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_key text NOT NULL,
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','needs_review')),
  claim_token uuid UNIQUE,
  lease_expires_at timestamptz,
  first_attempt_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  UNIQUE(user_id,notification_key),
  CHECK((state='pending')=(first_attempt_at IS NULL)),
  CHECK(state='pending' OR claim_token IS NOT NULL),
  CHECK(state NOT IN ('sending','needs_review') OR lease_expires_at IS NOT NULL),
  CHECK((state='sent')=(sent_at IS NOT NULL)),
  CHECK((state='sent')=(provider_message_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS billing_notification_outbox_event_idx ON survey_private.billing_notification_outbox(event_id);
ALTER TABLE survey_private.billing_notification_outbox OWNER TO postgres;
ALTER TABLE survey_private.billing_notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.billing_notification_outbox FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION survey_private.require_billing_service()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE caller_name text; trusted boolean;
BEGIN
  caller_name := COALESCE(NULLIF(NULLIF(current_setting('role',true),'none'),''),session_user);
  SELECT r.rolsuper OR r.rolbypassrls INTO trusted FROM pg_catalog.pg_roles r WHERE r.rolname=caller_name;
  IF NOT COALESCE(trusted,false) THEN
    RAISE EXCEPTION 'Billing notifications require a trusted service role' USING ERRCODE='42501';
  END IF;
END;
$$;
ALTER FUNCTION survey_private.require_billing_service() OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.require_billing_service() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.read_billing_subscription_snapshot(p_customer_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC'
AS $$
DECLARE snapshot jsonb;
BEGIN
  PERFORM survey_private.require_billing_service();
  IF p_customer_id IS NULL OR p_customer_id !~ '^cus_[A-Za-z0-9_]+$' OR length(p_customer_id)>255 THEN
    RAISE EXCEPTION 'Invalid billing customer' USING ERRCODE='22023';
  END IF;
  -- One MVCC snapshot: the subscription and its observation revision must be
  -- read together BEFORE provider lookup, including when its row is unchanged.
  SELECT jsonb_build_object('subscription',to_jsonb(s),'revision',COALESCE(h.revision,0)::text)
    INTO snapshot FROM public.user_subscriptions s
    LEFT JOIN survey_private.billing_reconciliation_heads h ON h.user_id=s.user_id
    WHERE s.stripe_customer_id=p_customer_id;
  RETURN snapshot;
END;
$$;

CREATE OR REPLACE FUNCTION public.lookup_billing_event(
  p_event_id text,p_customer_id text,p_subscription_id text,p_event_type text,p_event_digest text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
DECLARE saved survey_private.billing_transition_receipts%ROWTYPE;
BEGIN
  PERFORM survey_private.require_billing_service();
  IF p_event_id IS NULL OR p_event_id !~ '^evt_[A-Za-z0-9_]+$' OR length(p_event_id)>255
     OR p_customer_id IS NULL OR p_customer_id !~ '^cus_[A-Za-z0-9_]+$' OR length(p_customer_id)>255
     OR p_subscription_id IS NULL OR p_subscription_id !~ '^sub_[A-Za-z0-9_]+$' OR length(p_subscription_id)>255
     OR p_event_type IS NULL OR p_event_type NOT IN ('customer.subscription.created','customer.subscription.updated',
       'customer.subscription.deleted','customer.subscription.trial_will_end','checkout.session.completed','invoice.payment_succeeded','invoice.payment_failed')
     OR p_event_digest IS NULL OR p_event_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid billing event binding' USING ERRCODE='22023';
  END IF;
  SELECT * INTO saved FROM survey_private.billing_transition_receipts WHERE event_id=p_event_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF saved.customer_id IS DISTINCT FROM p_customer_id OR saved.subscription_id IS DISTINCT FROM p_subscription_id
     OR saved.event_type IS DISTINCT FROM p_event_type OR saved.event_digest IS DISTINCT FROM p_event_digest THEN
    RAISE EXCEPTION 'Billing event receipt binding changed' USING ERRCODE='22023';
  END IF;
  RETURN saved.result || jsonb_build_object('outcome','duplicate','user_id',saved.user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_billing_subscription_event(
  p_user_id uuid, p_customer_id text, p_subscription_id text,
  p_expected jsonb, p_patch jsonb,
  p_event_id text, p_event_type text, p_event_digest text,
  p_notification jsonb DEFAULT NULL, p_expected_revision bigint DEFAULT NULL
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
  current_revision bigint;
  notifications jsonb;
  notification jsonb;
  notification_keys jsonb := '[]'::jsonb;
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
       'customer.subscription.deleted','customer.subscription.trial_will_end','checkout.session.completed','invoice.payment_succeeded','invoice.payment_failed')
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

  IF jsonb_typeof(p_expected) IS DISTINCT FROM 'object' OR p_expected_revision IS NULL OR p_expected_revision<0 THEN
    RAISE EXCEPTION 'Invalid expected billing snapshot' USING ERRCODE='22023';
  END IF;
  expected_row := jsonb_populate_record(NULL::public.user_subscriptions,p_expected);
  IF expected_row.user_id IS DISTINCT FROM p_user_id OR expected_row.stripe_customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'Expected billing owner or customer differs' USING ERRCODE='22023';
  END IF;
  IF p_patch IS NOT NULL THEN
    IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
       OR NOT (p_patch ?& ARRAY['tier','status','stripe_subscription_id','stripe_price_id','trial_ends_at',
         'current_period_start','current_period_end','cancel_at'])
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN ('tier','status','stripe_subscription_id',
         'stripe_price_id','trial_ends_at','current_period_start','current_period_end','cancel_at')) THEN
      RAISE EXCEPTION 'Invalid billing patch' USING ERRCODE='22023';
    END IF;
    next_row := jsonb_populate_record(NULL::public.user_subscriptions,p_patch-'cancel_at');
    IF (expected_row.stripe_subscription_id IS NOT NULL AND expected_row.stripe_subscription_id<>p_subscription_id)
       OR next_row.tier IS NULL OR next_row.status IS NULL
       OR (next_row.stripe_subscription_id IS NOT NULL AND next_row.stripe_subscription_id<>p_subscription_id)
       OR (next_row.stripe_subscription_id IS NULL AND (next_row.tier<>'free' OR next_row.status<>'canceled'
         OR next_row.stripe_price_id IS NOT NULL OR next_row.trial_ends_at IS NOT NULL))
       OR (next_row.status='canceled' AND next_row.stripe_subscription_id IS NOT NULL)
       OR (expected_row.stripe_subscription_id IS NULL AND
         (next_row.stripe_subscription_id IS NULL OR next_row.tier NOT IN ('pro','enterprise')
           OR next_row.status NOT IN ('active','trialing'))) THEN
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
  END IF;

  notifications := CASE WHEN p_notification IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(p_notification)='object' THEN jsonb_build_array(p_notification)
    ELSE p_notification END;
  IF jsonb_typeof(notifications) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid billing notification list' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(notifications)>3 OR (p_patch IS NULL AND jsonb_array_length(notifications)>0) THEN
    RAISE EXCEPTION 'Invalid billing notification count' USING ERRCODE='22023';
  END IF;
  FOR notification IN SELECT value FROM jsonb_array_elements(notifications) LOOP
    IF jsonb_typeof(notification) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Invalid billing notification payload' USING ERRCODE='22023';
    END IF;
    IF NOT (notification ?& ARRAY['key','template','to','subject','data'])
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(notification) k WHERE k NOT IN ('key','template','to','subject','data'))
       OR jsonb_typeof(notification->'key') IS DISTINCT FROM 'string'
       OR length(notification->>'key') NOT BETWEEN 1 AND 255
       OR (notification->>'key')<>btrim(notification->>'key')
       OR (notification->>'key') ~ '[[:cntrl:]]'
       OR notification_keys ? (notification->>'key')
       OR jsonb_typeof(notification->'template') IS DISTINCT FROM 'string'
       OR (notification->>'template') NOT IN ('subscription-canceled','subscription-cancel-scheduled','trial-ending','payment-succeeded','payment-failed')
       OR jsonb_typeof(notification->'to') IS DISTINCT FROM 'string'
       OR length(notification->>'to') NOT BETWEEN 3 AND 320
       OR (notification->>'to') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
       OR (notification->>'to') ~ '[[:cntrl:]]'
       OR jsonb_typeof(notification->'subject') IS DISTINCT FROM 'string'
       OR length(btrim(notification->>'subject')) NOT BETWEEN 1 AND 500
       OR (notification->>'subject') ~ '[[:cntrl:]]'
       OR jsonb_typeof(notification->'data') IS DISTINCT FROM 'object'
       OR octet_length(notification::text)>65536 THEN
      RAISE EXCEPTION 'Invalid billing notification payload' USING ERRCODE='22023';
    END IF;
    notification_keys := notification_keys || jsonb_build_array(notification->>'key');
  END LOOP;

  -- Guard rows and receipts reference auth.users. Protect that parent BEFORE
  -- taking a guard so an account DELETE cannot hold it while cascading into our
  -- guard, then deadlock with creation of a different missing guard's FK.
  PERFORM u.id FROM auth.users u WHERE u.id=p_user_id FOR KEY SHARE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','stale','user_id',p_user_id); END IF;

  -- Match all active-allocation guards. Actual writes reject stale RR/Serializable
  -- snapshots as well as serializing READ COMMITTED callers. No provider I/O here.
  IF p_patch IS NOT NULL THEN
  INSERT INTO survey_private.project_quota_guards AS g(user_id,revision) VALUES(p_user_id,1)
    ON CONFLICT(user_id) DO UPDATE SET revision=g.revision+1;
  INSERT INTO survey_private.document_quota_guards AS g(user_id,revision) VALUES(p_user_id,1)
    ON CONFLICT(user_id) DO UPDATE SET revision=g.revision+1;
  INSERT INTO survey_private.storage_quota_guards AS g(owner_id,revision) VALUES(p_user_id,1)
    ON CONFLICT(owner_id) DO UPDATE SET revision=g.revision+1;
  END IF;

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
  -- An ignored event uses only the user/subscription locks. Recheck receipts
  -- here too so concurrent ignored deliveries can resolve as exact duplicates.
  SELECT * INTO saved FROM survey_private.billing_transition_receipts WHERE event_id=p_event_id;
  IF FOUND THEN
    IF saved.user_id IS DISTINCT FROM p_user_id OR saved.customer_id IS DISTINCT FROM p_customer_id
       OR saved.subscription_id IS DISTINCT FROM p_subscription_id OR saved.event_type IS DISTINCT FROM p_event_type
       OR saved.event_digest IS DISTINCT FROM p_event_digest THEN
      RAISE EXCEPTION 'Billing event receipt binding changed' USING ERRCODE='22023';
    END IF;
    RETURN saved.result || jsonb_build_object('outcome','duplicate');
  END IF;
  IF current_row.user_id IS DISTINCT FROM p_user_id OR current_row.stripe_customer_id IS DISTINCT FROM p_customer_id
     OR current_row IS DISTINCT FROM expected_row THEN
    RETURN jsonb_build_object('outcome','stale','user_id',p_user_id);
  END IF;
  -- A full-row CAS alone misses a newer no-op provider observation: B can
  -- confirm active without rewriting the row while A still holds past_due.
  -- Advance this separate revision for EVERY new committed event, not by
  -- event.created. Subscription lock precedes head lock, always NOWAIT.
  SELECT revision INTO current_revision FROM survey_private.billing_reconciliation_heads
    WHERE user_id=p_user_id FOR UPDATE NOWAIT;
  current_revision := COALESCE(current_revision,0);
  IF current_revision<>p_expected_revision THEN
    RETURN jsonb_build_object('outcome','stale','user_id',p_user_id);
  END IF;
  IF p_patch IS NULL THEN
    IF current_row.stripe_subscription_id IS NOT DISTINCT FROM p_subscription_id THEN
      RETURN jsonb_build_object('outcome','stale','user_id',p_user_id);
    END IF;
    INSERT INTO survey_private.billing_reconciliation_heads(user_id,revision) VALUES(p_user_id,current_revision+1)
      ON CONFLICT(user_id) DO UPDATE SET revision=EXCLUDED.revision;
    applied := jsonb_build_object('outcome','ignored','user_id',p_user_id,'subscription_changed',false,
      'notification_keys','[]'::jsonb,'revision',(current_revision+1)::text);
    INSERT INTO survey_private.billing_transition_receipts(event_id,user_id,customer_id,subscription_id,event_type,event_digest,result)
      VALUES(p_event_id,p_user_id,p_customer_id,p_subscription_id,p_event_type,p_event_digest,applied);
    RETURN applied;
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
  INSERT INTO survey_private.billing_reconciliation_heads(user_id,revision) VALUES(p_user_id,current_revision+1)
    ON CONFLICT(user_id) DO UPDATE SET revision=EXCLUDED.revision;
  applied := applied || jsonb_build_object('notification_keys',notification_keys,'revision',(current_revision+1)::text);
  IF jsonb_array_length(notification_keys)>0 THEN
    applied := applied || jsonb_build_object('notification_key',notification_keys->>0);
  END IF;
  INSERT INTO survey_private.billing_transition_receipts(event_id,user_id,customer_id,subscription_id,event_type,event_digest,result)
    VALUES(p_event_id,p_user_id,p_customer_id,p_subscription_id,p_event_type,p_event_digest,applied);
  FOR notification IN SELECT value FROM jsonb_array_elements(notifications) LOOP
    -- The first semantic notification freezes its payload. A sibling event's
    -- receipt points at the same user/key and can flush that existing outbox.
    INSERT INTO survey_private.billing_notification_outbox(event_id,user_id,notification_key,payload)
      VALUES(p_event_id,p_user_id,notification->>'key',notification)
      ON CONFLICT(user_id,notification_key) DO NOTHING;
    PERFORM id FROM survey_private.billing_notification_outbox WHERE user_id=p_user_id AND notification_key=notification->>'key';
    IF NOT FOUND THEN RAISE EXCEPTION 'Notification intent did not persist' USING ERRCODE='40001'; END IF;
  END LOOP;
  RETURN applied;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_billing_notification(p_event_id text,p_claim_token uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET timezone='UTC' SET lock_timeout='2s'
AS $$
DECLARE saved survey_private.billing_transition_receipts%ROWTYPE;
  item survey_private.billing_notification_outbox%ROWTYPE;
  answer jsonb; observed_at timestamptz; selected_key text; keys jsonb;
BEGIN
  PERFORM survey_private.require_billing_service();
  IF p_event_id IS NULL OR p_event_id !~ '^evt_[A-Za-z0-9_]+$' OR length(p_event_id)>255 OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Invalid notification claim' USING ERRCODE='22023';
  END IF;
  SELECT * INTO saved FROM survey_private.billing_transition_receipts WHERE event_id=p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','none','payload',NULL,'provider_key',NULL);
  END IF;
  keys := COALESCE(saved.result->'notification_keys',
    CASE WHEN saved.result->>'notification_key' IS NOT NULL THEN jsonb_build_array(saved.result->>'notification_key') ELSE '[]'::jsonb END);
  IF jsonb_array_length(keys)=0 THEN RETURN jsonb_build_object('outcome','none','payload',NULL,'provider_key',NULL); END IF;
  PERFORM id FROM auth.users WHERE id=saved.user_id FOR KEY SHARE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','none','payload',NULL,'provider_key',NULL); END IF;
  FOR selected_key IN SELECT value FROM jsonb_array_elements_text(keys) LOOP
    BEGIN
      SELECT o.* INTO item FROM survey_private.billing_notification_outbox o
        WHERE o.user_id=saved.user_id AND o.notification_key=selected_key FOR UPDATE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      RETURN jsonb_build_object('outcome','busy','payload',NULL,'provider_key',NULL);
    END;
    IF NOT FOUND THEN RAISE EXCEPTION 'Notification intent is unavailable' USING ERRCODE='40001'; END IF;
    EXIT WHEN item.state<>'sent';
  END LOOP;
  answer := jsonb_build_object('payload',item.payload,'provider_key',item.id::text);
  IF item.state='sent' THEN RETURN answer || jsonb_build_object('outcome','sent'); END IF;
  IF item.state='needs_review' THEN RETURN answer || jsonb_build_object('outcome','needs_review'); END IF;
  observed_at := clock_timestamp();
  -- Pending can wait indefinitely before its first send. Once any send may
  -- have reached the provider, retries must stay inside its safe key window.
  IF item.first_attempt_at IS NOT NULL AND observed_at+interval '35 seconds'>=item.first_attempt_at+interval '25 minutes' THEN
    UPDATE survey_private.billing_notification_outbox SET state='needs_review' WHERE id=item.id;
    RETURN answer || jsonb_build_object('outcome','needs_review');
  END IF;
  IF item.state='sending' AND item.lease_expires_at>observed_at THEN
    RETURN answer || jsonb_build_object('outcome','busy');
  END IF;
  UPDATE survey_private.billing_notification_outbox SET state='sending',claim_token=p_claim_token,
    first_attempt_at=COALESCE(first_attempt_at,observed_at),lease_expires_at=observed_at+interval '2 minutes'
    WHERE id=item.id RETURNING * INTO item;
  IF NOT FOUND THEN RAISE EXCEPTION 'Notification claim did not persist' USING ERRCODE='40001'; END IF;
  RETURN answer || jsonb_build_object('outcome','claimed',
    'send_by',LEAST(item.lease_expires_at,item.first_attempt_at+interval '25 minutes'));
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_billing_notification(
  p_event_id text,p_claim_token uuid,p_provider_message_id text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET timezone='UTC' SET lock_timeout='2s'
AS $$
DECLARE saved survey_private.billing_transition_receipts%ROWTYPE;
  item survey_private.billing_notification_outbox%ROWTYPE;
  keys jsonb;
BEGIN
  PERFORM survey_private.require_billing_service();
  IF p_event_id IS NULL OR p_event_id !~ '^evt_[A-Za-z0-9_]+$' OR length(p_event_id)>255 OR p_claim_token IS NULL
     OR p_provider_message_id IS NULL OR length(btrim(p_provider_message_id)) NOT BETWEEN 1 AND 255
     OR p_provider_message_id ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid notification completion' USING ERRCODE='22023';
  END IF;
  SELECT * INTO saved FROM survey_private.billing_transition_receipts WHERE event_id=p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification receipt is unavailable' USING ERRCODE='40001';
  END IF;
  keys := COALESCE(saved.result->'notification_keys',
    CASE WHEN saved.result->>'notification_key' IS NOT NULL THEN jsonb_build_array(saved.result->>'notification_key') ELSE '[]'::jsonb END);
  PERFORM id FROM auth.users WHERE id=saved.user_id FOR KEY SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Notification owner is unavailable' USING ERRCODE='40001'; END IF;
  SELECT * INTO item FROM survey_private.billing_notification_outbox
    WHERE user_id=saved.user_id AND claim_token=p_claim_token
      AND notification_key IN (SELECT value FROM jsonb_array_elements_text(keys)) FOR UPDATE NOWAIT;
  IF NOT FOUND OR item.claim_token IS DISTINCT FROM p_claim_token OR item.state='pending' THEN
    RAISE EXCEPTION 'Notification claim changed' USING ERRCODE='40001';
  END IF;
  IF item.state='sent' THEN
    IF item.provider_message_id IS DISTINCT FROM p_provider_message_id THEN
      RAISE EXCEPTION 'Notification completion differs' USING ERRCODE='40001';
    END IF;
    RETURN jsonb_build_object('outcome','sent','provider_key',item.id::text);
  END IF;
  -- A late, confirmed reply may resolve needs_review, but only its last claim
  -- token can acknowledge it. Older tokens never acknowledge a newer claim.
  UPDATE survey_private.billing_notification_outbox SET state='sent',sent_at=clock_timestamp(),
    provider_message_id=p_provider_message_id,lease_expires_at=NULL WHERE id=item.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Notification completion did not persist' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('outcome','sent','provider_key',item.id::text);
END;
$$;

ALTER FUNCTION public.lookup_billing_event(text,text,text,text,text) OWNER TO postgres;
ALTER FUNCTION public.read_billing_subscription_snapshot(text) OWNER TO postgres;
ALTER FUNCTION public.reconcile_billing_subscription_event(uuid,text,text,jsonb,jsonb,text,text,text,jsonb,bigint) OWNER TO postgres;
ALTER FUNCTION public.claim_billing_notification(text,uuid) OWNER TO postgres;
ALTER FUNCTION public.complete_billing_notification(text,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.lookup_billing_event(text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.read_billing_subscription_snapshot(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reconcile_billing_subscription_event(uuid,text,text,jsonb,jsonb,text,text,text,jsonb,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_billing_notification(text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_billing_notification(text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_billing_event(text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_billing_subscription_snapshot(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_billing_subscription_event(uuid,text,text,jsonb,jsonb,text,text,text,jsonb,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_billing_notification(text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_billing_notification(text,uuid,text) TO service_role;
COMMENT ON TABLE survey_private.billing_notification_outbox IS
  'Frozen billing email intent, atomic with receipt. No scheduler. Provider key is id; unknown sends retain sending until lease expiry and stop retrying after25minutes.';
COMMIT;
