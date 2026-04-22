
-- Fix overly permissive RLS policies
-- These INSERT policies use WITH CHECK (true) to the public role,
-- allowing anyone to insert. We'll restrict them to service_role only,
-- since these are system-managed tables (inserted by triggers/functions).

-- 1. Fix project_status INSERT policy
DROP POLICY "System can insert project status" ON public.project_status;
CREATE POLICY "System can insert project status"
  ON public.project_status FOR INSERT
  TO service_role
  WITH CHECK (true);

-- 2. Fix usage_metrics INSERT policy
DROP POLICY "System can insert usage metrics" ON public.usage_metrics;
CREATE POLICY "System can insert usage metrics"
  ON public.usage_metrics FOR INSERT
  TO service_role
  WITH CHECK (true);
;
