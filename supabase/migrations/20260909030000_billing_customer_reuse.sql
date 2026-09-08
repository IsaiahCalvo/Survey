-- A settled customer-create receipt is not proof that the customer was never
-- bound. Reuse needs durable disposition plus a permanent seen-binding fence.
-- Provider GET/deletion proof stays with the service caller; no provider POST,
-- deletion, age-based release, or auth-schema mutation occurs in this migration.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
LOCK TABLE public.user_subscriptions IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE survey_private.billing_customer_owners IN SHARE ROW EXCLUSIVE MODE;

-- Backfill every preexisting owner conservatively, including cleared bindings.
-- TRUE means ineligible for automatic reuse, not a claim of exact history.
-- The temporary TRUE default marks old rows without per-customer advisory locks;
-- later registrations alone receive FALSE. Replaying never resets a TRUE bit.
ALTER TABLE survey_private.billing_customer_owners
  ADD COLUMN IF NOT EXISTS ever_bound boolean NOT NULL DEFAULT true;
ALTER TABLE survey_private.billing_customer_owners ALTER COLUMN ever_bound SET DEFAULT false;
ALTER TABLE survey_private.billing_operations
  ADD COLUMN IF NOT EXISTS customer_binding_state text NOT NULL DEFAULT 'untracked'
  CHECK(customer_binding_state IN ('untracked','available','bound','retired'));
CREATE INDEX IF NOT EXISTS billing_customer_reuse_candidates
  ON survey_private.billing_operations(user_id,operation_id)
  WHERE kind='customer_create' AND state='settled' AND result->>'outcome'='succeeded'
    AND customer_binding_state IN ('available','untracked');
CREATE INDEX IF NOT EXISTS billing_customer_available_by_customer
  ON survey_private.billing_operations(user_id,(result->>'customer_id'),operation_id)
  WHERE kind='customer_create' AND state='settled' AND customer_binding_state='available';
CREATE INDEX IF NOT EXISTS billing_customer_removed_by_owner
  ON survey_private.billing_customer_cleanup(user_id,customer_id) WHERE removed;

CREATE OR REPLACE FUNCTION survey_private.record_billing_customer_binding(p_user_id uuid,p_customer_id text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE available_ids uuid[];
BEGIN
  PERFORM survey_private.register_billing_customer_owner(p_user_id,p_customer_id);
  UPDATE survey_private.billing_customer_owners SET ever_bound=true
    WHERE customer_id=p_customer_id AND user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Billing binding fact did not persist' USING ERRCODE='40001'; END IF;
  -- Every supported admission blocks an outstanding available creation, so at
  -- most one is valid. Inspect only two raw rows; corrupt/legacy duplicates fail
  -- closed instead of doing unbounded work inside a subscription trigger.
  SELECT COALESCE(array_agg(operation_id ORDER BY operation_id),ARRAY[]::uuid[]) INTO available_ids FROM (
    SELECT operation_id FROM survey_private.billing_operations WHERE user_id=p_user_id
      AND kind='customer_create' AND state='settled' AND customer_binding_state='available'
      AND result->>'customer_id'=p_customer_id ORDER BY operation_id LIMIT 2 FOR UPDATE NOWAIT
  ) candidates;
  IF cardinality(available_ids)>1 THEN
    RAISE EXCEPTION 'Multiple reusable customer receipts need review' USING ERRCODE='40001';
  END IF;
  IF cardinality(available_ids)=1 THEN
    UPDATE survey_private.billing_operations SET customer_binding_state='bound' WHERE operation_id=available_ids[1];
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer binding disposition did not persist' USING ERRCODE='40001'; END IF;
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
  IF NEW.stripe_customer_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.stripe_customer_id IS DISTINCT FROM previous_customer)
    AND EXISTS(SELECT 1 FROM survey_private.billing_customer_cleanup WHERE user_id=NEW.user_id
      AND customer_id=NEW.stripe_customer_id AND removed) THEN
    RAISE EXCEPTION 'Removed billing customer cannot be rebound' USING ERRCODE='23514';
  END IF;
  FOR binding IN SELECT DISTINCT customer_id,user_id FROM (
    VALUES(previous_customer,previous_owner),(NEW.stripe_customer_id,NEW.user_id)
  ) owners(customer_id,user_id) WHERE customer_id IS NOT NULL ORDER BY customer_id,user_id LOOP
    PERFORM survey_private.record_billing_customer_binding(binding.user_id,binding.customer_id);
  END LOOP;
  RETURN NEW;
END;
$$;

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
  IF p_kind='customer_create' AND EXISTS(SELECT 1 FROM survey_private.billing_operations
    WHERE user_id=p_user_id AND kind='customer_create' AND state='settled'
      AND result->>'outcome'='succeeded' AND customer_binding_state IN ('available','untracked')) THEN
    -- Scope mismatches need review, not another customer in a guessed account.
    RAISE EXCEPTION 'BILLING_CUSTOMER_REUSE_REQUIRED' USING ERRCODE='40001';
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
DECLARE saved survey_private.billing_operations%ROWTYPE; customer text; binding_state text := 'untracked';
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
    IF saved.kind='customer_create' AND p_result->>'outcome'='succeeded' THEN
      IF EXISTS(SELECT 1 FROM survey_private.billing_customer_cleanup
        WHERE user_id=p_user_id AND provider_scope=p_provider_scope AND customer_id=customer AND removed) THEN
        binding_state := 'retired';
      ELSIF EXISTS(SELECT 1 FROM survey_private.billing_customer_owners WHERE customer_id=customer AND user_id=p_user_id AND ever_bound) THEN
        -- Existing owner receipts were conservatively fenced at install;
        -- that is not proof of an observed binding for this operation.
        binding_state := 'untracked';
      ELSIF NOT EXISTS(SELECT 1 FROM survey_private.account_write_guards WHERE user_id=p_user_id AND closing)
        AND NOT EXISTS(SELECT 1 FROM survey_private.billing_account_lifecycles WHERE user_id=p_user_id AND closing) THEN
        binding_state := 'available';
      END IF;
    END IF;
    UPDATE survey_private.billing_operations SET state='settled',result=p_result,customer_binding_state=binding_state
      WHERE operation_id=p_operation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Billing settlement did not persist' USING ERRCODE='40001'; END IF;
  END IF;
  RETURN jsonb_build_object('outcome','settled','operation_id',p_operation_id,'state','settled','result',p_result,
    'admitted_at',saved.admitted_at);
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
    IF new_customer IS DISTINCT FROM current_customer AND (
      operation.customer_binding_state<>'available' OR EXISTS(
        SELECT 1 FROM survey_private.billing_customer_owners WHERE customer_id=new_customer AND ever_bound)) THEN
      RAISE EXCEPTION 'Customer rotation target is not reusable' USING ERRCODE='23514';
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

CREATE OR REPLACE FUNCTION public.read_reusable_billing_customer(p_user_id uuid,p_provider_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE account_closing boolean; lifecycle_closing boolean; current_customer text;
  candidate survey_private.billing_operations%ROWTYPE; customer text; subscription_id uuid;
BEGIN
  PERFORM survey_private.require_billing_lifecycle_call(p_user_id);
  PERFORM survey_private.validate_billing_provider_scope(p_provider_scope);
  PERFORM id FROM auth.users WHERE id=p_user_id FOR KEY SHARE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','closing','operation',NULL,'customer_id',NULL); END IF;
  INSERT INTO survey_private.account_write_guards(user_id,closing) VALUES(p_user_id,false) ON CONFLICT DO NOTHING;
  SELECT closing INTO account_closing FROM survey_private.account_write_guards WHERE user_id=p_user_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account guard changed' USING ERRCODE='40001'; END IF;
  PERFORM survey_private.lock_billing_lifecycle(p_user_id);
  SELECT closing INTO lifecycle_closing FROM survey_private.billing_account_lifecycles WHERE user_id=p_user_id;
  SELECT id,stripe_customer_id INTO subscription_id,current_customer FROM public.user_subscriptions
    WHERE user_id=p_user_id FOR SHARE NOWAIT;
  IF account_closing OR lifecycle_closing THEN
    RETURN jsonb_build_object('outcome','closing','operation',NULL,'customer_id',current_customer);
  END IF;
  IF current_customer IS NOT NULL THEN
    RETURN jsonb_build_object('outcome','bound','operation',NULL,'customer_id',current_customer);
  END IF;
  IF subscription_id IS NULL OR EXISTS(SELECT 1 FROM survey_private.billing_operations
    WHERE user_id=p_user_id AND kind='customer_create' AND state='pending') THEN
    RETURN jsonb_build_object('outcome','review','operation',NULL,'customer_id',NULL);
  END IF;
  -- One raw indexed candidate across ALL scopes. An older wrong-scope or
  -- untracked receipt blocks new creation; do not scan past it and guess.
  SELECT * INTO candidate FROM survey_private.billing_operations WHERE user_id=p_user_id
    AND kind='customer_create' AND state='settled' AND result->>'outcome'='succeeded'
    AND customer_binding_state IN ('available','untracked')
    ORDER BY operation_id LIMIT 1 FOR SHARE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','none','operation',NULL,'customer_id',NULL); END IF;
  customer := candidate.result->>'customer_id';
  IF candidate.customer_binding_state<>'available' OR candidate.provider_scope IS DISTINCT FROM p_provider_scope
    OR customer IS NULL OR NOT EXISTS(SELECT 1 FROM survey_private.billing_customer_owners
      WHERE customer_id=customer AND user_id=p_user_id AND NOT ever_bound)
    OR NOT EXISTS(SELECT 1 FROM survey_private.billing_customer_cleanup WHERE user_id=p_user_id
      AND provider_scope=p_provider_scope AND customer_id=customer AND NOT removed) THEN
    RETURN jsonb_build_object('outcome','review','operation',to_jsonb(candidate),'customer_id',NULL);
  END IF;
  RETURN jsonb_build_object('outcome','candidate','operation',to_jsonb(candidate),'customer_id',NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.retire_reusable_billing_customer(p_user_id uuid,p_provider_scope jsonb,
  p_operation_id uuid,p_customer_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE account_closing boolean; lifecycle_closing boolean; current_customer text;
  operation survey_private.billing_operations%ROWTYPE;
BEGIN
  PERFORM survey_private.require_billing_lifecycle_call(p_user_id);
  PERFORM survey_private.validate_billing_provider_scope(p_provider_scope);
  IF p_operation_id IS NULL OR p_customer_id IS NULL OR p_customer_id !~ '^cus_[A-Za-z0-9]+$' OR length(p_customer_id)>255 THEN
    RAISE EXCEPTION 'Invalid reusable customer retirement' USING ERRCODE='22023';
  END IF;
  PERFORM id FROM auth.users WHERE id=p_user_id FOR KEY SHARE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','closing','customer_id',p_customer_id); END IF;
  INSERT INTO survey_private.account_write_guards(user_id,closing) VALUES(p_user_id,false) ON CONFLICT DO NOTHING;
  SELECT closing INTO account_closing FROM survey_private.account_write_guards WHERE user_id=p_user_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account guard changed' USING ERRCODE='40001'; END IF;
  PERFORM survey_private.lock_billing_lifecycle(p_user_id);
  SELECT closing INTO lifecycle_closing FROM survey_private.billing_account_lifecycles WHERE user_id=p_user_id;
  SELECT stripe_customer_id INTO current_customer FROM public.user_subscriptions WHERE user_id=p_user_id FOR UPDATE NOWAIT;
  IF account_closing OR lifecycle_closing THEN
    RETURN jsonb_build_object('outcome','closing','customer_id',p_customer_id);
  END IF;
  SELECT * INTO operation FROM survey_private.billing_operations WHERE operation_id=p_operation_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR operation.user_id IS DISTINCT FROM p_user_id OR operation.provider_scope IS DISTINCT FROM p_provider_scope
    OR operation.kind<>'customer_create' OR operation.state<>'settled'
    OR operation.result->>'outcome' IS DISTINCT FROM 'succeeded'
    OR operation.result->>'customer_id' IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'Reusable customer retirement identity differs' USING ERRCODE='22023';
  END IF;
  IF current_customer=p_customer_id OR operation.customer_binding_state NOT IN ('available','untracked','retired') THEN
    RETURN jsonb_build_object('outcome','stale','customer_id',p_customer_id);
  END IF;
  PERFORM survey_private.register_billing_customer_owner(p_user_id,p_customer_id);
  -- The global permanent owner prevents another actor from rebinding this ID.
  -- Lock the existing scoped cleanup receipt; never manufacture provider proof.
  PERFORM customer_id FROM survey_private.billing_customer_cleanup WHERE user_id=p_user_id
    AND provider_scope=p_provider_scope AND customer_id=p_customer_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reusable customer cleanup receipt is missing' USING ERRCODE='23514'; END IF;
  UPDATE survey_private.billing_operations SET customer_binding_state='retired' WHERE operation_id=p_operation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reusable customer retirement did not persist' USING ERRCODE='40001'; END IF;
  UPDATE survey_private.billing_customer_cleanup SET removed=true WHERE user_id=p_user_id
    AND provider_scope=p_provider_scope AND customer_id=p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reusable customer cleanup did not persist' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('outcome','retired','customer_id',p_customer_id);
END;
$$;

ALTER FUNCTION survey_private.record_billing_customer_binding(uuid,text) OWNER TO postgres;
ALTER FUNCTION survey_private.guard_billing_customer_binding() OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.record_billing_customer_binding(uuid,text),
  survey_private.guard_billing_customer_binding() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.begin_billing_operation(uuid,uuid,text,jsonb,jsonb,text) OWNER TO postgres;
ALTER FUNCTION public.settle_billing_operation(uuid,uuid,text,jsonb,jsonb,text,jsonb) OWNER TO postgres;
ALTER FUNCTION public.rotate_billing_customer(uuid,jsonb,text,uuid) OWNER TO postgres;
ALTER FUNCTION public.read_reusable_billing_customer(uuid,jsonb) OWNER TO postgres;
ALTER FUNCTION public.retire_reusable_billing_customer(uuid,jsonb,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.begin_billing_operation(uuid,uuid,text,jsonb,jsonb,text),
  public.settle_billing_operation(uuid,uuid,text,jsonb,jsonb,text,jsonb),public.rotate_billing_customer(uuid,jsonb,text,uuid),
  public.read_reusable_billing_customer(uuid,jsonb),public.retire_reusable_billing_customer(uuid,jsonb,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.begin_billing_operation(uuid,uuid,text,jsonb,jsonb,text),
  public.settle_billing_operation(uuid,uuid,text,jsonb,jsonb,text,jsonb),public.rotate_billing_customer(uuid,jsonb,text,uuid),
  public.read_reusable_billing_customer(uuid,jsonb),public.retire_reusable_billing_customer(uuid,jsonb,uuid,text)
  TO service_role;
COMMIT;
