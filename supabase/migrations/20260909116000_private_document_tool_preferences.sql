-- Per-actor document tool defaults. This does not read, copy, or mutate the
-- legacy shared field on the document row.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS survey_private;

CREATE TABLE survey_private.document_tool_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  format_version smallint NOT NULL DEFAULT 1 CHECK (format_version = 1),
  revision bigint NOT NULL CHECK (revision >= 1),
  expected_revision bigint NOT NULL CHECK (expected_revision >= 0),
  client_revision uuid NOT NULL,
  preferences jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, document_id)
);

CREATE INDEX document_tool_preferences_document_id_idx
  ON survey_private.document_tool_preferences(document_id);

ALTER TABLE survey_private.document_tool_preferences OWNER TO postgres;
ALTER TABLE survey_private.document_tool_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_tool_preferences_actor_read
  ON survey_private.document_tool_preferences
  FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    AND public.user_can_access_document(document_id, 'viewer') IS TRUE
  );

REVOKE ALL ON survey_private.document_tool_preferences FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION survey_private.validate_document_tool_preferences(p_preferences jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  tool_id text;
  tool_value jsonb;
  field_name text;
  field_value jsonb;
  number_value numeric;
  color_value text;
  color_components text[];
  allowed_tools constant text[] := ARRAY[
    'pen','highlighter','text-highlight','eraser','rect','ellipse','line','arrow',
    'callout','counter','text','note','underline','strikeout','squiggly','surveyMarker'
  ];
  allowed_fields constant text[] := ARRAY[
    'strokeColor','strokeWidth','strokeOpacity','fillColor','fillOpacity'
  ];
BEGIN
  IF p_preferences IS NULL OR pg_catalog.jsonb_typeof(p_preferences) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Tool preferences must be an object' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.octet_length(p_preferences::text) > 32768 THEN
    RAISE EXCEPTION 'Tool preferences exceed 32768 bytes' USING ERRCODE = '54000';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_preferences)) > 16 THEN
    RAISE EXCEPTION 'Tool preferences contain too many tools' USING ERRCODE = '22023';
  END IF;

  FOR tool_id, tool_value IN SELECT key, value FROM pg_catalog.jsonb_each(p_preferences) LOOP
    IF NOT (tool_id = ANY(allowed_tools))
       OR pg_catalog.length(tool_id) > 32
       OR pg_catalog.jsonb_typeof(tool_value) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Tool preference entry is invalid' USING ERRCODE = '22023';
    END IF;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(tool_value)) > 5 THEN
      RAISE EXCEPTION 'Tool preference entry has too many fields' USING ERRCODE = '22023';
    END IF;

    FOR field_name, field_value IN SELECT key, value FROM pg_catalog.jsonb_each(tool_value) LOOP
      IF NOT (field_name = ANY(allowed_fields)) THEN
        RAISE EXCEPTION 'Tool preference field is invalid' USING ERRCODE = '22023';
      END IF;
      IF field_name IN ('strokeColor', 'fillColor') THEN
        IF pg_catalog.jsonb_typeof(field_value) IS DISTINCT FROM 'string' THEN
          RAISE EXCEPTION 'Tool preference color is invalid' USING ERRCODE = '22023';
        END IF;
        color_value := field_value #>> '{}';
        IF pg_catalog.length(color_value) NOT BETWEEN 1 AND 64 OR color_value ~ '[[:cntrl:]]'
           OR NOT (
             color_value ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$'
             OR lower(color_value) = ANY(ARRAY['aqua','black','blue','fuchsia','gray','green',
               'lime','maroon','navy','olive','orange','purple','red','silver','teal','transparent',
               'white','yellow']::text[])
             OR color_value ~ '^rgba?\([0-9]{1,3},[ ]*[0-9]{1,3},[ ]*[0-9]{1,3}(,[ ]*(0(\.[0-9]+)?|1(\.0+)?))?\)$'
           ) THEN
          RAISE EXCEPTION 'Tool preference color is invalid' USING ERRCODE = '22023';
        END IF;
        IF color_value ~ '^rgba?\(' THEN
          color_components := pg_catalog.regexp_match(color_value,
            '^rgba?\(([0-9]{1,3}),[ ]*([0-9]{1,3}),[ ]*([0-9]{1,3})');
          IF color_components IS NULL OR color_components[1]::integer > 255
             OR color_components[2]::integer > 255 OR color_components[3]::integer > 255 THEN
            RAISE EXCEPTION 'Tool preference color is invalid' USING ERRCODE = '22023';
          END IF;
        END IF;
      ELSE
        IF pg_catalog.jsonb_typeof(field_value) IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION 'Tool preference number is invalid' USING ERRCODE = '22023';
        END IF;
        BEGIN
          number_value := (field_value #>> '{}')::pg_catalog.numeric;
        EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
          RAISE EXCEPTION 'Tool preference number is invalid' USING ERRCODE = '22023';
        END;
        IF (field_name = 'strokeWidth' AND number_value NOT BETWEEN 0 AND 1000)
           OR (field_name IN ('strokeOpacity', 'fillOpacity') AND number_value NOT BETWEEN 0 AND 100) THEN
          RAISE EXCEPTION 'Tool preference number is outside its range' USING ERRCODE = '22023';
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.document_tool_preferences_receipt(
  p_status text,
  p_document_id uuid,
  p_revision bigint,
  p_client_revision uuid,
  p_preferences jsonb,
  p_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'status', p_status,
    'version', 1,
    'documentId', p_document_id,
    'revision', p_revision,
    'clientRevision', p_client_revision,
    'preferences', p_preferences,
    'updatedAt', CASE WHEN p_updated_at IS NULL THEN NULL ELSE
      pg_catalog.to_char(p_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END
  )
$$;

CREATE OR REPLACE FUNCTION public.read_document_tool_preferences(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  stored survey_private.document_tool_preferences%ROWTYPE;
BEGIN
  IF actor IS NULL OR p_document_id IS NULL
     OR public.user_can_access_document(p_document_id, 'viewer') IS NOT TRUE THEN
    RAISE EXCEPTION 'Document tool preferences are not available' USING ERRCODE = '42501';
  END IF;

  SELECT p.* INTO stored
  FROM survey_private.document_tool_preferences p
  WHERE p.user_id = actor AND p.document_id = p_document_id;

  IF NOT FOUND THEN
    RETURN survey_private.document_tool_preferences_receipt(
      'missing', p_document_id, 0, NULL, NULL, NULL);
  END IF;
  RETURN survey_private.document_tool_preferences_receipt(
    'present', stored.document_id, stored.revision, stored.client_revision,
    stored.preferences, stored.updated_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.write_document_tool_preferences(
  p_document_id uuid,
  p_expected_revision bigint,
  p_client_revision uuid,
  p_preferences jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  stored survey_private.document_tool_preferences%ROWTYPE;
  document_owner uuid;
  next_revision bigint;
  write_time timestamptz;
BEGIN
  IF actor IS NULL OR p_document_id IS NULL
     OR public.user_can_access_document(p_document_id, 'viewer') IS NOT TRUE THEN
    RAISE EXCEPTION 'Document tool preferences are not available' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 OR p_client_revision IS NULL THEN
    RAISE EXCEPTION 'Tool preference revision is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM survey_private.validate_document_tool_preferences(p_preferences);

  -- The document lock keeps create/update/retry decisions short and serial, and
  -- prevents an access revocation or document deletion from racing the write.
  SELECT d.user_id INTO document_owner
  FROM public.documents d WHERE d.id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document tool preferences are not available' USING ERRCODE = '42501';
  END IF;
  IF document_owner IS DISTINCT FROM actor THEN
    PERFORM 1 FROM public.document_collaborators c
    WHERE c.document_id = p_document_id AND c.user_id = actor
      AND c.status = 'active' AND c.role IN ('viewer','editor','owner')
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Document tool preferences are not available' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF public.user_can_access_document(p_document_id, 'viewer') IS NOT TRUE THEN
    RAISE EXCEPTION 'Document tool preferences are not available' USING ERRCODE = '42501';
  END IF;

  SELECT p.* INTO stored
  FROM survey_private.document_tool_preferences p
  WHERE p.user_id = actor AND p.document_id = p_document_id
  FOR UPDATE;

  IF FOUND AND stored.client_revision = p_client_revision THEN
    IF stored.expected_revision IS DISTINCT FROM p_expected_revision
       OR stored.preferences IS DISTINCT FROM p_preferences THEN
      RAISE EXCEPTION 'Client revision was already used for a different tool preference request'
        USING ERRCODE = '23505';
    END IF;
    RETURN survey_private.document_tool_preferences_receipt(
      'written', stored.document_id, stored.revision, stored.client_revision,
      stored.preferences, stored.updated_at);
  END IF;

  IF NOT FOUND THEN
    IF p_expected_revision <> 0 THEN
      RAISE EXCEPTION 'Tool preference revision conflict' USING ERRCODE = '40001';
    END IF;
    next_revision := 1;
  ELSE
    IF p_expected_revision <> stored.revision THEN
      RAISE EXCEPTION 'Tool preference revision conflict' USING ERRCODE = '40001';
    END IF;
    next_revision := stored.revision + 1;
  END IF;

  write_time := pg_catalog.clock_timestamp();
  INSERT INTO survey_private.document_tool_preferences(
    user_id, document_id, format_version, revision, expected_revision,
    client_revision, preferences, updated_at)
  VALUES (actor, p_document_id, 1, next_revision, p_expected_revision,
    p_client_revision, p_preferences, write_time)
  ON CONFLICT (user_id, document_id) DO UPDATE SET
    format_version = 1,
    revision = EXCLUDED.revision,
    expected_revision = EXCLUDED.expected_revision,
    client_revision = EXCLUDED.client_revision,
    preferences = EXCLUDED.preferences,
    updated_at = EXCLUDED.updated_at;

  RETURN survey_private.document_tool_preferences_receipt(
    'written', p_document_id, next_revision, p_client_revision, p_preferences, write_time);
END;
$$;

ALTER FUNCTION survey_private.validate_document_tool_preferences(jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.document_tool_preferences_receipt(text,uuid,bigint,uuid,jsonb,timestamptz) OWNER TO postgres;
ALTER FUNCTION public.read_document_tool_preferences(uuid) OWNER TO postgres;
ALTER FUNCTION public.write_document_tool_preferences(uuid,bigint,uuid,jsonb) OWNER TO postgres;

REVOKE ALL ON FUNCTION survey_private.validate_document_tool_preferences(jsonb),
  survey_private.document_tool_preferences_receipt(text,uuid,bigint,uuid,jsonb,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_document_tool_preferences(uuid),
  public.write_document_tool_preferences(uuid,bigint,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_document_tool_preferences(uuid),
  public.write_document_tool_preferences(uuid,bigint,uuid,jsonb)
  TO authenticated;

COMMIT;
