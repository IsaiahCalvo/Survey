-- KAL-369: run the get_user_tier migration on a bare Postgres with a minimal
-- stand-in for Supabase (auth.uid from request.jwt.claims, the two enums,
-- user_subscriptions, a company-seat stub) and check a paid owner and a free
-- collaborator. Every check RAISEs on a wrong answer.
--   psql -v ON_ERROR_STOP=1 -f tests/sql/kal369_tier_paid_owner_free_collaborator.sql
\set ON_ERROR_STOP 1
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
DROP SCHEMA IF EXISTS auth CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public; CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.subscription_tier AS ENUM ('free','pro','enterprise','developer');
CREATE TYPE public.subscription_status AS ENUM ('active','trialing','past_due','canceled','incomplete');
CREATE TABLE public.user_subscriptions (user_id uuid PRIMARY KEY, tier public.subscription_tier NOT NULL, status public.subscription_status NOT NULL);
CREATE TABLE public.seats (user_id uuid PRIMARY KEY);
CREATE FUNCTION public._company_seated(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.seats WHERE user_id = p_user)
$$;
-- get_storage_limit exactly as live (2026-11-15).
CREATE FUNCTION public.get_user_tier(p_user_id uuid) RETURNS public.subscription_tier LANGUAGE sql AS $$ SELECT 'free'::public.subscription_tier $$;
CREATE FUNCTION public.get_storage_limit(p_user_id uuid) RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE user_tier_text TEXT;
BEGIN
  user_tier_text := get_user_tier(p_user_id)::text;
  RETURN CASE WHEN user_tier_text = 'free' THEN 104857600 WHEN user_tier_text = 'pro' THEN 10737418240
    WHEN user_tier_text = 'enterprise' THEN 1099511627776 WHEN user_tier_text = 'developer' THEN 107374182400 ELSE 104857600 END;
END; $function$;

\ir ../../supabase/migrations/20261115230000_tier_counts_only_live_subscription.sql

INSERT INTO public.user_subscriptions VALUES
  ('00000000-0000-0000-0000-00000000000a', 'pro', 'active'),   -- paid owner
  ('00000000-0000-0000-0000-00000000000b', 'free', 'active'),  -- free collaborator
  ('00000000-0000-0000-0000-00000000000c', 'pro', 'active');   -- seated in a company

CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'FAIL %: got %, want %', label, got, want; END IF;
  RAISE NOTICE 'ok  %: %', label, got;
END $$;

-- Server callers (no signed-in user) may ask about anyone.
SELECT pg_temp.expect('server: paid owner', public.get_user_tier('00000000-0000-0000-0000-00000000000a')::text, 'pro');
SELECT pg_temp.expect('server: free collaborator', public.get_user_tier('00000000-0000-0000-0000-00000000000b')::text, 'free');
SELECT pg_temp.expect('server: unknown account', public.get_user_tier('00000000-0000-0000-0000-0000000000ff')::text, 'free');

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);
SELECT pg_temp.expect('paid owner signed in: own tier', public.get_user_tier('00000000-0000-0000-0000-00000000000a')::text, 'pro');
SELECT pg_temp.expect('paid owner signed in: own storage limit', public.get_storage_limit('00000000-0000-0000-0000-00000000000a')::text, '10737418240');
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', false);
SELECT pg_temp.expect('free collaborator signed in: own tier', public.get_user_tier('00000000-0000-0000-0000-00000000000b')::text, 'free');
-- A signed-in caller always gets their own answer, never another account's plan.
SELECT pg_temp.expect('free collaborator asks for the paid owner', public.get_user_tier('00000000-0000-0000-0000-00000000000a')::text, 'free');
SELECT pg_temp.expect('free collaborator: own storage limit', public.get_storage_limit('00000000-0000-0000-0000-00000000000a')::text, '104857600');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

-- Signed-out callers can't run it at all.
DO $$ BEGIN
  SET LOCAL ROLE anon;
  PERFORM public.get_user_tier('00000000-0000-0000-0000-00000000000a');
  RAISE EXCEPTION 'FAIL anon could run get_user_tier';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  anon refused';
END $$;
RESET ROLE;

-- Status: past_due keeps paid while Stripe retries; incomplete and canceled don't.
UPDATE public.user_subscriptions SET status = 'past_due' WHERE user_id = '00000000-0000-0000-0000-00000000000a';
SELECT pg_temp.expect('paid owner past_due', public.get_user_tier('00000000-0000-0000-0000-00000000000a')::text, 'pro');
UPDATE public.user_subscriptions SET status = 'trialing' WHERE user_id = '00000000-0000-0000-0000-00000000000a';
SELECT pg_temp.expect('paid owner trialing', public.get_user_tier('00000000-0000-0000-0000-00000000000a')::text, 'pro');
UPDATE public.user_subscriptions SET status = 'incomplete' WHERE user_id = '00000000-0000-0000-0000-00000000000a';
SELECT pg_temp.expect('paid owner incomplete', public.get_user_tier('00000000-0000-0000-0000-00000000000a')::text, 'free');
UPDATE public.user_subscriptions SET status = 'canceled' WHERE user_id = '00000000-0000-0000-0000-00000000000a';
SELECT pg_temp.expect('paid owner canceled', public.get_user_tier('00000000-0000-0000-0000-00000000000a')::text, 'free');

-- A paid company seat still counts, whatever the person's own plan says.
INSERT INTO public.seats VALUES ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000a');
SELECT pg_temp.expect('seated, own plan active pro', public.get_user_tier('00000000-0000-0000-0000-00000000000c')::text, 'enterprise');
SELECT pg_temp.expect('seated, own plan canceled', public.get_user_tier('00000000-0000-0000-0000-00000000000a')::text, 'enterprise');
\echo KAL369 TIER CHECKS PASSED
