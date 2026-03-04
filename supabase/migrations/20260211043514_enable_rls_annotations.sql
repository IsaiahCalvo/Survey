
-- Enable RLS on annotations table
ALTER TABLE public.annotations ENABLE ROW LEVEL SECURITY;

-- Users can view own annotations
CREATE POLICY "Users can view own annotations"
  ON public.annotations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert own annotations
CREATE POLICY "Users can insert own annotations"
  ON public.annotations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update own annotations
CREATE POLICY "Users can update own annotations"
  ON public.annotations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can delete own annotations
CREATE POLICY "Users can delete own annotations"
  ON public.annotations FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
;
