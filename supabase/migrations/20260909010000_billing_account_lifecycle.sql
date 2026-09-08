-- Admission is permission for ONE provider attempt, not a renewable lease.
-- A lost/unknown provider reply leaves pending work forever until a separate,
-- verified recovery protocol resolves it. Exact begin replays NEVER authorize
-- another call. No provider I/O, auth trigger, or auth deletion occurs here.
-- Thus this is an endpoint-protocol boundary, not a universal auth-delete gate.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
-- Freeze binding writers until their current owners have permanent receipts.
LOCK TABLE public.user_subscriptions IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS survey_private.billing_customer_owners (
  customer_id text PRIMARY KEY CHECK(length(customer_id) BETWEEN 1 AND 255),
  user_id uuid NOT NULL
);
-- Deliberately matches the existing globally unique, unscoped customer column.
-- Same-account rotations remain valid; customer ownership transfers do not.
-- This no-FK ownership receipt survives clearing bindings and deleting auth.
ALTER TABLE survey_private.billing_customer_owners OWNER TO postgres;
ALTER TABLE survey_private.billing_customer_owners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.billing_customer_owners FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS survey_private.billing_account_lifecycles (
  user_id uuid PRIMARY KEY,
  closing boolean NOT NULL DEFAULT false,
  provider_scope jsonb,
  closing_xid xid8,
  cleanup_cursor_scope jsonb,
  cleanup_cursor_customer text,
  CHECK ((cleanup_cursor_scope IS NULL)=(cleanup_cursor_customer IS NULL)),
  CHECK ((closing AND provider_scope IS NOT NULL AND closing_xid IS NOT NULL)
    OR (NOT closing AND provider_scope IS NULL AND closing_xid IS NULL))
);
CREATE TABLE IF NOT EXISTS survey_private.billing_operations (
  operation_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('customer_create','checkout_create','portal_create')),
  provider_scope jsonb NOT NULL,
  request_spec jsonb NOT NULL CHECK(jsonb_typeof(request_spec)='object' AND octet_length(request_spec::text)<=16384),
  expected_customer_id text,
  admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','settled')),
  result jsonb,
  CHECK ((state='pending' AND result IS NULL) OR (state='settled' AND result IS NOT NULL))
);
-- Server-owned provenance, never renewed by replay or settlement. Stripe's
-- minimum 24-hour idempotency retention does not authorize re-execution without
-- a separate recovery protocol; old operations remain pending indefinitely.
COMMENT ON COLUMN survey_private.billing_operations.admitted_at IS
  'Immutable server admission time for future verified recovery; no expiry or replay authority.';
CREATE INDEX IF NOT EXISTS billing_operations_unresolved ON survey_private.billing_operations(user_id,operation_id) WHERE state='pending';
CREATE TABLE IF NOT EXISTS survey_private.billing_customer_cleanup (
  user_id uuid NOT NULL,
  provider_scope jsonb NOT NULL,
  customer_id text NOT NULL CHECK(length(customer_id) BETWEEN 1 AND 255),
  removed boolean NOT NULL DEFAULT false,
  PRIMARY KEY(user_id,provider_scope,customer_id)
);
CREATE INDEX IF NOT EXISTS billing_customer_cleanup_pending
  ON survey_private.billing_customer_cleanup(user_id,provider_scope,customer_id) WHERE NOT removed;
-- No lifecycle FKs: unsettled operations and confirmed cleanup receipts must
-- survive auth deletion. Never purge these records on a timer.
ALTER TABLE survey_private.billing_account_lifecycles OWNER TO postgres;
ALTER TABLE survey_private.billing_operations OWNER TO postgres;
ALTER TABLE survey_private.billing_customer_cleanup OWNER TO postgres;
ALTER TABLE survey_private.billing_account_lifecycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_private.billing_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_private.billing_customer_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.billing_account_lifecycles,survey_private.billing_operations,
  survey_private.billing_customer_cleanup FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION survey_private.require_billing_lifecycle_call(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM survey_private.require_billing_service();
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'Billing actor is required' USING ERRCODE='22023'; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Billing lifecycle requires READ COMMITTED' USING ERRCODE='25001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.validate_billing_provider_scope(p_scope jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
  IF jsonb_typeof(p_scope) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid billing provider scope' USING ERRCODE='22023';
  END IF;
  IF NOT(p_scope ?& ARRAY['mode','account','api_version'])
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_scope) k WHERE k NOT IN ('mode','account','api_version'))
    OR jsonb_typeof(p_scope->'mode') IS DISTINCT FROM 'string' OR p_scope->>'mode' NOT IN ('test','live')
    OR jsonb_typeof(p_scope->'account') IS DISTINCT FROM 'string'
    OR (p_scope->>'account'<>'platform' AND p_scope->>'account' !~ '^acct_[A-Za-z0-9]+$')
    OR length(p_scope->>'account')>255
    OR jsonb_typeof(p_scope->'api_version') IS DISTINCT FROM 'string'
    OR p_scope->>'api_version' !~ '^[A-Za-z0-9._-]{1,64}$' THEN
    RAISE EXCEPTION 'Invalid billing provider scope' USING ERRCODE='22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.lock_billing_lifecycle(p_user_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
BEGIN
  INSERT INTO survey_private.billing_account_lifecycles(user_id) VALUES(p_user_id) ON CONFLICT DO NOTHING;
  PERFORM user_id FROM survey_private.billing_account_lifecycles WHERE user_id=p_user_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Billing lifecycle changed' USING ERRCODE='40001'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.assert_billing_account_open(p_user_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE is_closing boolean;
BEGIN
  INSERT INTO survey_private.account_write_guards(user_id,closing) VALUES(p_user_id,false) ON CONFLICT DO NOTHING;
  -- Subscription BEFORE triggers already hold the subscription tuple. Never
  -- wait for an account lock that closure holds while seeking that tuple.
  SELECT closing INTO is_closing FROM survey_private.account_write_guards WHERE user_id=p_user_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account guard changed' USING ERRCODE='40001'; END IF;
  IF is_closing THEN RAISE EXCEPTION 'ACCOUNT_CLOSING' USING ERRCODE='23514'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.register_billing_customer_owner(p_user_id uuid,p_customer_id text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE registered_owner uuid;
BEGIN
  IF p_user_id IS NULL OR p_customer_id IS NULL OR length(p_customer_id) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'Invalid billing customer owner' USING ERRCODE='22023';
  END IF;
  -- Binding triggers already hold subscription tuples; never wait on the
  -- reverse customer -> subscription order used by another transaction.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('survey:billing-customer-owner:' || p_customer_id,0)) THEN
    RAISE EXCEPTION 'Billing customer owner is busy' USING ERRCODE='55P03';
  END IF;
  INSERT INTO survey_private.billing_customer_owners(customer_id,user_id)
    VALUES(p_customer_id,p_user_id) ON CONFLICT(customer_id) DO NOTHING;
  SELECT user_id INTO registered_owner FROM survey_private.billing_customer_owners
    WHERE customer_id=p_customer_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Billing customer owner changed' USING ERRCODE='40001'; END IF;
  IF registered_owner IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Billing customer belongs to another account' USING ERRCODE='23514';
  END IF;
END;
$$;

-- Migration-only set-based backfill: taking one transaction advisory lock per
-- historic customer would exhaust shared lock memory on large installations.
-- These brief table locks freeze registration instead. The full history scan
-- still requires an installation-size/lock-window review before deployment.
LOCK TABLE survey_private.billing_customer_owners,survey_private.billing_customer_cleanup IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM (
    SELECT stripe_customer_id AS customer_id,user_id FROM public.user_subscriptions WHERE stripe_customer_id IS NOT NULL
    UNION SELECT customer_id,user_id FROM survey_private.billing_customer_cleanup
    UNION SELECT customer_id,user_id FROM survey_private.billing_customer_owners
  ) owners GROUP BY customer_id HAVING count(DISTINCT user_id)>1) THEN
    RAISE EXCEPTION 'Conflicting historic billing customer owners' USING ERRCODE='23514';
  END IF;
  INSERT INTO survey_private.billing_customer_owners(customer_id,user_id)
    SELECT customer_id,user_id FROM (
      SELECT stripe_customer_id AS customer_id,user_id FROM public.user_subscriptions WHERE stripe_customer_id IS NOT NULL
      UNION SELECT customer_id,user_id FROM survey_private.billing_customer_cleanup
    ) owners ORDER BY customer_id,user_id ON CONFLICT(customer_id) DO NOTHING;
  IF EXISTS(SELECT 1 FROM (
    SELECT stripe_customer_id AS customer_id,user_id FROM public.user_subscriptions WHERE stripe_customer_id IS NOT NULL
    UNION SELECT customer_id,user_id FROM survey_private.billing_customer_cleanup
  ) expected LEFT JOIN survey_private.billing_customer_owners saved USING(customer_id)
    WHERE saved.user_id IS DISTINCT FROM expected.user_id) THEN
    RAISE EXCEPTION 'Billing customer owner backfill differs' USING ERRCODE='23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.guard_billing_customer_binding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE previous_owner uuid; account_id uuid; previous_customer text; binding record;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.user_id IS NOT DISTINCT FROM OLD.user_id
      AND NEW.stripe_customer_id IS NOT DISTINCT FROM OLD.stripe_customer_id THEN RETURN NEW; END IF;
    previous_owner := OLD.user_id;
    previous_customer := OLD.stripe_customer_id;
  END IF;
  -- Preserve legacy open-account recovery while the new runner is unwired.
  -- Deployment still requires every rotation/clear to record its OLD scoped
  -- customer first. The legacy subscription row has no provider scope, so SQL
  -- cannot infer that namespace or recover pre-ledger orphan customers.
  FOR account_id IN SELECT DISTINCT id FROM unnest(ARRAY[previous_owner,NEW.user_id]) id
    WHERE id IS NOT NULL ORDER BY id LOOP
    PERFORM survey_private.assert_billing_account_open(account_id);
  END LOOP;
  FOR binding IN SELECT DISTINCT customer_id,user_id FROM (
    VALUES(previous_customer,previous_owner),(NEW.stripe_customer_id,NEW.user_id)
  ) owners(customer_id,user_id) WHERE customer_id IS NOT NULL ORDER BY customer_id,user_id LOOP
    PERFORM survey_private.register_billing_customer_owner(binding.user_id,binding.customer_id);
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER a_billing_customer_binding BEFORE INSERT OR UPDATE OF user_id,stripe_customer_id
  ON public.user_subscriptions FOR EACH ROW EXECUTE FUNCTION survey_private.guard_billing_customer_binding();

CREATE OR REPLACE FUNCTION public.begin_billing_operation(p_operation_id uuid,p_user_id uuid,p_kind text,
  p_provider_scope jsonb,p_request_spec jsonb,p_expected_customer_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE saved survey_private.billing_operations%ROWTYPE; current_customer text;
BEGIN
  PERFORM survey_private.require_billing_lifecycle_call(p_user_id);
  PERFORM survey_private.validate_billing_provider_scope(p_provider_scope);
  IF p_operation_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('customer_create','checkout_create','portal_create')
    OR jsonb_typeof(p_request_spec) IS DISTINCT FROM 'object' OR octet_length(p_request_spec::text)>16384
    OR (p_kind='customer_create' AND p_expected_customer_id IS NOT NULL)
    OR (p_kind<>'customer_create' AND (p_expected_customer_id IS NULL OR p_expected_customer_id !~ '^cus_[A-Za-z0-9]+$' OR length(p_expected_customer_id)>255)) THEN
    RAISE EXCEPTION 'Invalid billing operation' USING ERRCODE='22023';
  END IF;
  SELECT * INTO saved FROM survey_private.billing_operations WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF ROW(saved.user_id,saved.kind,saved.provider_scope,saved.request_spec,saved.expected_customer_id)
      IS DISTINCT FROM ROW(p_user_id,p_kind,p_provider_scope,p_request_spec,p_expected_customer_id) THEN
      RAISE EXCEPTION 'Billing operation identity changed' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('outcome',saved.state,'operation_id',saved.operation_id,'state',saved.state,'result',saved.result,
      'admitted_at',saved.admitted_at);
  END IF;
  PERFORM id FROM auth.users WHERE id=p_user_id FOR KEY SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Billing actor does not exist' USING ERRCODE='23503'; END IF;
  PERFORM survey_private.assert_billing_account_open(p_user_id);
  PERFORM survey_private.lock_billing_lifecycle(p_user_id);
  IF EXISTS(SELECT 1 FROM survey_private.billing_account_lifecycles WHERE user_id=p_user_id AND closing) THEN
    RAISE EXCEPTION 'ACCOUNT_CLOSING' USING ERRCODE='23514';
  END IF;
  SELECT stripe_customer_id INTO current_customer FROM public.user_subscriptions WHERE user_id=p_user_id FOR SHARE NOWAIT;
  IF current_customer IS DISTINCT FROM p_expected_customer_id THEN
    RAISE EXCEPTION 'Billing customer binding changed' USING ERRCODE='40001';
  END IF;
  INSERT INTO survey_private.billing_operations(operation_id,user_id,kind,provider_scope,request_spec,expected_customer_id)
    VALUES(p_operation_id,p_user_id,p_kind,p_provider_scope,p_request_spec,p_expected_customer_id)
    ON CONFLICT(operation_id) DO NOTHING RETURNING * INTO saved;
  IF NOT FOUND THEN
    -- Includes cross-actor UUID collisions. Read the winner and validate ALL
    -- identity fields; a conflict is never a second execution permission.
    SELECT * INTO saved FROM survey_private.billing_operations WHERE operation_id=p_operation_id;
    IF saved.operation_id IS NULL THEN RAISE EXCEPTION 'Billing operation changed' USING ERRCODE='40001'; END IF;
    IF ROW(saved.user_id,saved.kind,saved.provider_scope,saved.request_spec,saved.expected_customer_id)
      IS DISTINCT FROM ROW(p_user_id,p_kind,p_provider_scope,p_request_spec,p_expected_customer_id) THEN
      RAISE EXCEPTION 'Billing operation identity changed' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('outcome',saved.state,'operation_id',saved.operation_id,'state',saved.state,'result',saved.result,
      'admitted_at',saved.admitted_at);
  END IF;
  IF p_expected_customer_id IS NOT NULL THEN
    PERFORM survey_private.register_billing_customer_owner(p_user_id,p_expected_customer_id);
    INSERT INTO survey_private.billing_customer_cleanup(user_id,provider_scope,customer_id)
      VALUES(p_user_id,p_provider_scope,p_expected_customer_id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN jsonb_build_object('outcome','admitted','operation_id',p_operation_id,'state','pending','result',NULL,
    'admitted_at',saved.admitted_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_billing_operation(p_operation_id uuid,p_user_id uuid,p_kind text,
  p_provider_scope jsonb,p_request_spec jsonb,p_expected_customer_id text,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE saved survey_private.billing_operations%ROWTYPE; customer text;
BEGIN
  PERFORM survey_private.require_billing_lifecycle_call(p_user_id);
  PERFORM survey_private.validate_billing_provider_scope(p_provider_scope);
  IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid confirmed billing result' USING ERRCODE='22023';
  END IF;
  IF NOT(p_result ?& ARRAY['outcome','customer_id','data'])
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_result) k WHERE k NOT IN ('outcome','customer_id','data'))
    OR jsonb_typeof(p_result->'outcome') IS DISTINCT FROM 'string' OR p_result->>'outcome' NOT IN ('succeeded','failed')
    OR jsonb_typeof(p_result->'data') IS DISTINCT FROM 'object' OR octet_length(p_result::text)>16384
    OR jsonb_typeof(p_result->'customer_id') NOT IN ('string','null') THEN
    RAISE EXCEPTION 'Invalid confirmed billing result' USING ERRCODE='22023';
  END IF;
  customer := p_result->>'customer_id';
  IF customer IS NOT NULL AND (customer !~ '^cus_[A-Za-z0-9]+$' OR length(customer)>255) THEN
    RAISE EXCEPTION 'Invalid result customer' USING ERRCODE='22023';
  END IF;
  PERFORM survey_private.lock_billing_lifecycle(p_user_id);
  SELECT * INTO saved FROM survey_private.billing_operations WHERE operation_id=p_operation_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR ROW(saved.user_id,saved.kind,saved.provider_scope,saved.request_spec,saved.expected_customer_id)
    IS DISTINCT FROM ROW(p_user_id,p_kind,p_provider_scope,p_request_spec,p_expected_customer_id) THEN
    RAISE EXCEPTION 'Billing operation identity changed' USING ERRCODE='22023';
  END IF;
  IF (saved.kind='customer_create' AND ((p_result->>'outcome'='succeeded' AND customer IS NULL)
      OR (p_result->>'outcome'='failed' AND customer IS NOT NULL)))
    OR (saved.kind<>'customer_create' AND customer IS DISTINCT FROM saved.expected_customer_id) THEN
    RAISE EXCEPTION 'Billing result customer differs' USING ERRCODE='22023';
  END IF;
  IF saved.state='settled' THEN
    IF saved.result IS DISTINCT FROM p_result THEN RAISE EXCEPTION 'Billing result changed' USING ERRCODE='22023'; END IF;
  ELSE
    -- Record a successful customer even after closure or a lost binding CAS.
    -- This transaction deliberately does NOT attempt to bind subscriptions.
    IF customer IS NOT NULL THEN
      PERFORM survey_private.register_billing_customer_owner(p_user_id,customer);
      INSERT INTO survey_private.billing_customer_cleanup(user_id,provider_scope,customer_id)
        VALUES(p_user_id,p_provider_scope,customer) ON CONFLICT DO NOTHING;
    END IF;
    UPDATE survey_private.billing_operations SET state='settled',result=p_result WHERE operation_id=p_operation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Billing settlement did not persist' USING ERRCODE='40001'; END IF;
  END IF;
  RETURN jsonb_build_object('outcome','settled','operation_id',p_operation_id,'state','settled','result',p_result,
    'admitted_at',saved.admitted_at);
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.billing_closure_status(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE lifecycle survey_private.billing_account_lifecycles%ROWTYPE; current_customer text;
  pending_ops boolean; pending_customers boolean; covered boolean;
BEGIN
  SELECT * INTO lifecycle FROM survey_private.billing_account_lifecycles WHERE user_id=p_user_id;
  SELECT stripe_customer_id INTO current_customer FROM public.user_subscriptions WHERE user_id=p_user_id FOR SHARE NOWAIT;
  SELECT EXISTS(SELECT 1 FROM survey_private.billing_operations WHERE user_id=p_user_id AND state='pending') INTO pending_ops;
  SELECT EXISTS(SELECT 1 FROM survey_private.billing_customer_cleanup WHERE user_id=p_user_id AND NOT removed) INTO pending_customers;
  covered := current_customer IS NULL OR EXISTS(SELECT 1 FROM survey_private.billing_customer_cleanup
    WHERE user_id=p_user_id AND provider_scope=lifecycle.provider_scope AND customer_id=current_customer AND removed);
  RETURN jsonb_build_object('closing',COALESCE(lifecycle.closing,false),'has_pending_operations',pending_ops,
    'has_pending_customers',pending_customers,'current_customer_covered',covered,
    -- Never report completion from an uncommitted closure, even after a
    -- savepoint. pg_current_xact_id() identifies the whole top transaction.
    'complete',COALESCE(lifecycle.closing,false) AND lifecycle.closing_xid IS DISTINCT FROM pg_current_xact_id()
      AND NOT pending_ops AND NOT pending_customers AND covered);
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_billing_account_closure(p_user_id uuid,p_provider_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE lifecycle survey_private.billing_account_lifecycles%ROWTYPE; current_customer text;
BEGIN
  PERFORM survey_private.require_billing_lifecycle_call(p_user_id);
  PERFORM survey_private.validate_billing_provider_scope(p_provider_scope);
  SELECT * INTO lifecycle FROM survey_private.billing_account_lifecycles WHERE user_id=p_user_id;
  IF lifecycle.closing THEN
    PERFORM survey_private.lock_billing_lifecycle(p_user_id);
    IF lifecycle.provider_scope IS DISTINCT FROM p_provider_scope THEN
      RAISE EXCEPTION 'Billing closure provider scope changed' USING ERRCODE='22023';
    END IF;
    RETURN survey_private.billing_closure_status(p_user_id);
  END IF;
  PERFORM id FROM auth.users WHERE id=p_user_id FOR KEY SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Billing actor does not exist' USING ERRCODE='23503'; END IF;
  INSERT INTO survey_private.account_write_guards(user_id,closing) VALUES(p_user_id,false) ON CONFLICT DO NOTHING;
  PERFORM user_id FROM survey_private.account_write_guards WHERE user_id=p_user_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account guard changed' USING ERRCODE='40001'; END IF;
  PERFORM survey_private.lock_billing_lifecycle(p_user_id);
  SELECT * INTO lifecycle FROM survey_private.billing_account_lifecycles WHERE user_id=p_user_id;
  IF lifecycle.closing AND lifecycle.provider_scope IS DISTINCT FROM p_provider_scope THEN
    RAISE EXCEPTION 'Billing closure provider scope changed' USING ERRCODE='22023';
  END IF;
  SELECT stripe_customer_id INTO current_customer FROM public.user_subscriptions WHERE user_id=p_user_id FOR SHARE NOWAIT;
  UPDATE survey_private.account_write_guards SET closing=true WHERE user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account closure did not persist' USING ERRCODE='40001'; END IF;
  UPDATE survey_private.billing_account_lifecycles SET closing=true,provider_scope=p_provider_scope,
    closing_xid=COALESCE(closing_xid,pg_current_xact_id()) WHERE user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Billing closure did not persist' USING ERRCODE='40001'; END IF;
  IF current_customer IS NOT NULL THEN
    PERFORM survey_private.register_billing_customer_owner(p_user_id,current_customer);
    INSERT INTO survey_private.billing_customer_cleanup(user_id,provider_scope,customer_id)
      VALUES(p_user_id,p_provider_scope,current_customer) ON CONFLICT DO NOTHING;
  END IF;
  RETURN survey_private.billing_closure_status(p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_billing_customer_cleanup(p_user_id uuid,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE status jsonb; customers jsonb; cursor_scope jsonb; cursor_customer text; last_candidate jsonb;
BEGIN
  PERFORM survey_private.require_billing_lifecycle_call(p_user_id);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid cleanup limit' USING ERRCODE='22023'; END IF;
  PERFORM survey_private.lock_billing_lifecycle(p_user_id);
  status := survey_private.billing_closure_status(p_user_id);
  IF NOT(status->>'closing')::boolean THEN RAISE EXCEPTION 'Billing account is not closing' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM survey_private.billing_account_lifecycles
    WHERE user_id=p_user_id AND closing_xid=pg_current_xact_id()) THEN
    RAISE EXCEPTION 'Billing closure must commit before cleanup' USING ERRCODE='23514';
  END IF;
  customers := '[]'::jsonb;
  IF NOT(status->>'has_pending_operations')::boolean THEN
    SELECT cleanup_cursor_scope,cleanup_cursor_customer INTO cursor_scope,cursor_customer
      FROM survey_private.billing_account_lifecycles WHERE user_id=p_user_id;
    IF cursor_scope IS NOT NULL THEN
      -- Keep the tuple range outside nullable-OR predicates so a cached
      -- generic plan can still seek the partial index at the saved key.
      SELECT COALESCE(jsonb_agg(jsonb_build_object('provider_scope',provider_scope,'customer_id',customer_id)
        ORDER BY provider_scope,customer_id),'[]'::jsonb) INTO customers FROM (
        SELECT provider_scope,customer_id FROM survey_private.billing_customer_cleanup
          WHERE user_id=p_user_id AND NOT removed
            AND ROW(provider_scope,customer_id)>ROW(cursor_scope,cursor_customer)
          ORDER BY provider_scope,customer_id LIMIT p_limit
      ) candidates;
    END IF;
    IF jsonb_array_length(customers)=0 THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('provider_scope',provider_scope,'customer_id',customer_id)
        ORDER BY provider_scope,customer_id),'[]'::jsonb) INTO customers FROM (
        SELECT provider_scope,customer_id FROM survey_private.billing_customer_cleanup
          WHERE user_id=p_user_id AND NOT removed ORDER BY provider_scope,customer_id LIMIT p_limit
      ) candidates;
    END IF;
    -- A failed oldest page cannot starve later customers. Lost claim replies
    -- skip work only until the next cycle; no candidate receipt is removed.
    last_candidate := customers->-1;
    UPDATE survey_private.billing_account_lifecycles SET
      cleanup_cursor_scope=last_candidate->'provider_scope',cleanup_cursor_customer=last_candidate->>'customer_id'
      WHERE user_id=p_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Billing cleanup cursor did not persist' USING ERRCODE='40001'; END IF;
  END IF;
  -- Deletion of an exact provider customer must be idempotent. Claim is a
  -- repeatable candidate read, not execution authority for customer creation.
  RETURN status || jsonb_build_object('customers',customers);
END;
$$;

CREATE OR REPLACE FUNCTION public.ack_billing_customer_cleanup(p_user_id uuid,p_provider_scope jsonb,p_customer_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE status jsonb;
BEGIN
  PERFORM survey_private.require_billing_lifecycle_call(p_user_id);
  PERFORM survey_private.validate_billing_provider_scope(p_provider_scope);
  IF p_customer_id IS NULL OR length(p_customer_id) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'Invalid cleanup customer' USING ERRCODE='22023';
  END IF;
  PERFORM survey_private.lock_billing_lifecycle(p_user_id);
  status := survey_private.billing_closure_status(p_user_id);
  IF NOT(status->>'closing')::boolean OR (status->>'has_pending_operations')::boolean THEN
    RAISE EXCEPTION 'Billing cleanup is not ready' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM survey_private.billing_account_lifecycles
    WHERE user_id=p_user_id AND closing_xid=pg_current_xact_id()) THEN
    RAISE EXCEPTION 'Billing closure must commit before cleanup' USING ERRCODE='23514';
  END IF;
  UPDATE survey_private.billing_customer_cleanup SET removed=true
    WHERE user_id=p_user_id AND provider_scope=p_provider_scope AND customer_id=p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cleanup customer was not registered' USING ERRCODE='22023'; END IF;
  RETURN survey_private.billing_closure_status(p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.read_billing_account_closure(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
BEGIN
  PERFORM survey_private.require_billing_lifecycle_call(p_user_id);
  PERFORM survey_private.lock_billing_lifecycle(p_user_id);
  RETURN survey_private.billing_closure_status(p_user_id);
END;
$$;

ALTER FUNCTION survey_private.require_billing_lifecycle_call(uuid) OWNER TO postgres;
ALTER FUNCTION survey_private.validate_billing_provider_scope(jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.lock_billing_lifecycle(uuid) OWNER TO postgres;
ALTER FUNCTION survey_private.assert_billing_account_open(uuid) OWNER TO postgres;
ALTER FUNCTION survey_private.register_billing_customer_owner(uuid,text) OWNER TO postgres;
ALTER FUNCTION survey_private.guard_billing_customer_binding() OWNER TO postgres;
ALTER FUNCTION survey_private.billing_closure_status(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.require_billing_lifecycle_call(uuid),survey_private.validate_billing_provider_scope(jsonb),
  survey_private.lock_billing_lifecycle(uuid),survey_private.assert_billing_account_open(uuid),
  survey_private.register_billing_customer_owner(uuid,text),
  survey_private.guard_billing_customer_binding(),survey_private.billing_closure_status(uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.begin_billing_operation(uuid,uuid,text,jsonb,jsonb,text) OWNER TO postgres;
ALTER FUNCTION public.settle_billing_operation(uuid,uuid,text,jsonb,jsonb,text,jsonb) OWNER TO postgres;
ALTER FUNCTION public.begin_billing_account_closure(uuid,jsonb) OWNER TO postgres;
ALTER FUNCTION public.claim_billing_customer_cleanup(uuid,integer) OWNER TO postgres;
ALTER FUNCTION public.ack_billing_customer_cleanup(uuid,jsonb,text) OWNER TO postgres;
ALTER FUNCTION public.read_billing_account_closure(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.begin_billing_operation(uuid,uuid,text,jsonb,jsonb,text),
  public.settle_billing_operation(uuid,uuid,text,jsonb,jsonb,text,jsonb),public.begin_billing_account_closure(uuid,jsonb),
  public.claim_billing_customer_cleanup(uuid,integer),public.ack_billing_customer_cleanup(uuid,jsonb,text),
  public.read_billing_account_closure(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.begin_billing_operation(uuid,uuid,text,jsonb,jsonb,text),
  public.settle_billing_operation(uuid,uuid,text,jsonb,jsonb,text,jsonb),public.begin_billing_account_closure(uuid,jsonb),
  public.claim_billing_customer_cleanup(uuid,integer),public.ack_billing_customer_cleanup(uuid,jsonb,text),
  public.read_billing_account_closure(uuid) TO service_role;
COMMIT;
