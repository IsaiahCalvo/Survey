-- Append-only combined Survey/Entity definition revisions. Existing revision-1
-- accessors stay unchanged; new callers opt into this history contract.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE survey_private.document_definition_revisions (
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  definition_revision bigint NOT NULL
    CHECK (definition_revision BETWEEN 1 AND 9007199254740991),
  definition_digest text NOT NULL CHECK (definition_digest ~ '^[0-9a-f]{64}$'),
  survey_source jsonb NOT NULL CHECK (jsonb_typeof(survey_source) = 'object'),
  modules jsonb NOT NULL CHECK (jsonb_typeof(modules) = 'array'),
  entity_source jsonb NOT NULL CHECK (jsonb_typeof(entity_source) = 'object'),
  entities jsonb NOT NULL CHECK (jsonb_typeof(entities) = 'array'),
  archived_semantic_ids jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(archived_semantic_ids) = 'array'),
  operation_id uuid,
  request_sha256 text CHECK (request_sha256 IS NULL OR request_sha256 ~ '^[0-9a-f]{64}$'),
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (document_id, definition_revision),
  UNIQUE (document_id, definition_revision, definition_digest),
  CHECK ((operation_id IS NULL) = (request_sha256 IS NULL))
);

CREATE UNIQUE INDEX document_definition_revisions_operation_idx
  ON survey_private.document_definition_revisions(document_id, operation_id)
  WHERE operation_id IS NOT NULL;

CREATE TABLE survey_private.document_definition_revision_heads (
  document_id uuid PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE,
  current_revision bigint NOT NULL
    CHECK (current_revision BETWEEN 1 AND 9007199254740991),
  current_digest text NOT NULL CHECK (current_digest ~ '^[0-9a-f]{64}$'),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (document_id, current_revision, current_digest)
    REFERENCES survey_private.document_definition_revisions(
      document_id, definition_revision, definition_digest)
    DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE survey_private.document_definition_revisions OWNER TO postgres;
ALTER TABLE survey_private.document_definition_revision_heads OWNER TO postgres;
ALTER TABLE survey_private.document_definition_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_private.document_definition_revision_heads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_definition_revisions,
  survey_private.document_definition_revision_heads
  FROM PUBLIC, anon, authenticated, service_role;

-- Byte-for-byte counterpart of the shared JS stable serializer for the strict
-- document-definition shapes. Their object keys are fixed ASCII schema keys;
-- number output is normalized through PostgreSQL's shortest float8 form.
CREATE OR REPLACE FUNCTION survey_private.document_definition_stable_json(p_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = ''
  SET extra_float_digits = '3' AS $$
DECLARE
  result text;
  number_value double precision;
BEGIN
  CASE jsonb_typeof(p_value)
    WHEN 'object' THEN
      SELECT '{' || coalesce(string_agg(to_jsonb(entry.key)::text || ':' ||
        survey_private.document_definition_stable_json(entry.value), ','
        ORDER BY entry.key COLLATE "C"), '') || '}'
        INTO result FROM jsonb_each(p_value) entry;
      RETURN result;
    WHEN 'array' THEN
      SELECT '[' || coalesce(string_agg(
        survey_private.document_definition_stable_json(entry.value), ','
        ORDER BY entry.ordinal), '') || ']'
        INTO result FROM jsonb_array_elements(p_value) WITH ORDINALITY entry(value, ordinal);
      RETURN result;
    WHEN 'number' THEN
      number_value := (p_value #>> '{}')::double precision;
      IF number_value <> 0 AND abs(number_value) < 0.000001 THEN
        result := number_value::text;
      ELSE
        result := to_jsonb(number_value)::text;
      END IF;
      RETURN regexp_replace(result, 'e([+-])0+([0-9]+)$', 'e\1\2');
    ELSE
      RETURN p_value::text;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.document_definition_combined_digest(
  p_document_id uuid,
  p_definition_revision bigint,
  p_survey_source jsonb,
  p_modules jsonb,
  p_entity_source jsonb,
  p_entities jsonb,
  p_archived_semantic_ids jsonb)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT encode(extensions.digest(convert_to(
    survey_private.document_definition_stable_json(jsonb_build_object(
    'version', 1,
    'documentId', p_document_id,
    'definitionRevision', p_definition_revision,
    'surveyDefinition', jsonb_build_object('source', p_survey_source, 'modules', p_modules),
    'entityCatalog', jsonb_build_object('source', p_entity_source, 'entities', p_entities),
    'archivedSemanticIds', p_archived_semantic_ids
  )), 'UTF8'), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION survey_private.document_definition_upgrade_request_digest(
  p_actor_id uuid,
  p_document_id uuid,
  p_expected_current_revision bigint,
  p_expected_current_digest text,
  p_survey_template_id uuid,
  p_expected_survey_template_updated_at timestamptz,
  p_expected_survey_structure_sha256 text,
  p_entity_template_id uuid,
  p_expected_entity_template_updated_at timestamptz,
  p_expected_entity_entities_sha256 text,
  p_archived_semantic_ids jsonb,
  p_operation_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' SET TimeZone = 'UTC' AS $$
  SELECT encode(extensions.digest(convert_to(
    survey_private.document_definition_stable_json(jsonb_build_object(
    'version', 1,
    'actorId', p_actor_id,
    'documentId', p_document_id,
    'expectedCurrentRevision', p_expected_current_revision,
    'expectedCurrentDigest', p_expected_current_digest,
    'surveyTemplateId', p_survey_template_id,
    'expectedSurveyTemplateUpdatedAt', p_expected_survey_template_updated_at,
    'expectedSurveyStructureSha256', p_expected_survey_structure_sha256,
    'entityTemplateId', p_entity_template_id,
    'expectedEntityTemplateUpdatedAt', p_expected_entity_template_updated_at,
    'expectedEntityEntitiesSha256', p_expected_entity_entities_sha256,
    'archivedSemanticIds', p_archived_semantic_ids,
    'operationId', p_operation_id
  )), 'UTF8'), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION survey_private.document_definition_semantic_map(
  p_modules jsonb, p_entities jsonb)
RETURNS TABLE(kind text, semantic_id text, parent_id text)
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT 'module'::text, module->>'id', NULL::text
    FROM jsonb_array_elements(p_modules) module
  UNION ALL
  SELECT 'category'::text, category->>'id', module->>'id'
    FROM jsonb_array_elements(p_modules) module
    CROSS JOIN LATERAL jsonb_array_elements(module->'categories') category
  UNION ALL
  SELECT 'checklistItem'::text, item->>'id', category->>'id'
    FROM jsonb_array_elements(p_modules) module
    CROSS JOIN LATERAL jsonb_array_elements(module->'categories') category
    CROSS JOIN LATERAL jsonb_array_elements(category->'checklist') item
  UNION ALL
  SELECT 'entity'::text, entity->>'id', NULL::text
    FROM jsonb_array_elements(p_entities) entity
$$;

CREATE OR REPLACE FUNCTION survey_private.document_definition_revision_receipt(
  p_document_id uuid, p_definition_revision bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
  SELECT jsonb_build_object(
    'status', 'accepted',
    'version', 1,
    'documentId', r.document_id,
    'definitionRevision', r.definition_revision,
    'definitionDigest', r.definition_digest,
    'surveyDefinition', jsonb_build_object('source', r.survey_source, 'modules', r.modules),
    'entityCatalog', jsonb_build_object('source', r.entity_source, 'entities', r.entities),
    'archivedSemanticIds', r.archived_semantic_ids,
    'review', jsonb_build_object('reviewedAt', r.reviewed_at,
      'operationId', r.operation_id, 'requestSha256', r.request_sha256))
  FROM survey_private.document_definition_revisions r
  WHERE r.document_id = p_document_id
    AND r.definition_revision = coalesce(p_definition_revision,
      (SELECT h.current_revision
       FROM survey_private.document_definition_revision_heads h
       WHERE h.document_id = p_document_id))
$$;

CREATE OR REPLACE FUNCTION survey_private.seed_document_definition_revision(
  p_document_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  survey_row survey_private.document_survey_definitions%ROWTYPE;
  catalog_row survey_private.document_entity_catalogs%ROWTYPE;
  document_owner uuid;
  entity_values jsonb;
  survey_source jsonb;
  entity_source jsonb;
  digest text;
BEGIN
  IF EXISTS (SELECT 1 FROM survey_private.document_definition_revision_heads h
      WHERE h.document_id = p_document_id) THEN
    RETURN true;
  END IF;
  SELECT d.user_id INTO document_owner FROM public.documents d WHERE d.id = p_document_id;
  SELECT * INTO survey_row FROM survey_private.document_survey_definitions d
    WHERE d.document_id = p_document_id;
  SELECT * INTO catalog_row FROM survey_private.document_entity_catalogs c
    WHERE c.document_id = p_document_id;
  IF document_owner IS NULL OR survey_row.document_id IS NULL OR catalog_row.document_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', e.entity_id, 'name', e.name, 'color', e.color,
      'opacity', e.opacity, 'borderColor', e.border_color,
      'borderOpacity', e.border_opacity, 'matchFill', e.match_fill)
      ORDER BY e.ordinal), '[]'::jsonb)
    INTO entity_values
    FROM survey_private.document_entity_definitions e
    WHERE e.document_id = p_document_id;
  survey_source := jsonb_build_object(
    'templateId', survey_row.source_template_id,
    'templateUpdatedAt', survey_row.source_template_updated_at,
    'structureSha256', survey_row.source_structure_sha256);
  entity_source := jsonb_build_object(
    'templateId', catalog_row.source_template_id,
    'templateUpdatedAt', catalog_row.source_template_updated_at,
    'entitiesSha256', catalog_row.source_entities_sha256);
  digest := survey_private.document_definition_combined_digest(
    p_document_id, 1, survey_source, survey_row.modules,
    entity_source, entity_values, '[]'::jsonb);
  INSERT INTO survey_private.document_definition_revisions(
    document_id, definition_revision, definition_digest,
    survey_source, modules, entity_source, entities, archived_semantic_ids,
    reviewed_by, reviewed_at)
  VALUES (p_document_id, 1, digest, survey_source, survey_row.modules,
    entity_source, entity_values, '[]'::jsonb, document_owner,
    greatest(survey_row.seeded_at, catalog_row.seeded_at))
  ON CONFLICT (document_id, definition_revision) DO NOTHING;
  INSERT INTO survey_private.document_definition_revision_heads(
    document_id, current_revision, current_digest, updated_by, updated_at)
  VALUES (p_document_id, 1, digest, document_owner,
    greatest(survey_row.seeded_at, catalog_row.seeded_at))
  ON CONFLICT (document_id) DO NOTHING;
  RETURN EXISTS (SELECT 1 FROM survey_private.document_definition_revision_heads h
    WHERE h.document_id = p_document_id);
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.seed_document_definition_revision_trigger()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'documents' THEN
    PERFORM survey_private.seed_document_definition_revision(NEW.id);
  ELSE
    PERFORM survey_private.seed_document_definition_revision(NEW.document_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER seed_document_definition_revision_after_survey
AFTER INSERT ON survey_private.document_survey_definitions
FOR EACH ROW EXECUTE FUNCTION survey_private.seed_document_definition_revision_trigger();

-- Entity adoption updates documents.template_id only after all normalized Entity
-- rows exist, so this is the safe completion edge for the other adoption order.
CREATE TRIGGER seed_document_definition_revision_after_entity
AFTER UPDATE OF template_id ON public.documents
FOR EACH ROW EXECUTE FUNCTION survey_private.seed_document_definition_revision_trigger();

DO $$
DECLARE candidate record;
BEGIN
  FOR candidate IN
    SELECT s.document_id FROM survey_private.document_survey_definitions s
    INNER JOIN survey_private.document_entity_catalogs c USING (document_id)
    ORDER BY s.document_id
  LOOP
    PERFORM survey_private.seed_document_definition_revision(candidate.document_id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.preview_document_definition_revision_upgrade(
  p_document_id uuid,
  p_survey_template_id uuid,
  p_entity_template_id uuid,
  p_archived_semantic_ids jsonb,
  p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  actor uuid := auth.uid();
  document_row public.documents%ROWTYPE;
  head survey_private.document_definition_revision_heads%ROWTYPE;
  current_row survey_private.document_definition_revisions%ROWTYPE;
  survey_owner uuid;
  survey_updated_at timestamptz;
  survey_config jsonb;
  survey_archived boolean;
  survey_user_archived_at timestamptz;
  entity_owner uuid;
  entity_updated_at timestamptz;
  entity_config jsonb;
  entity_archived boolean;
  entity_user_archived_at timestamptz;
  modules jsonb;
  entities jsonb;
  request_sha256 text;
  archive_value jsonb;
BEGIN
  IF p_archived_semantic_ids IS NULL OR jsonb_typeof(p_archived_semantic_ids) <> 'array'
     OR jsonb_array_length(p_archived_semantic_ids) > 10304
     OR octet_length(p_archived_semantic_ids::text) > 1048576
     OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'Document definition upgrade preview is invalid' USING ERRCODE = '22023';
  END IF;
  SELECT d.* INTO document_row FROM public.documents d WHERE d.id = p_document_id;
  IF actor IS NULL OR NOT FOUND OR document_row.user_id IS DISTINCT FROM actor
     OR document_row.archived IS DISTINCT FROM false OR document_row.user_archived_at IS NOT NULL
     OR public.kal49_document_is_locked(p_document_id) THEN
    RAISE EXCEPTION 'Document definition upgrade is not permitted' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM survey_private.account_write_guards g
      WHERE g.user_id = actor AND g.closing) THEN
    RAISE EXCEPTION 'Document definition upgrade is not permitted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO head FROM survey_private.document_definition_revision_heads h
    WHERE h.document_id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document definition revision is not ready' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO current_row FROM survey_private.document_definition_revisions r
    WHERE r.document_id = p_document_id AND r.definition_revision = head.current_revision;
  SELECT t.user_id, t.updated_at, t.config, t.archived, t.user_archived_at
    INTO survey_owner, survey_updated_at, survey_config, survey_archived, survey_user_archived_at
    FROM public.templates t WHERE t.id = p_survey_template_id;
  SELECT t.user_id, t.updated_at, t.config, t.archived, t.user_archived_at
    INTO entity_owner, entity_updated_at, entity_config, entity_archived, entity_user_archived_at
    FROM public.templates t WHERE t.id = p_entity_template_id;
  IF survey_owner IS DISTINCT FROM actor OR entity_owner IS DISTINCT FROM actor
     OR survey_updated_at IS NULL OR entity_updated_at IS NULL
     OR survey_archived IS DISTINCT FROM false OR entity_archived IS DISTINCT FROM false
     OR survey_user_archived_at IS NOT NULL OR entity_user_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Document definition upgrade source is not permitted' USING ERRCODE = '42501';
  END IF;
  modules := survey_private.normalize_document_template_survey(survey_config);
  entities := survey_private.normalize_document_template_entities(entity_config);
  FOR archive_value IN SELECT value FROM jsonb_array_elements(p_archived_semantic_ids)
  LOOP
    IF jsonb_typeof(archive_value) <> 'object'
       OR (archive_value - ARRAY['kind','id']::text[]) <> '{}'::jsonb
       OR jsonb_typeof(archive_value->'kind') <> 'string'
       OR jsonb_typeof(archive_value->'id') <> 'string'
       OR archive_value->>'kind' NOT IN ('module','category','checklistItem','entity')
       OR length(archive_value->>'id') NOT BETWEEN 1 AND 128
       OR NOT EXISTS (SELECT 1
         FROM survey_private.document_definition_semantic_map(
           current_row.modules, current_row.entities) s
         WHERE s.kind = archive_value->>'kind' AND s.semantic_id = archive_value->>'id')
       OR NOT EXISTS (SELECT 1
         FROM survey_private.document_definition_semantic_map(modules, entities) s
         WHERE s.kind = archive_value->>'kind' AND s.semantic_id = archive_value->>'id') THEN
      RAISE EXCEPTION 'Document definition archive identity is invalid' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  request_sha256 := survey_private.document_definition_upgrade_request_digest(
    actor, p_document_id, head.current_revision, head.current_digest,
    p_survey_template_id, survey_updated_at,
    survey_private.document_survey_structure_digest(modules),
    p_entity_template_id, entity_updated_at,
    survey_private.document_entity_digest(entities),
    p_archived_semantic_ids, p_operation_id);
  RETURN jsonb_build_object(
    'status', 'preview', 'version', 1, 'documentId', p_document_id,
    'current', jsonb_build_object('definitionRevision', head.current_revision,
      'definitionDigest', head.current_digest),
    'surveyDefinition', jsonb_build_object('source', jsonb_build_object(
      'templateId', p_survey_template_id, 'templateUpdatedAt', survey_updated_at,
      'structureSha256', survey_private.document_survey_structure_digest(modules)),
      'modules', modules),
    'entityCatalog', jsonb_build_object('source', jsonb_build_object(
      'templateId', p_entity_template_id, 'templateUpdatedAt', entity_updated_at,
      'entitiesSha256', survey_private.document_entity_digest(entities)),
      'entities', entities),
    'review', jsonb_build_object('operationId', p_operation_id,
      'requestSha256', request_sha256,
      'archivedSemanticIds', p_archived_semantic_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_reviewed_document_definition_revision(
  p_document_id uuid,
  p_expected_current_revision bigint,
  p_expected_current_digest text,
  p_survey_template_id uuid,
  p_expected_survey_template_updated_at timestamptz,
  p_expected_survey_structure_sha256 text,
  p_entity_template_id uuid,
  p_expected_entity_template_updated_at timestamptz,
  p_expected_entity_entities_sha256 text,
  p_archived_semantic_ids jsonb,
  p_operation_id uuid,
  p_request_sha256 text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC'
  SET lock_timeout = '2s' SET statement_timeout = '30s' AS $$
DECLARE
  actor uuid := auth.uid();
  document_row public.documents%ROWTYPE;
  head survey_private.document_definition_revision_heads%ROWTYPE;
  current_row survey_private.document_definition_revisions%ROWTYPE;
  replay survey_private.document_definition_revisions%ROWTYPE;
  survey_owner uuid;
  survey_updated_at timestamptz;
  survey_config jsonb;
  survey_archived boolean;
  survey_user_archived_at timestamptz;
  entity_owner uuid;
  entity_updated_at timestamptz;
  entity_config jsonb;
  entity_archived boolean;
  entity_user_archived_at timestamptz;
  modules jsonb;
  entities jsonb;
  survey_sha256 text;
  entity_sha256 text;
  request_sha256 text;
  next_revision bigint;
  next_digest text;
  combined_archives jsonb;
  archive_value jsonb;
  old_semantic record;
  next_parent text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Document definition upgrade requires READ COMMITTED' USING ERRCODE = '25001';
  END IF;
  IF actor IS NULL OR p_document_id IS NULL OR p_expected_current_revision IS NULL
     OR p_expected_current_revision NOT BETWEEN 1 AND 9007199254740991
     OR p_expected_current_digest !~ '^[0-9a-f]{64}$'
     OR p_survey_template_id IS NULL OR p_expected_survey_template_updated_at IS NULL
     OR p_expected_survey_structure_sha256 !~ '^[0-9a-f]{64}$'
     OR p_entity_template_id IS NULL OR p_expected_entity_template_updated_at IS NULL
     OR p_expected_entity_entities_sha256 !~ '^[0-9a-f]{64}$'
     OR p_archived_semantic_ids IS NULL OR jsonb_typeof(p_archived_semantic_ids) <> 'array'
     OR jsonb_array_length(p_archived_semantic_ids) > 10304
     OR octet_length(p_archived_semantic_ids::text) > 1048576
     OR p_operation_id IS NULL OR p_request_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Document definition upgrade request is invalid' USING ERRCODE = '22023';
  END IF;
  SELECT d.* INTO document_row FROM public.documents d
    WHERE d.id = p_document_id FOR UPDATE;
  IF NOT FOUND OR document_row.user_id IS DISTINCT FROM actor
     OR document_row.archived IS DISTINCT FROM false OR document_row.user_archived_at IS NOT NULL
     OR public.kal49_document_is_locked(p_document_id) THEN
    RAISE EXCEPTION 'Document definition upgrade is not permitted' USING ERRCODE = '42501';
  END IF;
  PERFORM survey_private.assert_account_open(actor);
  request_sha256 := survey_private.document_definition_upgrade_request_digest(
    actor, p_document_id, p_expected_current_revision, p_expected_current_digest,
    p_survey_template_id, p_expected_survey_template_updated_at,
    p_expected_survey_structure_sha256, p_entity_template_id,
    p_expected_entity_template_updated_at, p_expected_entity_entities_sha256,
    p_archived_semantic_ids, p_operation_id);
  IF request_sha256 IS DISTINCT FROM p_request_sha256 THEN
    RAISE EXCEPTION 'Document definition upgrade review proof changed' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO replay FROM survey_private.document_definition_revisions r
    WHERE r.document_id = p_document_id AND r.operation_id = p_operation_id;
  IF FOUND THEN
    IF replay.reviewed_by = actor AND replay.request_sha256 = p_request_sha256 THEN
      RETURN survey_private.document_definition_revision_receipt(
        p_document_id, replay.definition_revision);
    END IF;
    RAISE EXCEPTION 'Document definition upgrade operation conflicts' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO head FROM survey_private.document_definition_revision_heads h
    WHERE h.document_id = p_document_id FOR UPDATE;
  IF NOT FOUND OR head.current_revision IS DISTINCT FROM p_expected_current_revision
     OR head.current_digest IS DISTINCT FROM p_expected_current_digest THEN
    RAISE EXCEPTION 'Document definition upgrade review is stale' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO current_row FROM survey_private.document_definition_revisions r
    WHERE r.document_id = p_document_id AND r.definition_revision = head.current_revision;

  -- Lock both sources in UUID order so two upgrade requests cannot invert lock order.
  PERFORM 1 FROM public.templates t
    WHERE t.id IN (p_survey_template_id, p_entity_template_id)
    ORDER BY t.id FOR SHARE;
  SELECT t.user_id, t.updated_at, t.config, t.archived, t.user_archived_at
    INTO survey_owner, survey_updated_at, survey_config, survey_archived, survey_user_archived_at
    FROM public.templates t WHERE t.id = p_survey_template_id;
  SELECT t.user_id, t.updated_at, t.config, t.archived, t.user_archived_at
    INTO entity_owner, entity_updated_at, entity_config, entity_archived, entity_user_archived_at
    FROM public.templates t WHERE t.id = p_entity_template_id;
  IF survey_owner IS DISTINCT FROM actor OR entity_owner IS DISTINCT FROM actor
     OR survey_updated_at IS NULL OR entity_updated_at IS NULL
     OR survey_archived IS DISTINCT FROM false OR entity_archived IS DISTINCT FROM false
     OR survey_user_archived_at IS NOT NULL OR entity_user_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Document definition upgrade source is not permitted' USING ERRCODE = '42501';
  END IF;
  modules := survey_private.normalize_document_template_survey(survey_config);
  entities := survey_private.normalize_document_template_entities(entity_config);
  survey_sha256 := survey_private.document_survey_structure_digest(modules);
  entity_sha256 := survey_private.document_entity_digest(entities);
  IF survey_updated_at IS DISTINCT FROM p_expected_survey_template_updated_at
     OR entity_updated_at IS DISTINCT FROM p_expected_entity_template_updated_at
     OR survey_sha256 IS DISTINCT FROM p_expected_survey_structure_sha256
     OR entity_sha256 IS DISTINCT FROM p_expected_entity_entities_sha256 THEN
    RAISE EXCEPTION 'Document definition upgrade source changed after review' USING ERRCODE = '40001';
  END IF;
  FOR old_semantic IN
    SELECT * FROM survey_private.document_definition_semantic_map(
      current_row.modules, current_row.entities)
  LOOP
    SELECT n.parent_id INTO next_parent
      FROM survey_private.document_definition_semantic_map(modules, entities) n
      WHERE n.kind = old_semantic.kind AND n.semantic_id = old_semantic.semantic_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DOCUMENT_DEFINITION_SEMANTIC_ID_REMOVED'
        USING ERRCODE = '23514';
    END IF;
    IF next_parent IS DISTINCT FROM old_semantic.parent_id THEN
      RAISE EXCEPTION 'DOCUMENT_DEFINITION_SEMANTIC_ID_REUSED'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  FOR archive_value IN SELECT value FROM jsonb_array_elements(p_archived_semantic_ids)
  LOOP
    IF jsonb_typeof(archive_value) <> 'object'
       OR (archive_value - ARRAY['kind','id']::text[]) <> '{}'::jsonb
       OR jsonb_typeof(archive_value->'kind') <> 'string'
       OR jsonb_typeof(archive_value->'id') <> 'string'
       OR archive_value->>'kind' NOT IN ('module','category','checklistItem','entity')
       OR length(archive_value->>'id') NOT BETWEEN 1 AND 128
       OR NOT EXISTS (SELECT 1
         FROM survey_private.document_definition_semantic_map(
           current_row.modules, current_row.entities) s
         WHERE s.kind = archive_value->>'kind' AND s.semantic_id = archive_value->>'id')
       OR NOT EXISTS (SELECT 1
         FROM survey_private.document_definition_semantic_map(modules, entities) s
         WHERE s.kind = archive_value->>'kind' AND s.semantic_id = archive_value->>'id') THEN
      RAISE EXCEPTION 'Document definition archive identity is invalid' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'kind', value->>'id'), '[]'::jsonb)
    INTO combined_archives
    FROM (SELECT DISTINCT ON (value->>'kind', value->>'id') value
      FROM jsonb_array_elements(current_row.archived_semantic_ids || p_archived_semantic_ids)
      ORDER BY value->>'kind', value->>'id') archived;

  IF head.current_revision >= 9007199254740991 THEN
    RAISE EXCEPTION 'Document definition revision limit reached' USING ERRCODE = '54000';
  END IF;
  next_revision := head.current_revision + 1;
  next_digest := survey_private.document_definition_combined_digest(
    p_document_id, next_revision,
    jsonb_build_object('templateId', p_survey_template_id,
      'templateUpdatedAt', survey_updated_at, 'structureSha256', survey_sha256),
    modules,
    jsonb_build_object('templateId', p_entity_template_id,
      'templateUpdatedAt', entity_updated_at, 'entitiesSha256', entity_sha256),
    entities, combined_archives);
  INSERT INTO survey_private.document_definition_revisions(
    document_id, definition_revision, definition_digest,
    survey_source, modules, entity_source, entities, archived_semantic_ids,
    operation_id, request_sha256, reviewed_by)
  VALUES (p_document_id, next_revision, next_digest,
    jsonb_build_object('templateId', p_survey_template_id,
      'templateUpdatedAt', survey_updated_at, 'structureSha256', survey_sha256),
    modules,
    jsonb_build_object('templateId', p_entity_template_id,
      'templateUpdatedAt', entity_updated_at, 'entitiesSha256', entity_sha256),
    entities, combined_archives, p_operation_id, p_request_sha256, actor);
  UPDATE survey_private.document_definition_revision_heads
    SET current_revision = next_revision, current_digest = next_digest,
      updated_by = actor, updated_at = clock_timestamp()
    WHERE document_id = p_document_id
      AND current_revision = p_expected_current_revision
      AND current_digest = p_expected_current_digest;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document definition upgrade review is stale' USING ERRCODE = '40001';
  END IF;
  RETURN survey_private.document_definition_revision_receipt(p_document_id, next_revision);
END;
$$;

CREATE OR REPLACE FUNCTION public.read_document_definition_revision(
  p_document_id uuid, p_definition_revision bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE receipt jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR public.user_can_access_document(p_document_id, 'viewer') IS NOT TRUE THEN
    RAISE EXCEPTION 'Document definition revision is not available' USING ERRCODE = '42501';
  END IF;
  IF p_definition_revision IS NOT NULL
     AND p_definition_revision NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION 'Document definition revision is invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM survey_private.account_write_guards g
      WHERE g.closing AND g.user_id IN (auth.uid(),
        (SELECT d.user_id FROM public.documents d WHERE d.id = p_document_id))) THEN
    RAISE EXCEPTION 'Document definition revision is not available' USING ERRCODE = '42501';
  END IF;
  receipt := survey_private.document_definition_revision_receipt(
    p_document_id, p_definition_revision);
  IF receipt IS NULL THEN
    RAISE EXCEPTION 'Document definition revision is not available' USING ERRCODE = 'P0002';
  END IF;
  RETURN receipt;
END;
$$;

ALTER FUNCTION survey_private.document_definition_stable_json(jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.document_definition_combined_digest(uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.document_definition_upgrade_request_digest(uuid,uuid,bigint,text,uuid,timestamptz,text,uuid,timestamptz,text,jsonb,uuid) OWNER TO postgres;
ALTER FUNCTION survey_private.document_definition_semantic_map(jsonb,jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.document_definition_revision_receipt(uuid,bigint) OWNER TO postgres;
ALTER FUNCTION survey_private.seed_document_definition_revision(uuid) OWNER TO postgres;
ALTER FUNCTION survey_private.seed_document_definition_revision_trigger() OWNER TO postgres;
ALTER FUNCTION public.preview_document_definition_revision_upgrade(uuid,uuid,uuid,jsonb,uuid) OWNER TO postgres;
ALTER FUNCTION public.apply_reviewed_document_definition_revision(uuid,bigint,text,uuid,timestamptz,text,uuid,timestamptz,text,jsonb,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.read_document_definition_revision(uuid,bigint) OWNER TO postgres;

REVOKE ALL ON FUNCTION
  survey_private.document_definition_stable_json(jsonb),
  survey_private.document_definition_combined_digest(uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb),
  survey_private.document_definition_upgrade_request_digest(uuid,uuid,bigint,text,uuid,timestamptz,text,uuid,timestamptz,text,jsonb,uuid),
  survey_private.document_definition_semantic_map(jsonb,jsonb),
  survey_private.document_definition_revision_receipt(uuid,bigint),
  survey_private.seed_document_definition_revision(uuid),
  survey_private.seed_document_definition_revision_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.preview_document_definition_revision_upgrade(uuid,uuid,uuid,jsonb,uuid),
  public.apply_reviewed_document_definition_revision(uuid,bigint,text,uuid,timestamptz,text,uuid,timestamptz,text,jsonb,uuid,text),
  public.read_document_definition_revision(uuid,bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.preview_document_definition_revision_upgrade(uuid,uuid,uuid,jsonb,uuid),
  public.apply_reviewed_document_definition_revision(uuid,bigint,text,uuid,timestamptz,text,uuid,timestamptz,text,jsonb,uuid,text),
  public.read_document_definition_revision(uuid,bigint)
  TO authenticated;

COMMIT;
