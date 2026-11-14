-- "Assigned to you" email for an issue or task (Drawboard Projects parity
-- NT-01 / IS-10). Nightly flag `item-assign-email` (keep in step with
-- src/featureFlags.js); the row starts off.
--
-- The app asks notify-comment-mentions to email the new assignee right after
-- it sets one. The function reads who assigned whom from the item's activity
-- log (project_item_events, written by the project_items_log trigger) and
-- claims the assignment here first, so each one is emailed at most once.
-- Only the service role touches this table.

INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('item-assign-email', 'off', 'Issues and tasks: email the person an item is assigned to, with a link that opens it.')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.project_item_assign_emails (
  item_id uuid NOT NULL REFERENCES public.project_items(id) ON DELETE CASCADE,
  assignee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, assignee_id, assigned_at)
);

ALTER TABLE public.project_item_assign_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_item_assign_emails FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.project_item_assign_emails TO service_role;
