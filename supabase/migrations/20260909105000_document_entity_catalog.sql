-- One explicit, owner-reviewed adoption copies a Template's Entity list into
-- immutable document-owned truth. Existing documents are never inferred from
-- documents.template_id and no Entity mutation API is introduced here.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS survey_private;

CREATE TABLE survey_private.document_entity_catalogs (
  document_id uuid PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE,
  catalog_revision bigint NOT NULL DEFAULT 1 CHECK (catalog_revision = 1),
  source_template_id uuid NOT NULL,
  source_template_updated_at timestamptz NOT NULL,
  source_entities_sha256 text NOT NULL CHECK (source_entities_sha256 ~ '^[0-9a-f]{64}$'),
  seed_operation_id uuid NOT NULL UNIQUE,
  seed_request_sha256 text NOT NULL CHECK (seed_request_sha256 ~ '^[0-9a-f]{64}$'),
  seeded_by uuid NOT NULL,
  seeded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE survey_private.document_entity_definitions (
  document_id uuid NOT NULL REFERENCES survey_private.document_entity_catalogs(document_id) ON DELETE CASCADE,
  entity_id text NOT NULL CHECK (entity_id = btrim(entity_id) AND length(entity_id) BETWEEN 1 AND 128),
  definition_revision bigint NOT NULL DEFAULT 1 CHECK (definition_revision = 1),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 255),
  name text NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 256),
  name_key text NOT NULL CHECK (length(name_key) BETWEEN 1 AND 256),
  color text NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  opacity numeric NOT NULL CHECK (opacity BETWEEN 0 AND 1),
  border_color text CHECK (border_color IS NULL OR border_color ~ '^#[0-9a-f]{6}$'),
  border_opacity numeric CHECK (border_opacity IS NULL OR border_opacity BETWEEN 0 AND 1),
  match_fill boolean NOT NULL,
  PRIMARY KEY (document_id, entity_id),
  UNIQUE (document_id, ordinal),
  UNIQUE (document_id, name_key)
);

ALTER TABLE survey_private.document_entity_catalogs OWNER TO postgres;
ALTER TABLE survey_private.document_entity_definitions OWNER TO postgres;
ALTER TABLE survey_private.document_entity_catalogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_private.document_entity_definitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_entity_catalogs,
  survey_private.document_entity_definitions FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION survey_private.document_entity_name_key(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT translate(
    regexp_replace(
      btrim(normalize(p_name, NFC), E' \t\n\r\f'),
      E'[ \t\n\r\f]+', ' ', 'g'),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')
$$;

CREATE OR REPLACE FUNCTION survey_private.document_entity_color(p_color text)
RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
DECLARE value text := btrim(coalesce(p_color, '')); rgb text[];
BEGIN
  IF value = '' THEN RETURN '#8c8c8a';END IF;
  IF value ~* '^#[0-9a-f]{6}$' THEN RETURN lower(value);END IF;
  IF value ~* '^#[0-9a-f]{3}$' THEN
    RETURN lower('#'||substr(value,2,1)||substr(value,2,1)||substr(value,3,1)||substr(value,3,1)||substr(value,4,1)||substr(value,4,1));
  END IF;
  rgb := regexp_match(value, '^rgba?\(\s*([0-9]+)[, ]+([0-9]+)[, ]+([0-9]+)(?:[, /][^)]*)?\)$', 'i');
  IF rgb IS NOT NULL AND rgb[1]::integer BETWEEN 0 AND 255
     AND rgb[2]::integer BETWEEN 0 AND 255 AND rgb[3]::integer BETWEEN 0 AND 255 THEN
    RETURN '#'||lpad(to_hex(rgb[1]::integer),2,'0')||lpad(to_hex(rgb[2]::integer),2,'0')||lpad(to_hex(rgb[3]::integer),2,'0');
  END IF;
  RETURN '#8c8c8a';
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.normalize_document_template_entities(p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
DECLARE
  source_entities jsonb;
  entity jsonb;
  normalized jsonb := '[]'::jsonb;
  entity_id text;
  entity_name text;
  entity_color text;
  entity_opacity numeric;
  entity_border_color text;
  entity_border_opacity numeric;
  entity_match_fill boolean;
  seen_ids text[] := ARRAY[]::text[];
  seen_names text[] := ARRAY[]::text[];
  name_key text;
  entity_count integer;
BEGIN
  IF p_config IS NULL OR jsonb_typeof(p_config) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_config->'entities') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Template Entity list is invalid' USING ERRCODE = '22023';
  END IF;
  source_entities := p_config->'entities';
  entity_count := jsonb_array_length(source_entities);
  IF entity_count > 256 OR octet_length(source_entities::text) > 262144 THEN
    RAISE EXCEPTION 'Template Entity list exceeds its limit' USING ERRCODE = '54000';
  END IF;

  FOR entity IN SELECT value FROM jsonb_array_elements(source_entities) LOOP
    IF jsonb_typeof(entity) IS DISTINCT FROM 'object'
       OR (entity - ARRAY['id','name','role','color','opacity','borderColor','borderOpacity','matchFill']::text[]) <> '{}'::jsonb
       OR jsonb_typeof(entity->'id') IS DISTINCT FROM 'string'
       OR (jsonb_typeof(entity->'name') IS DISTINCT FROM 'string'
         AND jsonb_typeof(entity->'role') IS DISTINCT FROM 'string')
       OR (entity ? 'color' AND jsonb_typeof(entity->'color') IS DISTINCT FROM 'string') THEN
      RAISE EXCEPTION 'Template Entity entry is invalid' USING ERRCODE = '22023';
    END IF;
    entity_id := entity->>'id';
    entity_name := coalesce(entity->>'name', entity->>'role');
    entity_color := survey_private.document_entity_color(entity->>'color');
    IF entity_id IS DISTINCT FROM btrim(entity_id) OR length(entity_id) NOT BETWEEN 1 AND 128
       OR entity_name IS DISTINCT FROM btrim(entity_name) OR length(entity_name) NOT BETWEEN 1 AND 256 THEN
      RAISE EXCEPTION 'Template Entity identity, name, or color is invalid' USING ERRCODE = '22023';
    END IF;

    IF entity ? 'opacity' THEN
      IF jsonb_typeof(entity->'opacity') <> 'number' THEN
        RAISE EXCEPTION 'Template Entity opacity is invalid' USING ERRCODE = '22023';
      END IF;
      entity_opacity := (entity->>'opacity')::numeric;
    ELSE entity_opacity := 0.35;
    END IF;
    IF entity_opacity < 0 OR entity_opacity > 1 THEN
      RAISE EXCEPTION 'Template Entity opacity is invalid' USING ERRCODE = '22023';
    END IF;

    IF entity ? 'borderColor' AND entity->'borderColor' <> 'null'::jsonb THEN
      IF jsonb_typeof(entity->'borderColor') <> 'string' THEN
        RAISE EXCEPTION 'Template Entity border color is invalid' USING ERRCODE = '22023';
      END IF;
      entity_border_color := survey_private.document_entity_color(entity->>'borderColor');
    ELSE entity_border_color := NULL;
    END IF;

    IF entity ? 'borderOpacity' AND entity->'borderOpacity' <> 'null'::jsonb THEN
      IF jsonb_typeof(entity->'borderOpacity') <> 'number' THEN
        RAISE EXCEPTION 'Template Entity border opacity is invalid' USING ERRCODE = '22023';
      END IF;
      entity_border_opacity := (entity->>'borderOpacity')::numeric;
      IF entity_border_opacity < 0 OR entity_border_opacity > 1 THEN
        RAISE EXCEPTION 'Template Entity border opacity is invalid' USING ERRCODE = '22023';
      END IF;
    ELSE entity_border_opacity := NULL;
    END IF;

    IF entity ? 'matchFill' THEN
      IF jsonb_typeof(entity->'matchFill') <> 'boolean' THEN
        RAISE EXCEPTION 'Template Entity match-fill value is invalid' USING ERRCODE = '22023';
      END IF;
      entity_match_fill := (entity->>'matchFill')::boolean;
    ELSE entity_match_fill := false;
    END IF;

    name_key := survey_private.document_entity_name_key(entity_name);
    IF entity_id = ANY(seen_ids) THEN
      RAISE EXCEPTION 'Template Entity IDs must be unique' USING ERRCODE = '23505';
    END IF;
    IF name_key = ANY(seen_names) THEN
      RAISE EXCEPTION 'Template Entity names must be unique' USING ERRCODE = '23505';
    END IF;
    seen_ids := array_append(seen_ids, entity_id);
    seen_names := array_append(seen_names, name_key);
    normalized := normalized || jsonb_build_array(jsonb_build_object(
      'id', entity_id, 'name', entity_name, 'color', entity_color,
      'opacity', entity_opacity, 'borderColor', entity_border_color,
      'borderOpacity', entity_border_opacity, 'matchFill', entity_match_fill));
  END LOOP;
  RETURN normalized;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.document_entity_digest(p_entities jsonb)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT encode(extensions.digest(convert_to(p_entities::text, 'UTF8'), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION survey_private.document_entity_catalog_receipt(p_document_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
  SELECT jsonb_build_object(
    'status', 'accepted', 'version', 1, 'documentId', c.document_id,
    'catalogRevision', c.catalog_revision,
    'source', jsonb_build_object('templateId', c.source_template_id,
      'templateUpdatedAt', c.source_template_updated_at,
      'entitiesSha256', c.source_entities_sha256),
    'seed', jsonb_build_object('operationId', c.seed_operation_id,
      'requestSha256', c.seed_request_sha256),
    'entities', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', e.entity_id, 'name', e.name, 'color', e.color,
      'opacity', e.opacity, 'borderColor', e.border_color,
      'borderOpacity', e.border_opacity, 'matchFill', e.match_fill)
      ORDER BY e.ordinal) FROM survey_private.document_entity_definitions e
      WHERE e.document_id = c.document_id), '[]'::jsonb))
  FROM survey_private.document_entity_catalogs c WHERE c.document_id = p_document_id
$$;

CREATE OR REPLACE FUNCTION public.preview_document_entity_catalog_adoption(
  p_document_id uuid, p_template_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  actor uuid := auth.uid();
  document_owner uuid;
  template_owner uuid;
  template_updated_at timestamptz;
  template_config jsonb;
  entities jsonb;
BEGIN
  SELECT d.user_id INTO document_owner FROM public.documents d WHERE d.id = p_document_id;
  IF actor IS NULL OR document_owner IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'Document Entity adoption is not permitted' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM survey_private.account_write_guards g WHERE g.user_id = actor AND g.closing)
     OR public.kal49_document_is_locked(p_document_id) THEN
    RAISE EXCEPTION 'Document Entity adoption is not permitted' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM survey_private.document_entity_catalogs c WHERE c.document_id = p_document_id) THEN
    RAISE EXCEPTION 'Document Entity catalog already exists' USING ERRCODE = '23505';
  END IF;
  SELECT t.user_id, t.updated_at, t.config INTO template_owner, template_updated_at, template_config
    FROM public.templates t WHERE t.id = p_template_id;
  IF template_owner IS DISTINCT FROM actor OR template_updated_at IS NULL THEN
    RAISE EXCEPTION 'Template Entity adoption source is not permitted' USING ERRCODE = '42501';
  END IF;
  entities := survey_private.normalize_document_template_entities(template_config);
  RETURN jsonb_build_object('status', 'preview', 'version', 1, 'documentId', p_document_id,
    'source', jsonb_build_object('templateId', p_template_id,
      'templateUpdatedAt', template_updated_at,
      'entitiesSha256', survey_private.document_entity_digest(entities)),
    'entities', entities);
END;
$$;

CREATE OR REPLACE FUNCTION public.adopt_document_entity_catalog(
  p_document_id uuid, p_template_id uuid, p_expected_template_updated_at timestamptz,
  p_expected_entities_sha256 text, p_operation_id uuid, p_request_sha256 text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' SET lock_timeout = '2s' AS $$
DECLARE
  actor uuid := auth.uid();
  document_row public.documents%ROWTYPE;
  catalog survey_private.document_entity_catalogs%ROWTYPE;
  template_owner uuid;
  template_updated_at timestamptz;
  template_config jsonb;
  entities jsonb;
  entities_sha256 text;
  entity jsonb;
  entity_ordinal integer := 0;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Document Entity adoption requires READ COMMITTED' USING ERRCODE = '25001';
  END IF;
  IF actor IS NULL OR p_document_id IS NULL OR p_template_id IS NULL OR p_expected_template_updated_at IS NULL
     OR p_operation_id IS NULL OR p_expected_entities_sha256 IS NULL OR p_request_sha256 IS NULL
     OR p_expected_entities_sha256 !~ '^[0-9a-f]{64}$'
     OR p_request_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Document Entity adoption request is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO document_row FROM public.documents d WHERE d.id = p_document_id FOR UPDATE;
  IF NOT FOUND OR document_row.user_id IS DISTINCT FROM actor
     OR document_row.archived IS DISTINCT FROM false OR document_row.user_archived_at IS NOT NULL
     OR public.kal49_document_is_locked(p_document_id) THEN
    RAISE EXCEPTION 'Document Entity adoption is not permitted' USING ERRCODE = '42501';
  END IF;
  PERFORM survey_private.assert_account_open(actor);
  SELECT * INTO catalog FROM survey_private.document_entity_catalogs c WHERE c.document_id = p_document_id;
  IF FOUND THEN
    IF catalog.seeded_by = actor AND catalog.source_template_id = p_template_id
       AND catalog.source_template_updated_at = p_expected_template_updated_at
       AND catalog.source_entities_sha256 = p_expected_entities_sha256
       AND catalog.seed_operation_id = p_operation_id
       AND catalog.seed_request_sha256 = p_request_sha256 THEN
      RETURN survey_private.document_entity_catalog_receipt(p_document_id);
    END IF;
    RAISE EXCEPTION 'Document Entity catalog already exists' USING ERRCODE = '23505';
  END IF;

  SELECT t.user_id, t.updated_at, t.config INTO template_owner, template_updated_at, template_config
    FROM public.templates t WHERE t.id = p_template_id FOR SHARE;
  IF template_owner IS DISTINCT FROM actor OR template_updated_at IS NULL THEN
    RAISE EXCEPTION 'Template Entity adoption source is not permitted' USING ERRCODE = '42501';
  END IF;
  entities := survey_private.normalize_document_template_entities(template_config);
  entities_sha256 := survey_private.document_entity_digest(entities);
  IF template_updated_at IS DISTINCT FROM p_expected_template_updated_at
     OR entities_sha256 IS DISTINCT FROM p_expected_entities_sha256 THEN
    RAISE EXCEPTION 'Template Entity adoption preview is stale' USING ERRCODE = '40001';
  END IF;

  INSERT INTO survey_private.document_entity_catalogs(document_id, source_template_id,
    source_template_updated_at, source_entities_sha256, seed_operation_id,
    seed_request_sha256, seeded_by)
  VALUES (p_document_id, p_template_id, template_updated_at, entities_sha256,
    p_operation_id, p_request_sha256, actor);
  FOR entity IN SELECT value FROM jsonb_array_elements(entities) LOOP
    INSERT INTO survey_private.document_entity_definitions(document_id, entity_id, ordinal,
      name, name_key, color, opacity, border_color, border_opacity, match_fill)
    VALUES (p_document_id, entity->>'id', entity_ordinal, entity->>'name',
      survey_private.document_entity_name_key(entity->>'name'), entity->>'color',
      (entity->>'opacity')::numeric, entity->>'borderColor',
      (entity->>'borderOpacity')::numeric, (entity->>'matchFill')::boolean);
    entity_ordinal := entity_ordinal + 1;
  END LOOP;

  -- This mutable field is bound only by this explicit reviewed adoption. It is
  -- never used to infer a missing catalog or to follow later Template edits.
  UPDATE public.documents SET template_id = p_template_id WHERE id = p_document_id;
  RETURN survey_private.document_entity_catalog_receipt(p_document_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.read_document_entity_catalog(p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE receipt jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.user_can_access_document(p_document_id, 'viewer') IS NOT TRUE THEN
    RAISE EXCEPTION 'Document Entity catalog is not available' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM survey_private.account_write_guards g
      WHERE g.closing AND g.user_id IN (auth.uid(),
        (SELECT d.user_id FROM public.documents d WHERE d.id = p_document_id))) THEN
    RAISE EXCEPTION 'Document Entity catalog is not available' USING ERRCODE = '42501';
  END IF;
  receipt := survey_private.document_entity_catalog_receipt(p_document_id);
  RETURN coalesce(receipt, jsonb_build_object('status', 'unadopted', 'version', 1,
    'documentId', p_document_id));
END;
$$;

ALTER FUNCTION survey_private.document_entity_name_key(text) OWNER TO postgres;
ALTER FUNCTION survey_private.document_entity_color(text) OWNER TO postgres;
ALTER FUNCTION survey_private.normalize_document_template_entities(jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.document_entity_digest(jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.document_entity_catalog_receipt(uuid) OWNER TO postgres;
ALTER FUNCTION public.preview_document_entity_catalog_adoption(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.adopt_document_entity_catalog(uuid,uuid,timestamptz,text,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.read_document_entity_catalog(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.document_entity_name_key(text),
  survey_private.document_entity_color(text),
  survey_private.normalize_document_template_entities(jsonb),
  survey_private.document_entity_digest(jsonb),
  survey_private.document_entity_catalog_receipt(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.preview_document_entity_catalog_adoption(uuid,uuid),
  public.adopt_document_entity_catalog(uuid,uuid,timestamptz,text,uuid,text),
  public.read_document_entity_catalog(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_document_entity_catalog_adoption(uuid,uuid),
  public.adopt_document_entity_catalog(uuid,uuid,timestamptz,text,uuid,text),
  public.read_document_entity_catalog(uuid) TO authenticated;

COMMIT;
