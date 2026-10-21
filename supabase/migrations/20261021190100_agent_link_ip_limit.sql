-- Backend security pass: agent-auth `start` needs no sign-in and adds a row
-- per call. A caller address may hold at most five unclaimed codes. Only a
-- hash of the address is stored, never the address itself.
--
-- The cap lives in a trigger, not the edge function: the trigger takes a
-- per-address lock before counting, so parallel calls from one address
-- cannot all read "four" and all insert.
BEGIN;

ALTER TABLE public.agent_links ADD COLUMN IF NOT EXISTS client_ip_hash text;

CREATE INDEX IF NOT EXISTS idx_agent_links_ip_pending
  ON public.agent_links (client_ip_hash, created_at)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.agent_links_cap_pending_per_ip()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
    IF NEW.client_ip_hash IS NULL OR NEW.status IS DISTINCT FROM 'pending' THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('agent_links_ip:' || NEW.client_ip_hash, 0));

    IF (SELECT count(*) FROM public.agent_links
        WHERE status = 'pending' AND client_ip_hash = NEW.client_ip_hash) >= 5 THEN
        RAISE EXCEPTION 'agent_link_ip_limit' USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.agent_links_cap_pending_per_ip() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS agent_links_cap_pending_per_ip ON public.agent_links;
CREATE TRIGGER agent_links_cap_pending_per_ip
  BEFORE INSERT ON public.agent_links
  FOR EACH ROW EXECUTE FUNCTION public.agent_links_cap_pending_per_ip();

COMMIT;
