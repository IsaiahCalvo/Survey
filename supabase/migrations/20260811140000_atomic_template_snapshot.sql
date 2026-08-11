-- Replace the signed-in owner's entire template working set atomically.
-- One RPC call means create/update/delete either all commit or all roll back;
-- the editor can safely retain its dirty working copy and retry on failure.
CREATE OR REPLACE FUNCTION public.replace_my_templates(p_templates jsonb)
RETURNS SETOF public.templates
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id uuid := auth.uid();
  entry jsonb;
  requested_id uuid;
  persisted_id uuid;
  retained_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_templates IS NULL OR jsonb_typeof(p_templates) <> 'array' THEN
    RAISE EXCEPTION 'Templates must be a JSON array';
  END IF;

  -- Snapshot replacement is last-writer-wins, but two calls for the same owner
  -- must not interleave their upserts/deletes into a mixed snapshot.
  PERFORM pg_advisory_xact_lock(hashtext(caller_id::text)::bigint);

  FOR entry IN SELECT value FROM jsonb_array_elements(p_templates)
  LOOP
    persisted_id := NULL;
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Template entries must be JSON objects';
    END IF;
    IF jsonb_typeof(entry->'name') IS DISTINCT FROM 'string' OR btrim(entry->>'name') = '' THEN
      RAISE EXCEPTION 'Template entries require a non-empty name';
    END IF;
    IF jsonb_typeof(entry->'config') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Template config must be a JSON object';
    END IF;
    BEGIN
      requested_id := (entry->>'supabase_id')::uuid;
    EXCEPTION WHEN invalid_text_representation OR null_value_not_allowed THEN
      RAISE EXCEPTION 'Invalid template row id';
    END;
    IF requested_id IS NULL THEN
      RAISE EXCEPTION 'Invalid template row id';
    END IF;
    IF requested_id = ANY(retained_ids) THEN
      RAISE EXCEPTION 'Duplicate template row id';
    END IF;

    UPDATE public.templates
    SET name = btrim(entry->>'name'),
        config = entry->'config',
        updated_at = NOW()
    WHERE id = requested_id AND user_id = caller_id
    RETURNING id INTO persisted_id;

    IF persisted_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.templates WHERE id = requested_id) THEN
        RAISE EXCEPTION 'Template row does not belong to the signed-in user';
      END IF;

      INSERT INTO public.templates (id, user_id, name, config)
      VALUES (
        requested_id,
        caller_id,
        btrim(entry->>'name'),
        entry->'config'
      )
      RETURNING id INTO persisted_id;
    END IF;
    retained_ids := array_append(retained_ids, persisted_id);
  END LOOP;

  DELETE FROM public.templates
  WHERE user_id = caller_id
    AND NOT (id = ANY(retained_ids));

  RETURN QUERY
    SELECT template.*
    FROM public.templates AS template
    WHERE template.user_id = caller_id
    ORDER BY template.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_my_templates(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_my_templates(jsonb) TO authenticated;
