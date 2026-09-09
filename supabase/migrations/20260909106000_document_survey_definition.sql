-- One explicit owner review copies the module/category/checklist tree into
-- immutable document-owned truth. Existing documents are never inferred from
-- documents.template_id, and Template access is not granted to collaborators.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS survey_private;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_collation
      WHERE collname = 'und-x-icu' AND collprovider = 'i') THEN
    RAISE EXCEPTION 'Document Survey definitions require the ICU root collation'
      USING ERRCODE = '0A000';
  END IF;
END $$;

CREATE TABLE survey_private.document_survey_definitions (
  document_id uuid PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE,
  definition_revision bigint NOT NULL DEFAULT 1 CHECK (definition_revision = 1),
  source_template_id uuid NOT NULL,
  source_template_updated_at timestamptz NOT NULL,
  source_structure_sha256 text NOT NULL CHECK (source_structure_sha256 ~ '^[0-9a-f]{64}$'),
  seed_operation_id uuid NOT NULL UNIQUE,
  seed_request_sha256 text NOT NULL CHECK (seed_request_sha256 ~ '^[0-9a-f]{64}$'),
  modules jsonb NOT NULL CHECK (jsonb_typeof(modules) = 'array'),
  seeded_by uuid NOT NULL,
  seeded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE survey_private.document_survey_definitions OWNER TO postgres;
ALTER TABLE survey_private.document_survey_definitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_survey_definitions
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION survey_private.document_survey_whitespace()
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT E' \t\n\f\r' || chr(11) || chr(160) || chr(5760) || chr(8192) || chr(8193)
    || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198)
    || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232)
    || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)
$$;

CREATE OR REPLACE FUNCTION survey_private.document_survey_utf16_length(p_value text)
RETURNS integer LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
DECLARE total integer := 0; i integer; point integer;
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;
  FOR i IN 1..length(p_value) LOOP
    point := ascii(substr(p_value, i, 1));
    total := total + CASE WHEN point > 65535 THEN 2 ELSE 1 END;
  END LOOP;
  RETURN total;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.document_survey_utf16_left(p_value text, p_units integer)
RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
DECLARE result text := ''; used integer := 0; i integer; piece text; cost integer;
BEGIN
  IF p_value IS NULL OR p_units < 1 THEN RETURN ''; END IF;
  FOR i IN 1..length(p_value) LOOP
    piece := substr(p_value, i, 1);
    cost := CASE WHEN ascii(piece) > 65535 THEN 2 ELSE 1 END;
    EXIT WHEN used + cost > p_units;
    result := result || piece;
    used := used + cost;
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.document_survey_owned_text(
  p_value text, p_max_units integer)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_value IS NULL OR char_length(p_value) < 1 OR char_length(p_value) > p_max_units
      THEN false
    ELSE p_value = btrim(p_value, survey_private.document_survey_whitespace())
      AND survey_private.document_survey_utf16_length(p_value) BETWEEN 1 AND p_max_units
  END
$$;

CREATE OR REPLACE FUNCTION survey_private.document_survey_timestamp(p_value text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
DECLARE parts text[]; year_part integer; month_part integer; day_part integer;
  hour_part integer; minute_part integer; second_part integer;
  offset_hour integer; offset_minute integer;
BEGIN
  parts := regexp_match(p_value,
    '^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-](\d{2}):(\d{2}))$');
  IF parts IS NULL THEN
    RETURN false;
  END IF;
  year_part := parts[1]::integer; month_part := parts[2]::integer;
  day_part := parts[3]::integer; hour_part := parts[4]::integer;
  minute_part := parts[5]::integer; second_part := parts[6]::integer;
  offset_hour := coalesce(parts[8]::integer, 0);
  offset_minute := coalesce(parts[9]::integer, 0);
  IF year_part < 1 OR month_part NOT BETWEEN 1 AND 12 OR day_part < 1
     OR hour_part NOT BETWEEN 0 AND 23 OR minute_part NOT BETWEEN 0 AND 59
     OR second_part NOT BETWEEN 0 AND 59 OR offset_hour > 14
     OR offset_minute > 59 OR (offset_hour = 14 AND offset_minute <> 0) THEN
    RETURN false;
  END IF;
  PERFORM make_date(year_part, month_part, day_part);
  PERFORM p_value::timestamptz;
  RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RETURN false;
END;
$$;

-- Exact current JS rule: lowercase first, then remove the ECMAScript whitespace
-- set. The ICU root collation was verified against the supported V8 runtime;
-- the disposable migration tests keep cross-runtime vectors pinned.
CREATE OR REPLACE FUNCTION survey_private.document_survey_module_data_key(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT translate(lower(p_name COLLATE pg_catalog."und-x-icu"),
    survey_private.document_survey_whitespace(), '') || 'Data'
$$;

CREATE OR REPLACE FUNCTION survey_private.document_survey_display_key(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT lower(regexp_replace(btrim(translate(
      normalize(p_name, NFC),
      survey_private.document_survey_whitespace(),
      repeat(' ', length(survey_private.document_survey_whitespace()))), ' '),
    ' +', ' ', 'g') COLLATE pg_catalog."und-x-icu")
$$;

CREATE OR REPLACE FUNCTION survey_private.document_survey_sheet_key(
  p_category_name text, p_module_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
DECLARE cleaned text; prefix text; units integer := 0; i integer; piece text; cost integer;
BEGIN
  cleaned := translate(btrim(coalesce(p_category_name, 'Category') || ' - '
    || coalesce(p_module_name, 'Module')), E'\\/?*[]:', '');
  FOR i IN 1..length(cleaned) LOOP
    piece := substr(cleaned, i, 1);
    cost := CASE WHEN ascii(piece) > 65535 THEN 2 ELSE 1 END;
    IF units < 31 AND units + cost > 31 THEN
      RAISE EXCEPTION 'Survey worksheet name splits a Unicode character'
        USING ERRCODE = '22023';
    END IF;
    EXIT WHEN units + cost > 31;
    units := units + cost;
  END LOOP;
  prefix := survey_private.document_survey_utf16_left(cleaned, 31);
  RETURN lower(coalesce(nullif(prefix, ''), 'Sheet') COLLATE pg_catalog."und-x-icu");
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.normalize_document_survey_checklist(p_source jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
DECLARE item jsonb; result jsonb := '[]'::jsonb; normalized jsonb;
BEGIN
  IF jsonb_typeof(p_source) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_source) > 256 THEN
    RAISE EXCEPTION 'Template Survey checklist is invalid' USING ERRCODE = '22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_source) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item->'text') IS DISTINCT FROM 'string'
       OR survey_private.document_survey_owned_text(item->>'id', 128) IS NOT TRUE
       OR survey_private.document_survey_owned_text(item->>'text', 100) IS NOT TRUE THEN
      RAISE EXCEPTION 'Template Survey checklist entry is invalid' USING ERRCODE = '22023';
    END IF;
    normalized := jsonb_build_object('id', item->>'id', 'text', item->>'text');
    IF item ? 'archived' THEN
      IF jsonb_typeof(item->'archived') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'Template Survey checklist archive flag is invalid' USING ERRCODE = '22023';
      END IF;
      normalized := normalized || jsonb_build_object('archived', (item->>'archived')::boolean);
    END IF;
    IF item ? 'archivedAt' THEN
      IF jsonb_typeof(item->'archivedAt') IS DISTINCT FROM 'string'
         OR survey_private.document_survey_utf16_length(item->>'archivedAt') > 64
         OR survey_private.document_survey_timestamp(item->>'archivedAt') IS NOT TRUE THEN
        RAISE EXCEPTION 'Template Survey checklist archive time is invalid' USING ERRCODE = '22023';
      END IF;
      normalized := normalized || jsonb_build_object('archivedAt', item->>'archivedAt');
    END IF;
    IF item ? 'lastKnownLabel' THEN
      IF jsonb_typeof(item->'lastKnownLabel') IS DISTINCT FROM 'string'
         OR survey_private.document_survey_owned_text(item->>'lastKnownLabel', 100) IS NOT TRUE THEN
        RAISE EXCEPTION 'Template Survey checklist archive label is invalid' USING ERRCODE = '22023';
      END IF;
      normalized := normalized || jsonb_build_object('lastKnownLabel', item->>'lastKnownLabel');
    END IF;
    result := result || jsonb_build_array(normalized);
  END LOOP;
  RETURN result;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Template Survey checklist archive time is invalid' USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.normalize_document_survey_categories(p_source jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
DECLARE category jsonb; result jsonb := '[]'::jsonb; checklist jsonb; alternate jsonb;
  source_checklist jsonb; checklist_count integer := 0;
BEGIN
  IF jsonb_typeof(p_source) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_source) > 1024 THEN
    RAISE EXCEPTION 'Template Survey categories are invalid' USING ERRCODE = '22023';
  END IF;
  FOR category IN SELECT value FROM jsonb_array_elements(p_source) LOOP
    IF jsonb_typeof(category) IS DISTINCT FROM 'object'
       OR jsonb_typeof(category->'id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(category->'name') IS DISTINCT FROM 'string'
       OR survey_private.document_survey_owned_text(category->>'id', 128) IS NOT TRUE
       OR survey_private.document_survey_owned_text(category->>'name', 256) IS NOT TRUE
       OR NOT (category ? 'checklist' OR category ? 'items') THEN
      RAISE EXCEPTION 'Template Survey category is invalid' USING ERRCODE = '22023';
    END IF;
    source_checklist := CASE WHEN category ? 'checklist'
      THEN category->'checklist' ELSE category->'items' END;
    IF jsonb_typeof(source_checklist) IS DISTINCT FROM 'array'
       OR jsonb_array_length(source_checklist) > 256 THEN
      RAISE EXCEPTION 'Template Survey checklist is invalid' USING ERRCODE = '22023';
    END IF;
    checklist_count := checklist_count + jsonb_array_length(source_checklist);
    IF checklist_count > 8192 THEN
      RAISE EXCEPTION 'Template Survey checklist exceeds its limit' USING ERRCODE = '54000';
    END IF;
    IF category ? 'checklist' THEN
      checklist := survey_private.normalize_document_survey_checklist(category->'checklist');
    ELSE
      checklist := survey_private.normalize_document_survey_checklist(category->'items');
    END IF;
    IF category ? 'checklist' AND category ? 'items' THEN
      alternate := survey_private.normalize_document_survey_checklist(category->'items');
      IF alternate IS DISTINCT FROM checklist THEN
        RAISE EXCEPTION 'Template Survey checklist aliases differ' USING ERRCODE = '22023';
      END IF;
    END IF;
    result := result || jsonb_build_array(jsonb_build_object(
      'id', category->>'id', 'name', category->>'name', 'checklist', checklist));
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.normalize_document_survey_modules_array(p_source jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
DECLARE module jsonb; category jsonb; result jsonb := '[]'::jsonb;
  categories jsonb; alternate jsonb; source_categories jsonb; source_checklist jsonb;
  category_count integer := 0; checklist_count integer := 0;
BEGIN
  IF jsonb_typeof(p_source) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_source) > 64 THEN
    RAISE EXCEPTION 'Template Survey modules are invalid' USING ERRCODE = '22023';
  END IF;
  FOR module IN SELECT value FROM jsonb_array_elements(p_source) LOOP
    IF jsonb_typeof(module) IS DISTINCT FROM 'object'
       OR jsonb_typeof(module->'id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(module->'name') IS DISTINCT FROM 'string'
       OR survey_private.document_survey_owned_text(module->>'id', 128) IS NOT TRUE
       OR survey_private.document_survey_owned_text(module->>'name', 256) IS NOT TRUE
       OR NOT (module ? 'categories' OR module ? 'cats') THEN
      RAISE EXCEPTION 'Template Survey module is invalid' USING ERRCODE = '22023';
    END IF;
    source_categories := CASE WHEN module ? 'categories'
      THEN module->'categories' ELSE module->'cats' END;
    IF jsonb_typeof(source_categories) IS DISTINCT FROM 'array'
       OR jsonb_array_length(source_categories) > 1024 THEN
      RAISE EXCEPTION 'Template Survey categories are invalid' USING ERRCODE = '22023';
    END IF;
    category_count := category_count + jsonb_array_length(source_categories);
    IF category_count > 1024 THEN
      RAISE EXCEPTION 'Template Survey categories exceed their limit' USING ERRCODE = '54000';
    END IF;
    FOR category IN SELECT value FROM jsonb_array_elements(source_categories) LOOP
      IF jsonb_typeof(category) IS DISTINCT FROM 'object'
         OR NOT (category ? 'checklist' OR category ? 'items') THEN
        RAISE EXCEPTION 'Template Survey category is invalid' USING ERRCODE = '22023';
      END IF;
      source_checklist := CASE WHEN category ? 'checklist'
        THEN category->'checklist' ELSE category->'items' END;
      IF jsonb_typeof(source_checklist) IS DISTINCT FROM 'array'
         OR jsonb_array_length(source_checklist) > 256 THEN
        RAISE EXCEPTION 'Template Survey checklist is invalid' USING ERRCODE = '22023';
      END IF;
      checklist_count := checklist_count + jsonb_array_length(source_checklist);
      IF checklist_count > 8192 THEN
        RAISE EXCEPTION 'Template Survey checklist exceeds its limit' USING ERRCODE = '54000';
      END IF;
    END LOOP;
    IF module ? 'categories' THEN
      categories := survey_private.normalize_document_survey_categories(module->'categories');
    ELSE
      categories := survey_private.normalize_document_survey_categories(module->'cats');
    END IF;
    IF module ? 'categories' AND module ? 'cats' THEN
      alternate := survey_private.normalize_document_survey_categories(module->'cats');
      IF alternate IS DISTINCT FROM categories THEN
        RAISE EXCEPTION 'Template Survey category aliases differ' USING ERRCODE = '22023';
      END IF;
    END IF;
    result := result || jsonb_build_array(jsonb_build_object(
      'id', module->>'id', 'name', module->>'name', 'categories', categories));
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.normalize_document_template_survey(p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
DECLARE
  modules jsonb;
  alternate jsonb;
  module jsonb;
  category jsonb;
  item jsonb;
  module_ids text[] := ARRAY[]::text[];
  category_ids text[] := ARRAY[]::text[];
  checklist_ids text[] := ARRAY[]::text[];
  module_keys text[] := ARRAY[]::text[];
  sheet_keys text[] := ARRAY[]::text[];
  category_names text[];
  checklist_texts text[];
  module_key text;
  name_key text;
  sheet_key text;
  category_count integer := 0;
  checklist_count integer := 0;
BEGIN
  IF p_config IS NULL OR jsonb_typeof(p_config) IS DISTINCT FROM 'object'
     OR NOT (p_config ? 'modules' OR p_config ? 'spaces') THEN
    RAISE EXCEPTION 'Template Survey structure is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_config ? 'modules' THEN
    modules := survey_private.normalize_document_survey_modules_array(p_config->'modules');
  ELSE
    modules := survey_private.normalize_document_survey_modules_array(p_config->'spaces');
  END IF;
  IF p_config ? 'modules' AND p_config ? 'spaces' THEN
    alternate := survey_private.normalize_document_survey_modules_array(p_config->'spaces');
    IF alternate IS DISTINCT FROM modules THEN
      RAISE EXCEPTION 'Template Survey module aliases differ' USING ERRCODE = '22023';
    END IF;
  END IF;

  FOR module IN SELECT value FROM jsonb_array_elements(modules) LOOP
    module_key := survey_private.document_survey_module_data_key(module->>'name');
    IF module->>'id' = ANY(module_ids) OR module_key = ANY(module_keys) THEN
      RAISE EXCEPTION 'Template Survey module identities conflict' USING ERRCODE = '23505';
    END IF;
    module_ids := array_append(module_ids, module->>'id');
    module_keys := array_append(module_keys, module_key);
    category_names := ARRAY[]::text[];
    IF jsonb_array_length(module->'categories') = 0 THEN
      sheet_key := survey_private.document_survey_sheet_key('General', module->>'name');
      IF sheet_key = ANY(sheet_keys) THEN
        RAISE EXCEPTION 'Template Survey worksheet identities conflict' USING ERRCODE = '23505';
      END IF;
      sheet_keys := array_append(sheet_keys, sheet_key);
    END IF;
    FOR category IN SELECT value FROM jsonb_array_elements(module->'categories') LOOP
      category_count := category_count + 1;
      name_key := survey_private.document_survey_display_key(category->>'name');
      sheet_key := survey_private.document_survey_sheet_key(category->>'name', module->>'name');
      IF category->>'id' = ANY(category_ids) OR name_key = ANY(category_names)
         OR sheet_key = ANY(sheet_keys) THEN
        RAISE EXCEPTION 'Template Survey category or worksheet identities conflict' USING ERRCODE = '23505';
      END IF;
      category_ids := array_append(category_ids, category->>'id');
      category_names := array_append(category_names, name_key);
      sheet_keys := array_append(sheet_keys, sheet_key);
      checklist_texts := ARRAY[]::text[];
      FOR item IN SELECT value FROM jsonb_array_elements(category->'checklist') LOOP
        checklist_count := checklist_count + 1;
        IF item->>'id' = ANY(checklist_ids) OR item->>'text' = ANY(checklist_texts)
           OR item->>'text' = ANY(ARRAY['Row ID','Changed By','Changed Date','Item','Entity','Notes']::text[]) THEN
          RAISE EXCEPTION 'Template Survey checklist identities or headers conflict' USING ERRCODE = '23505';
        END IF;
        checklist_ids := array_append(checklist_ids, item->>'id');
        checklist_texts := array_append(checklist_texts, item->>'text');
      END LOOP;
    END LOOP;
  END LOOP;
  IF category_count > 1024 OR checklist_count > 8192
     OR octet_length(modules::text) > 1048576 THEN
    RAISE EXCEPTION 'Template Survey structure exceeds its limit' USING ERRCODE = '54000';
  END IF;
  RETURN modules;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.document_survey_structure_digest(p_modules jsonb)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT encode(extensions.digest(convert_to(p_modules::text, 'UTF8'), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION survey_private.document_survey_definition_receipt(p_document_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
  SELECT jsonb_build_object(
    'status', 'accepted', 'version', 1, 'documentId', d.document_id,
    'definitionRevision', d.definition_revision,
    'source', jsonb_build_object('templateId', d.source_template_id,
      'templateUpdatedAt', d.source_template_updated_at,
      'structureSha256', d.source_structure_sha256),
    'seed', jsonb_build_object('operationId', d.seed_operation_id,
      'requestSha256', d.seed_request_sha256),
    'modules', d.modules)
  FROM survey_private.document_survey_definitions d WHERE d.document_id = p_document_id
$$;

CREATE OR REPLACE FUNCTION public.preview_document_survey_definition_adoption(
  p_document_id uuid, p_template_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  actor uuid := auth.uid();
  document_row public.documents%ROWTYPE;
  template_owner uuid;
  template_updated_at timestamptz;
  template_config jsonb;
  template_archived boolean;
  template_user_archived_at timestamptz;
  modules jsonb;
BEGIN
  SELECT d.* INTO document_row FROM public.documents d WHERE d.id = p_document_id;
  IF actor IS NULL OR NOT FOUND OR document_row.user_id IS DISTINCT FROM actor
     OR document_row.archived IS DISTINCT FROM false OR document_row.user_archived_at IS NOT NULL
     OR public.kal49_document_is_locked(p_document_id) THEN
    RAISE EXCEPTION 'Document Survey adoption is not permitted' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM survey_private.account_write_guards g
      WHERE g.user_id = actor AND g.closing) THEN
    RAISE EXCEPTION 'Document Survey adoption is not permitted' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM survey_private.document_survey_definitions d
      WHERE d.document_id = p_document_id) THEN
    RAISE EXCEPTION 'Document Survey definition already exists' USING ERRCODE = '23505';
  END IF;
  SELECT t.user_id, t.updated_at, t.config, t.archived, t.user_archived_at
    INTO template_owner, template_updated_at, template_config,
      template_archived, template_user_archived_at
    FROM public.templates t WHERE t.id = p_template_id;
  IF template_owner IS DISTINCT FROM actor OR template_updated_at IS NULL
     OR template_archived IS DISTINCT FROM false OR template_user_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Template Survey adoption source is not permitted' USING ERRCODE = '42501';
  END IF;
  modules := survey_private.normalize_document_template_survey(template_config);
  RETURN jsonb_build_object('status', 'preview', 'version', 1, 'documentId', p_document_id,
    'source', jsonb_build_object('templateId', p_template_id,
      'templateUpdatedAt', template_updated_at,
      'structureSha256', survey_private.document_survey_structure_digest(modules)),
    'modules', modules);
END;
$$;

CREATE OR REPLACE FUNCTION public.adopt_document_survey_definition(
  p_document_id uuid, p_template_id uuid, p_expected_template_updated_at timestamptz,
  p_expected_structure_sha256 text, p_operation_id uuid, p_request_sha256 text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC'
  SET lock_timeout = '2s' SET statement_timeout = '30s' AS $$
DECLARE
  actor uuid := auth.uid();
  document_row public.documents%ROWTYPE;
  definition survey_private.document_survey_definitions%ROWTYPE;
  template_owner uuid;
  template_updated_at timestamptz;
  template_config jsonb;
  template_archived boolean;
  template_user_archived_at timestamptz;
  modules jsonb;
  structure_sha256 text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Document Survey adoption requires READ COMMITTED' USING ERRCODE = '25001';
  END IF;
  IF actor IS NULL OR p_document_id IS NULL OR p_template_id IS NULL
     OR p_expected_template_updated_at IS NULL OR p_operation_id IS NULL
     OR p_expected_structure_sha256 IS NULL OR p_request_sha256 IS NULL
     OR p_expected_structure_sha256 !~ '^[0-9a-f]{64}$'
     OR p_request_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Document Survey adoption request is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO document_row FROM public.documents d WHERE d.id = p_document_id FOR UPDATE;
  IF NOT FOUND OR document_row.user_id IS DISTINCT FROM actor
     OR document_row.archived IS DISTINCT FROM false OR document_row.user_archived_at IS NOT NULL
     OR public.kal49_document_is_locked(p_document_id) THEN
    RAISE EXCEPTION 'Document Survey adoption is not permitted' USING ERRCODE = '42501';
  END IF;
  PERFORM survey_private.assert_account_open(actor);
  SELECT * INTO definition FROM survey_private.document_survey_definitions d
    WHERE d.document_id = p_document_id;
  IF FOUND THEN
    IF definition.seeded_by = actor AND definition.source_template_id = p_template_id
       AND definition.source_template_updated_at = p_expected_template_updated_at
       AND definition.source_structure_sha256 = p_expected_structure_sha256
       AND definition.seed_operation_id = p_operation_id
       AND definition.seed_request_sha256 = p_request_sha256 THEN
      RETURN survey_private.document_survey_definition_receipt(p_document_id);
    END IF;
    RAISE EXCEPTION 'Document Survey definition already exists' USING ERRCODE = '23505';
  END IF;

  SELECT t.user_id, t.updated_at, t.config, t.archived, t.user_archived_at
    INTO template_owner, template_updated_at, template_config,
      template_archived, template_user_archived_at
    FROM public.templates t WHERE t.id = p_template_id FOR SHARE;
  IF template_owner IS DISTINCT FROM actor OR template_updated_at IS NULL
     OR template_archived IS DISTINCT FROM false OR template_user_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Template Survey adoption source is not permitted' USING ERRCODE = '42501';
  END IF;
  modules := survey_private.normalize_document_template_survey(template_config);
  structure_sha256 := survey_private.document_survey_structure_digest(modules);
  IF template_updated_at IS DISTINCT FROM p_expected_template_updated_at
     OR structure_sha256 IS DISTINCT FROM p_expected_structure_sha256 THEN
    RAISE EXCEPTION 'Template Survey adoption preview is stale' USING ERRCODE = '40001';
  END IF;

  INSERT INTO survey_private.document_survey_definitions(document_id, source_template_id,
    source_template_updated_at, source_structure_sha256, seed_operation_id,
    seed_request_sha256, modules, seeded_by)
  VALUES (p_document_id, p_template_id, template_updated_at, structure_sha256,
    p_operation_id, p_request_sha256, modules, actor);
  RETURN survey_private.document_survey_definition_receipt(p_document_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.read_document_survey_definition(p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE receipt jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.user_can_access_document(p_document_id, 'viewer') IS NOT TRUE THEN
    RAISE EXCEPTION 'Document Survey definition is not available' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM survey_private.account_write_guards g
      WHERE g.closing AND g.user_id IN (auth.uid(),
        (SELECT d.user_id FROM public.documents d WHERE d.id = p_document_id))) THEN
    RAISE EXCEPTION 'Document Survey definition is not available' USING ERRCODE = '42501';
  END IF;
  receipt := survey_private.document_survey_definition_receipt(p_document_id);
  RETURN coalesce(receipt, jsonb_build_object('status', 'unadopted', 'version', 1,
    'documentId', p_document_id));
END;
$$;

ALTER FUNCTION survey_private.document_survey_whitespace() OWNER TO postgres;
ALTER FUNCTION survey_private.document_survey_utf16_length(text) OWNER TO postgres;
ALTER FUNCTION survey_private.document_survey_utf16_left(text,integer) OWNER TO postgres;
ALTER FUNCTION survey_private.document_survey_owned_text(text,integer) OWNER TO postgres;
ALTER FUNCTION survey_private.document_survey_timestamp(text) OWNER TO postgres;
ALTER FUNCTION survey_private.document_survey_module_data_key(text) OWNER TO postgres;
ALTER FUNCTION survey_private.document_survey_display_key(text) OWNER TO postgres;
ALTER FUNCTION survey_private.document_survey_sheet_key(text,text) OWNER TO postgres;
ALTER FUNCTION survey_private.normalize_document_survey_checklist(jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.normalize_document_survey_categories(jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.normalize_document_survey_modules_array(jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.normalize_document_template_survey(jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.document_survey_structure_digest(jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.document_survey_definition_receipt(uuid) OWNER TO postgres;
ALTER FUNCTION public.preview_document_survey_definition_adoption(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.adopt_document_survey_definition(uuid,uuid,timestamptz,text,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.read_document_survey_definition(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION survey_private.document_survey_whitespace(),
  survey_private.document_survey_utf16_length(text),
  survey_private.document_survey_utf16_left(text,integer),
  survey_private.document_survey_owned_text(text,integer),
  survey_private.document_survey_timestamp(text),
  survey_private.document_survey_module_data_key(text),
  survey_private.document_survey_display_key(text),
  survey_private.document_survey_sheet_key(text,text),
  survey_private.normalize_document_survey_checklist(jsonb),
  survey_private.normalize_document_survey_categories(jsonb),
  survey_private.normalize_document_survey_modules_array(jsonb),
  survey_private.normalize_document_template_survey(jsonb),
  survey_private.document_survey_structure_digest(jsonb),
  survey_private.document_survey_definition_receipt(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.preview_document_survey_definition_adoption(uuid,uuid),
  public.adopt_document_survey_definition(uuid,uuid,timestamptz,text,uuid,text),
  public.read_document_survey_definition(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_document_survey_definition_adoption(uuid,uuid),
  public.adopt_document_survey_definition(uuid,uuid,timestamptz,text,uuid,text),
  public.read_document_survey_definition(uuid) TO authenticated;

COMMIT;
