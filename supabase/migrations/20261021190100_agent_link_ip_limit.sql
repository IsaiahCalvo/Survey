-- Backend security pass: agent-auth `start` needs no sign-in and adds a row
-- per call. The edge function now caps pending codes per caller address; it
-- stores only a hash of the address, never the address itself.
BEGIN;

ALTER TABLE public.agent_links ADD COLUMN IF NOT EXISTS client_ip_hash text;

CREATE INDEX IF NOT EXISTS idx_agent_links_ip_pending
  ON public.agent_links (client_ip_hash, created_at)
  WHERE status = 'pending';

COMMIT;
