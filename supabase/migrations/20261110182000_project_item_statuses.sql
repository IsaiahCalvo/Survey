-- Projects: Issues and Tasks (flag `project-issues`). Drawboard gives each kind
-- its own statuses: only a Task can be On Hold, only an Issue can be Approved
-- or Rejected. The old check let every status on both kinds and had no On Hold.
ALTER TABLE public.project_items DROP CONSTRAINT IF EXISTS project_items_status_check;
ALTER TABLE public.project_items DROP CONSTRAINT IF EXISTS project_items_kind_status_check;

-- A Task left Approved or Rejected by the old rule reads as Closed (done).
UPDATE public.project_items SET status = 'closed'
 WHERE kind = 'task' AND status IN ('approved', 'rejected');

ALTER TABLE public.project_items ADD CONSTRAINT project_items_kind_status_check CHECK (
  (kind = 'issue' AND status IN ('draft', 'open', 'pending', 'in_review', 'closed', 'approved', 'rejected'))
  OR (kind = 'task' AND status IN ('draft', 'open', 'pending', 'in_review', 'on_hold', 'closed'))
);
