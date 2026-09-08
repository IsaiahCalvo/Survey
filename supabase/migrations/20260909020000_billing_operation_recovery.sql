-- Recovery reads never grant permission for a provider POST. Unknown customer
-- creation remains pending without an age limit; a separate verified protocol
-- must resolve it. Provider scope and deletion proof are attested by the trusted
-- caller, never inferred from customer spelling or supplied JWT role claims.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

ALTER TABLE survey_private.billing_account_lifecycles
  ADD COLUMN IF NOT EXISTS pending_operation_cursor uuid;
ALTER TABLE survey_private.billing_operations
  ADD COLUMN IF NOT EXISTS recovery_cursor text CHECK(recovery_cursor IS NULL OR
    (length(recovery_cursor)<=255 AND (
      (kind='checkout_create' AND recovery_cursor ~ '^cs_((test|live)_)?[A-Za-z0-9]+$') OR
      (kind='portal_create' AND recovery_cursor ~ '^evt_[A-Za-z0-9]+$'))));
CREATE INDEX IF NOT EXISTS billing_operations_pending_customer
  ON survey_private.billing_operations(user_id,provider_scope,expected_customer_id,operation_id)
  WHERE state='pending' AND kind IN ('checkout_create','portal_create');
CREATE INDEX IF NOT EXISTS billing_operations_pending_kind
  ON survey_private.billing_operations(user_id,kind) WHERE state='pending';

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
  -- A prior exact replay may have committed while we acquired the actor lock.
  -- Recheck its full identity BEFORE applying the per-kind admission limit.
  SELECT * INTO saved FROM survey_private.billing_operations WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF ROW(saved.user_id,saved.kind,saved.provider_scope,saved.request_spec,saved.expected_customer_id)
      IS DISTINCT FROM ROW(p_user_id,p_kind,p_provider_scope,p_request_spec,p_expected_customer_id) THEN
      RAISE EXCEPTION 'Billing operation identity changed' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('outcome',saved.state,'operation_id',saved.operation_id,'state',saved.state,
      'result',saved.result,'admitted_at',saved.admitted_at);
  END IF;
  -- Preflight reads alone race: two new UUIDs can both see no unresolved call.
  -- Admission is serialized here, and an unknown result never ages out.
  IF EXISTS(SELECT 1 FROM survey_private.billing_operations
    WHERE user_id=p_user_id AND kind=p_kind AND state='pending') THEN
    RAISE EXCEPTION 'BILLING_OPERATION_PENDING' USING ERRCODE='40001';
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

CREATE OR REPLACE FUNCTION public.read_billing_operation(p_user_id uuid,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt jsonb;
BEGIN
  PERFORM survey_private.require_billing_lifecycle_call(p_user_id);
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'Billing operation is required' USING ERRCODE='22023'; END IF;
  SELECT to_jsonb(o) || jsonb_build_object('customer_removed',
    o.kind IN ('checkout_create','portal_create') AND EXISTS(
      SELECT 1 FROM survey_private.billing_customer_cleanup c WHERE c.user_id=o.user_id
        AND c.provider_scope=o.provider_scope AND c.customer_id=o.expected_customer_id AND c.removed))
    INTO receipt FROM survey_private.billing_operations o
    WHERE o.operation_id=p_operation_id AND o.user_id=p_user_id;
  RETURN receipt;
END;
$$;

CREATE OR REPLACE FUNCTION public.scan_pending_billing_operations(p_user_id uuid,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE cursor_id uuid; operations jsonb := '[]'::jsonb; last_operation jsonb;
BEGIN
  PERFORM survey_private.require_billing_lifecycle_call(p_user_id);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Invalid pending operation limit' USING ERRCODE='22023';
  END IF;
  PERFORM survey_private.lock_billing_lifecycle(p_user_id);
  SELECT pending_operation_cursor INTO cursor_id FROM survey_private.billing_account_lifecycles WHERE user_id=p_user_id;
  IF cursor_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY operation_id),'[]'::jsonb) INTO operations FROM (
      SELECT pending.*,pending.kind IN ('checkout_create','portal_create') AND EXISTS(
        SELECT 1 FROM survey_private.billing_customer_cleanup c WHERE c.user_id=pending.user_id
          AND c.provider_scope=pending.provider_scope AND c.customer_id=pending.expected_customer_id AND c.removed
      ) AS customer_removed FROM survey_private.billing_operations pending WHERE user_id=p_user_id AND state='pending'
        AND operation_id>cursor_id ORDER BY operation_id LIMIT p_limit
    ) o;
  END IF;
  IF jsonb_array_length(operations)=0 THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY operation_id),'[]'::jsonb) INTO operations FROM (
      SELECT pending.*,pending.kind IN ('checkout_create','portal_create') AND EXISTS(
        SELECT 1 FROM survey_private.billing_customer_cleanup c WHERE c.user_id=pending.user_id
          AND c.provider_scope=pending.provider_scope AND c.customer_id=pending.expected_customer_id AND c.removed
      ) AS customer_removed FROM survey_private.billing_operations pending WHERE user_id=p_user_id AND state='pending'
        ORDER BY operation_id LIMIT p_limit
    ) o;
  END IF;
  last_operation := operations->-1;
  UPDATE survey_private.billing_account_lifecycles SET pending_operation_cursor=(last_operation->>'operation_id')::uuid
    WHERE user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending operation cursor did not persist' USING ERRCODE='40001'; END IF;
  -- Lost scan replies only skip a page until the next cycle. No row is settled,
  -- removed, leased, or newly admitted by this read.
  RETURN jsonb_build_object('operations',operations);
END;
$$;

CREATE OR REPLACE FUNCTION public.rotate_billing_customer(p_user_id uuid,p_provider_scope jsonb,
  p_expected_customer_id text,p_customer_operation_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE account_closing boolean; lifecycle_closing boolean; current_customer text; new_customer text;
  subscription_id uuid; operation survey_private.billing_operations%ROWTYPE; customer text;
BEGIN
  PERFORM survey_private.require_billing_lifecycle_call(p_user_id);
  PERFORM survey_private.validate_billing_provider_scope(p_provider_scope);
  IF p_expected_customer_id IS NOT NULL AND length(p_expected_customer_id) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'Invalid expected billing customer' USING ERRCODE='22023';
  END IF;
  -- Match admission/closure order; all reverse tuple waits fail fast.
  PERFORM id FROM auth.users WHERE id=p_user_id FOR KEY SHARE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','stale','customer_id',NULL); END IF;
  INSERT INTO survey_private.account_write_guards(user_id,closing) VALUES(p_user_id,false) ON CONFLICT DO NOTHING;
  SELECT closing INTO account_closing FROM survey_private.account_write_guards WHERE user_id=p_user_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account guard changed' USING ERRCODE='40001'; END IF;
  PERFORM survey_private.lock_billing_lifecycle(p_user_id);
  SELECT closing INTO lifecycle_closing FROM survey_private.billing_account_lifecycles WHERE user_id=p_user_id;
  SELECT id,stripe_customer_id INTO subscription_id,current_customer FROM public.user_subscriptions
    WHERE user_id=p_user_id FOR UPDATE NOWAIT;
  IF account_closing OR lifecycle_closing THEN
    RETURN jsonb_build_object('outcome','closing','customer_id',current_customer);
  END IF;
  IF subscription_id IS NULL OR current_customer IS DISTINCT FROM p_expected_customer_id THEN
    RETURN jsonb_build_object('outcome','stale','customer_id',current_customer);
  END IF;
  IF p_customer_operation_id IS NOT NULL THEN
    SELECT * INTO operation FROM survey_private.billing_operations
      WHERE operation_id=p_customer_operation_id FOR SHARE NOWAIT;
    IF NOT FOUND OR operation.user_id IS DISTINCT FROM p_user_id OR operation.provider_scope IS DISTINCT FROM p_provider_scope
      OR operation.kind<>'customer_create' OR operation.state<>'settled'
      OR operation.result->>'outcome' IS DISTINCT FROM 'succeeded' THEN
      RAISE EXCEPTION 'Customer rotation operation differs' USING ERRCODE='22023';
    END IF;
    new_customer := operation.result->>'customer_id';
    IF new_customer IS NULL OR new_customer !~ '^cus_[A-Za-z0-9]+$' OR length(new_customer)>255 THEN
      RAISE EXCEPTION 'Customer rotation result differs' USING ERRCODE='22023';
    END IF;
    IF EXISTS(SELECT 1 FROM survey_private.billing_customer_cleanup
      WHERE user_id=p_user_id AND provider_scope=p_provider_scope AND customer_id=new_customer AND removed) THEN
      RAISE EXCEPTION 'Customer rotation target was removed' USING ERRCODE='23514';
    END IF;
  END IF;
  FOR customer IN SELECT DISTINCT id FROM unnest(ARRAY[current_customer,new_customer]) id
    WHERE id IS NOT NULL ORDER BY id LOOP
    PERFORM survey_private.register_billing_customer_owner(p_user_id,customer);
  END LOOP;
  IF current_customer IS NOT NULL THEN
    INSERT INTO survey_private.billing_customer_cleanup(user_id,provider_scope,customer_id)
      VALUES(p_user_id,p_provider_scope,current_customer) ON CONFLICT DO NOTHING;
  END IF;
  -- NULL operation means clear: the service caller must first verify deletion
  -- at the exact provider namespace. This is NOT itself a deletion receipt.
  IF current_customer IS DISTINCT FROM new_customer THEN
    UPDATE public.user_subscriptions SET stripe_customer_id=new_customer
      WHERE id=subscription_id AND stripe_customer_id IS NOT DISTINCT FROM p_expected_customer_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer rotation did not persist' USING ERRCODE='40001'; END IF;
  END IF;
  RETURN jsonb_build_object('outcome','applied','customer_id',new_customer);
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_billing_operation_recovery_cursor(p_user_id uuid,p_operation_id uuid,
  p_expected_cursor text,p_next_cursor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE operation survey_private.billing_operations%ROWTYPE; candidate text;
BEGIN
  PERFORM survey_private.require_billing_lifecycle_call(p_user_id);
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'Billing operation is required' USING ERRCODE='22023'; END IF;
  FOREACH candidate IN ARRAY ARRAY[p_expected_cursor,p_next_cursor] LOOP
    IF candidate IS NOT NULL AND (length(candidate)>255 OR candidate !~ '^(cs_((test|live)_)?|evt_)[A-Za-z0-9]+$') THEN
      RAISE EXCEPTION 'Invalid billing recovery cursor' USING ERRCODE='22023';
    END IF;
  END LOOP;
  PERFORM survey_private.lock_billing_lifecycle(p_user_id);
  SELECT * INTO operation FROM survey_private.billing_operations WHERE operation_id=p_operation_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR operation.user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Billing operation identity changed' USING ERRCODE='22023';
  END IF;
  IF operation.state='settled' THEN
    RETURN jsonb_build_object('outcome','settled','state',operation.state,'recovery_cursor',operation.recovery_cursor);
  END IF;
  IF operation.kind NOT IN ('checkout_create','portal_create') THEN
    RAISE EXCEPTION 'Billing operation does not support a recovery cursor' USING ERRCODE='22023';
  END IF;
  FOREACH candidate IN ARRAY ARRAY[p_expected_cursor,p_next_cursor] LOOP
    IF candidate IS NOT NULL AND ((operation.kind='checkout_create' AND candidate !~ '^cs_((test|live)_)?[A-Za-z0-9]+$')
      OR (operation.kind='portal_create' AND candidate !~ '^evt_[A-Za-z0-9]+$')) THEN
      RAISE EXCEPTION 'Billing recovery cursor kind differs' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF operation.recovery_cursor IS DISTINCT FROM p_expected_cursor THEN
    RETURN jsonb_build_object('outcome','stale','state',operation.state,'recovery_cursor',operation.recovery_cursor);
  END IF;
  -- Only the inspected page position changes. End-of-list resets NULL so a
  -- later request can observe newly visible records; absence is never failure.
  UPDATE survey_private.billing_operations SET recovery_cursor=p_next_cursor WHERE operation_id=p_operation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Billing recovery cursor did not persist' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('outcome','advanced','state',operation.state,'recovery_cursor',p_next_cursor);
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
  -- Deletion of an exact provider customer must be idempotent. Claim is a
  -- repeatable candidate read, not execution authority for customer creation.
  RETURN status || jsonb_build_object('customers',customers);
END;
$$;

CREATE OR REPLACE FUNCTION public.ack_billing_customer_cleanup(p_user_id uuid,p_provider_scope jsonb,p_customer_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE status jsonb; pending_known boolean; revoked integer; selected_ids uuid[];
BEGIN
  PERFORM survey_private.require_billing_lifecycle_call(p_user_id);
  PERFORM survey_private.validate_billing_provider_scope(p_provider_scope);
  IF p_customer_id IS NULL OR length(p_customer_id) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'Invalid cleanup customer' USING ERRCODE='22023';
  END IF;
  PERFORM survey_private.lock_billing_lifecycle(p_user_id);
  status := survey_private.billing_closure_status(p_user_id);
  IF NOT(status->>'closing')::boolean THEN
    RAISE EXCEPTION 'Billing cleanup is not ready' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM survey_private.billing_account_lifecycles
    WHERE user_id=p_user_id AND closing_xid=pg_current_xact_id()) THEN
    RAISE EXCEPTION 'Billing closure must commit before cleanup' USING ERRCODE='23514';
  END IF;
  UPDATE survey_private.billing_customer_cleanup SET removed=true
    WHERE user_id=p_user_id AND provider_scope=p_provider_scope AND customer_id=p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cleanup customer was not registered' USING ERRCODE='22023'; END IF;
  -- Provider-confirmed deletion is irreversible for this exact parent. It can
  -- revoke late checkout/portal calls, but says nothing about customer_create.
  SELECT COALESCE(array_agg(operation_id ORDER BY operation_id),ARRAY[]::uuid[]) INTO selected_ids FROM (
    SELECT operation_id FROM survey_private.billing_operations WHERE user_id=p_user_id AND provider_scope=p_provider_scope
      AND expected_customer_id=p_customer_id AND state='pending' AND kind IN ('checkout_create','portal_create')
      ORDER BY operation_id LIMIT 100 FOR UPDATE NOWAIT
  ) selected;
  UPDATE survey_private.billing_operations SET state='settled',
    result=jsonb_build_object('outcome','customer_removed','customer_id',p_customer_id,'data','{}'::jsonb)
    WHERE operation_id=ANY(selected_ids);
  GET DIAGNOSTICS revoked=ROW_COUNT;
  IF revoked<>cardinality(selected_ids) THEN RAISE EXCEPTION 'Billing revocations did not persist' USING ERRCODE='40001'; END IF;
  SELECT EXISTS(SELECT 1 FROM survey_private.billing_operations WHERE user_id=p_user_id AND provider_scope=p_provider_scope
    AND expected_customer_id=p_customer_id AND state='pending' AND kind IN ('checkout_create','portal_create')) INTO pending_known;
  RETURN survey_private.billing_closure_status(p_user_id)
    || jsonb_build_object('has_pending_customer_operations',pending_known);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_billing_operation(p_operation_id uuid,p_user_id uuid,p_kind text,
  p_provider_scope jsonb,p_request_spec jsonb,p_expected_customer_id text,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE saved survey_private.billing_operations%ROWTYPE; customer text;
BEGIN
  PERFORM survey_private.require_billing_lifecycle_call(p_user_id);
  PERFORM survey_private.validate_billing_provider_scope(p_provider_scope);
  PERFORM survey_private.lock_billing_lifecycle(p_user_id);
  SELECT * INTO saved FROM survey_private.billing_operations WHERE operation_id=p_operation_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR ROW(saved.user_id,saved.kind,saved.provider_scope,saved.request_spec,saved.expected_customer_id)
    IS DISTINCT FROM ROW(p_user_id,p_kind,p_provider_scope,p_request_spec,p_expected_customer_id) THEN
    RAISE EXCEPTION 'Billing operation identity changed' USING ERRCODE='22023';
  END IF;
  -- A confirmed irreversible customer deletion covers a late known-customer
  -- request. Never overwrite its canonical receipt with a delayed success.
  IF saved.state='pending' AND saved.kind IN ('checkout_create','portal_create')
    AND EXISTS(SELECT 1 FROM survey_private.billing_customer_cleanup
      WHERE user_id=p_user_id AND provider_scope=saved.provider_scope
        AND customer_id=saved.expected_customer_id AND removed) THEN
    saved.result := jsonb_build_object('outcome','customer_removed','customer_id',saved.expected_customer_id,'data','{}'::jsonb);
    UPDATE survey_private.billing_operations SET state='settled',result=saved.result WHERE operation_id=p_operation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Billing revocation did not persist' USING ERRCODE='40001'; END IF;
    saved.state := 'settled';
  END IF;
  IF saved.state='settled' AND saved.result->>'outcome'='customer_removed' THEN
    RETURN jsonb_build_object('outcome','settled','operation_id',saved.operation_id,'state','settled',
      'result',saved.result,'admitted_at',saved.admitted_at);
  END IF;
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

ALTER FUNCTION public.read_billing_operation(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.begin_billing_operation(uuid,uuid,text,jsonb,jsonb,text) OWNER TO postgres;
ALTER FUNCTION public.scan_pending_billing_operations(uuid,integer) OWNER TO postgres;
ALTER FUNCTION public.rotate_billing_customer(uuid,jsonb,text,uuid) OWNER TO postgres;
ALTER FUNCTION public.advance_billing_operation_recovery_cursor(uuid,uuid,text,text) OWNER TO postgres;
ALTER FUNCTION public.claim_billing_customer_cleanup(uuid,integer) OWNER TO postgres;
ALTER FUNCTION public.ack_billing_customer_cleanup(uuid,jsonb,text) OWNER TO postgres;
ALTER FUNCTION public.settle_billing_operation(uuid,uuid,text,jsonb,jsonb,text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.read_billing_operation(uuid,uuid),public.scan_pending_billing_operations(uuid,integer),
  public.begin_billing_operation(uuid,uuid,text,jsonb,jsonb,text),
  public.advance_billing_operation_recovery_cursor(uuid,uuid,text,text),
  public.rotate_billing_customer(uuid,jsonb,text,uuid),public.claim_billing_customer_cleanup(uuid,integer),
  public.ack_billing_customer_cleanup(uuid,jsonb,text),public.settle_billing_operation(uuid,uuid,text,jsonb,jsonb,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_billing_operation(uuid,uuid),public.scan_pending_billing_operations(uuid,integer),
  public.begin_billing_operation(uuid,uuid,text,jsonb,jsonb,text),
  public.advance_billing_operation_recovery_cursor(uuid,uuid,text,text),
  public.rotate_billing_customer(uuid,jsonb,text,uuid),public.claim_billing_customer_cleanup(uuid,integer),
  public.ack_billing_customer_cleanup(uuid,jsonb,text),public.settle_billing_operation(uuid,uuid,text,jsonb,jsonb,text,jsonb)
  TO service_role;
COMMIT;
