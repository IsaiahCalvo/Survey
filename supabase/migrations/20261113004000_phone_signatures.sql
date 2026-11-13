-- Sign from phone (Nightly 'phone-sign', Drawboard PDF Pro push 2026-11-12,
-- drawboard-trial/pdf-pro row A8 "Mobile sign"). The Add signature dialog
-- on a computer shows a QR code; the phone that scans it opens /sign/<token>,
-- draws a signature and sends it back to that dialog.
--
--   phone_signatures       one short-lived request per open Phone tab. The
--                          signed-in owner creates, reads and deletes it.
--   submit_phone_signature the phone (no sign-in) fills a request it has the
--                          token for: once, within 10 minutes, at most 200 KB.

CREATE TABLE IF NOT EXISTS public.phone_signatures (
  token uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz
);

CREATE INDEX IF NOT EXISTS phone_signatures_user_idx ON public.phone_signatures (user_id);

ALTER TABLE public.phone_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS phone_signatures_owner_select ON public.phone_signatures;
CREATE POLICY phone_signatures_owner_select ON public.phone_signatures
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS phone_signatures_owner_insert ON public.phone_signatures;
CREATE POLICY phone_signatures_owner_insert ON public.phone_signatures
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()) AND payload IS NULL AND submitted_at IS NULL);

DROP POLICY IF EXISTS phone_signatures_owner_delete ON public.phone_signatures;
CREATE POLICY phone_signatures_owner_delete ON public.phone_signatures
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.phone_signatures FROM anon;
GRANT SELECT, INSERT, DELETE ON public.phone_signatures TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_phone_signature(p_token uuid, p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  filled integer;
BEGIN
  IF p_token IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN false;
  END IF;
  IF octet_length(p_payload::text) > 200000 THEN
    RETURN false;
  END IF;
  -- Old requests go; a request is filled once.
  DELETE FROM public.phone_signatures WHERE created_at < now() - interval '1 day';
  UPDATE public.phone_signatures
     SET payload = p_payload, submitted_at = now()
   WHERE token = p_token
     AND submitted_at IS NULL
     AND created_at > now() - interval '10 minutes';
  GET DIAGNOSTICS filled = ROW_COUNT;
  RETURN filled = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_phone_signature(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_phone_signature(uuid, jsonb) TO anon, authenticated;

INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('phone-sign', 'off', 'Add signature: Phone tab (scan a QR code, sign on the phone).')
ON CONFLICT (key) DO NOTHING;
