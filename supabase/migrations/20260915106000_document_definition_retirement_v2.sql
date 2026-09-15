-- Explicit semantic retirement for reviewed document-definition revisions.
-- V1 stays wire-compatible; both apply RPCs use one private publisher.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION survey_private.document_definition_semantic_nodes(
  p_modules jsonb, p_entities jsonb)
RETURNS TABLE(kind text, semantic_id text, parent_id text, label text,
  node jsonb, sort_key text)
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT 'module', m.value->>'id', NULL::text, m.value->>'name', m.value,
    'm/' || lpad(m.ordinal::text, 6, '0')
  FROM jsonb_array_elements(p_modules) WITH ORDINALITY m(value, ordinal)
  UNION ALL
  SELECT 'category', c.value->>'id', m.value->>'id', c.value->>'name', c.value,
    'm/' || lpad(m.ordinal::text, 6, '0') || '/c/' || lpad(c.ordinal::text, 6, '0')
  FROM jsonb_array_elements(p_modules) WITH ORDINALITY m(value, ordinal)
  CROSS JOIN LATERAL jsonb_array_elements(m.value->'categories')
    WITH ORDINALITY c(value, ordinal)
  UNION ALL
  SELECT 'checklistItem', i.value->>'id', c.value->>'id', i.value->>'text', i.value,
    'm/' || lpad(m.ordinal::text, 6, '0') || '/c/' || lpad(c.ordinal::text, 6, '0')
      || '/i/' || lpad(i.ordinal::text, 6, '0')
  FROM jsonb_array_elements(p_modules) WITH ORDINALITY m(value, ordinal)
  CROSS JOIN LATERAL jsonb_array_elements(m.value->'categories')
    WITH ORDINALITY c(value, ordinal)
  CROSS JOIN LATERAL jsonb_array_elements(c.value->'checklist')
    WITH ORDINALITY i(value, ordinal)
  UNION ALL
  SELECT 'entity', e.value->>'id', NULL::text, e.value->>'name', e.value,
    'z/' || lpad(e.ordinal::text, 6, '0')
  FROM jsonb_array_elements(p_entities) WITH ORDINALITY e(value, ordinal)
$$;

CREATE OR REPLACE FUNCTION survey_private.document_definition_candidate_core(
  p_actor_id uuid, p_document_id uuid, p_survey_template_id uuid,
  p_entity_template_id uuid, p_archived_semantic_ids jsonb,
  p_retired_semantic_roots jsonb, p_version integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone='UTC' AS $$
DECLARE
  head survey_private.document_definition_revision_heads%ROWTYPE;
  current_row survey_private.document_definition_revisions%ROWTYPE;
  template_owner uuid; template_updated_at timestamptz; template_config jsonb;
  template_archived boolean; template_user_archived_at timestamptz;
  survey_source jsonb; entity_source jsonb; modules jsonb; entities jsonb;
  original_modules jsonb; original_entities jsonb; composed jsonb;
  old_index jsonb; candidate_index jsonb; semantic_key text; parent_key text;
  removed_roots jsonb := '[]'::jsonb; auto_roots jsonb := '[]'::jsonb;
  retired_ids jsonb := '[]'::jsonb; auto_archived_ids jsonb := '[]'::jsonb;
  combined_archives jsonb;
  old_node record; candidate_parent text; root_value jsonb; member jsonb;
  root_count integer; requested_count integer;
BEGIN
  PERFORM survey_private.document_definition_validate_choices(
    p_archived_semantic_ids, 'Document definition archive choices');
  PERFORM survey_private.document_definition_validate_choices(
    p_retired_semantic_roots, 'Document definition retirement roots');
  IF p_version NOT IN (0,1,2) OR (p_version IN (0,1) AND
      (p_survey_template_id IS NULL OR p_entity_template_id IS NULL
       OR p_retired_semantic_roots <> '[]'::jsonb)) THEN
    RAISE EXCEPTION 'Document definition candidate is invalid' USING ERRCODE='22023';
  END IF;

  SELECT * INTO head FROM survey_private.document_definition_revision_heads h
    WHERE h.document_id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document definition revision is not ready' USING ERRCODE='23514';
  END IF;
  SELECT * INTO current_row FROM survey_private.document_definition_revisions r
    WHERE r.document_id=p_document_id AND r.definition_revision=head.current_revision;

  IF p_survey_template_id IS NULL THEN
    survey_source := current_row.survey_source;
    modules := current_row.modules;
  ELSE
    SELECT t.user_id,t.updated_at,t.config,t.archived,t.user_archived_at
      INTO template_owner,template_updated_at,template_config,
        template_archived,template_user_archived_at
    FROM public.templates t WHERE t.id=p_survey_template_id;
    IF template_owner IS DISTINCT FROM p_actor_id OR template_updated_at IS NULL
       OR template_archived IS DISTINCT FROM false OR template_user_archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Document definition upgrade source is not permitted' USING ERRCODE='42501';
    END IF;
    modules := survey_private.normalize_document_template_survey(template_config);
    survey_source := jsonb_build_object('templateId',p_survey_template_id,
      'templateUpdatedAt',template_updated_at,
      'structureSha256',survey_private.document_survey_structure_digest(modules));
  END IF;
  IF p_entity_template_id IS NULL THEN
    entity_source := current_row.entity_source;
    entities := current_row.entities;
  ELSE
    SELECT t.user_id,t.updated_at,t.config,t.archived,t.user_archived_at
      INTO template_owner,template_updated_at,template_config,
        template_archived,template_user_archived_at
    FROM public.templates t WHERE t.id=p_entity_template_id;
    IF template_owner IS DISTINCT FROM p_actor_id OR template_updated_at IS NULL
       OR template_archived IS DISTINCT FROM false OR template_user_archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Document definition upgrade source is not permitted' USING ERRCODE='42501';
    END IF;
    entities := survey_private.normalize_document_template_entities(template_config);
    entity_source := jsonb_build_object('templateId',p_entity_template_id,
      'templateUpdatedAt',template_updated_at,
      'entitiesSha256',survey_private.document_entity_digest(entities));
  END IF;
  original_modules := modules; original_entities := entities;
  SELECT coalesce(jsonb_object_agg(n.kind||':'||n.semantic_id,
      jsonb_build_object('parentId',n.parent_id,'node',n.node)),'{}'::jsonb)
    INTO old_index FROM survey_private.document_definition_semantic_nodes(
      current_row.modules,current_row.entities) n;
  SELECT coalesce(jsonb_object_agg(n.kind||':'||n.semantic_id,
      jsonb_build_object('parentId',n.parent_id,'node',n.node)),'{}'::jsonb)
    INTO candidate_index FROM survey_private.document_definition_semantic_nodes(modules,entities) n;

  -- A retained identity may not move to a new old-parent slot.
  FOR old_node IN SELECT * FROM survey_private.document_definition_semantic_nodes(
      current_row.modules,current_row.entities) ORDER BY sort_key LOOP
    semantic_key:=old_node.kind||':'||old_node.semantic_id;
    candidate_parent:=candidate_index->semantic_key->>'parentId';
    IF p_version<>0 AND candidate_index ? semantic_key
       AND candidate_parent IS DISTINCT FROM old_node.parent_id THEN
      RAISE EXCEPTION 'DOCUMENT_DEFINITION_SEMANTIC_ID_REUSED' USING ERRCODE='23514';
    END IF;
  END LOOP;

  -- Only topmost omissions need a decision. Descendants travel with that root.
  FOR old_node IN SELECT * FROM survey_private.document_definition_semantic_nodes(
      current_row.modules,current_row.entities) ORDER BY sort_key LOOP
    semantic_key:=old_node.kind||':'||old_node.semantic_id;
    CONTINUE WHEN candidate_index ? semantic_key;
    parent_key:=CASE old_node.kind WHEN 'category' THEN 'module:'||old_node.parent_id
      WHEN 'checklistItem' THEN 'category:'||old_node.parent_id ELSE NULL END;
    CONTINUE WHEN parent_key IS NOT NULL AND NOT (candidate_index ? parent_key);
    root_value := survey_private.document_definition_root_descriptor(
      current_row.modules,current_row.entities,old_node.kind,old_node.semantic_id);
    IF p_version=2 AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(current_row.archived_semantic_ids) archived
      WHERE (archived->>'kind'=old_node.kind AND archived->>'id'=old_node.semantic_id)
        OR (old_node.kind='category' AND archived->>'kind'='module'
          AND archived->>'id'=old_node.parent_id)
        OR (old_node.kind='checklistItem' AND archived->>'kind'='category'
          AND archived->>'id'=old_node.parent_id)
        OR (old_node.kind='checklistItem' AND archived->>'kind'='module'
          AND archived->>'id'=old_index->('category:'||old_node.parent_id)->>'parentId')
    ) THEN
      auto_roots := auto_roots || jsonb_build_array(root_value);
      composed := survey_private.document_definition_append_subtree(
        modules,entities,old_node.kind,old_node.parent_id,old_node.node);
      modules := composed->'modules'; entities := composed->'entities';
    ELSE
      removed_roots := removed_roots || jsonb_build_array(root_value);
    END IF;
  END LOOP;

  IF p_version = 1 AND jsonb_array_length(removed_roots) > 0 THEN
    RAISE EXCEPTION 'DOCUMENT_DEFINITION_SEMANTIC_ID_REMOVED' USING ERRCODE='23514';
  END IF;
  IF p_version = 2 AND p_retired_semantic_roots <> '[]'::jsonb THEN
    root_count := jsonb_array_length(removed_roots);
    requested_count := jsonb_array_length(p_retired_semantic_roots);
    IF root_count <> requested_count OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_retired_semantic_roots) requested
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(removed_roots) removed
        WHERE removed->>'kind'=requested->>'kind' AND removed->>'id'=requested->>'id')) THEN
      RAISE EXCEPTION 'DOCUMENT_DEFINITION_RETIREMENT_SELECTION_CHANGED' USING ERRCODE='23514';
    END IF;
  ELSIF p_version = 2 AND jsonb_array_length(removed_roots) > 0 THEN
    -- Discovery is read-only and carries no review proof.
    RETURN jsonb_build_object('discovery',true,'headRevision',head.current_revision,
      'headDigest',head.current_digest,'surveySource',survey_source,'modules',modules,
      'entitySource',entity_source,'entities',entities,'removedRoots',removed_roots,
      'autoRetainedRoots',auto_roots);
  END IF;

  -- Approved retirement keeps the exact old canonical subtree in place. The
  -- archive receipt, not deletion or an `archived` node field, records status.
  FOR root_value IN SELECT value FROM jsonb_array_elements(removed_roots)
    WHERE p_version=2 LOOP
    SELECT * INTO old_node FROM survey_private.document_definition_semantic_nodes(
      current_row.modules,current_row.entities) n
    WHERE n.kind=root_value->>'kind' AND n.semantic_id=root_value->>'id';
    composed:=survey_private.document_definition_append_subtree(modules,entities,
      old_node.kind,old_node.parent_id,old_node.node);
    modules:=composed->'modules'; entities:=composed->'entities';
    FOR member IN SELECT value FROM jsonb_array_elements(root_value->'subtree') LOOP
      retired_ids := retired_ids || jsonb_build_array(jsonb_build_object(
        'kind',member->>'kind','id',member->>'id'));
    END LOOP;
  END LOOP;
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'kind' COLLATE "C",value->>'id' COLLATE "C"),'[]'::jsonb)
    INTO retired_ids FROM (SELECT DISTINCT ON (value->>'kind',value->>'id') value
      FROM jsonb_array_elements(retired_ids)
      ORDER BY value->>'kind',value->>'id') unique_retired;

  FOR root_value IN SELECT value FROM jsonb_array_elements(auto_roots) LOOP
    FOR member IN SELECT value FROM jsonb_array_elements(root_value->'subtree') LOOP
      auto_archived_ids:=auto_archived_ids || jsonb_build_array(jsonb_build_object(
        'kind',member->>'kind','id',member->>'id'));
    END LOOP;
  END LOOP;

  SELECT coalesce(jsonb_object_agg(n.kind||':'||n.semantic_id,true),'{}'::jsonb)
    INTO candidate_index FROM survey_private.document_definition_semantic_nodes(modules,entities) n;

  -- Explicit archives must name a retained old identity. Retirement is separate.
  FOR member IN SELECT value FROM jsonb_array_elements(p_archived_semantic_ids) LOOP
    semantic_key:=(member->>'kind')||':'||(member->>'id');
    IF NOT (old_index ? semantic_key) OR NOT (candidate_index ? semantic_key)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(retired_ids) r
          WHERE r->>'kind'=member->>'kind' AND r->>'id'=member->>'id') THEN
      RAISE EXCEPTION 'Document definition archive identity is invalid' USING ERRCODE='23514';
    END IF;
  END LOOP;

  SELECT coalesce(jsonb_agg(value ORDER BY value->>'kind' COLLATE "C",value->>'id' COLLATE "C"),'[]'::jsonb)
    INTO combined_archives
  FROM (SELECT DISTINCT ON (value->>'kind',value->>'id') value
    FROM jsonb_array_elements(current_row.archived_semantic_ids
      || p_archived_semantic_ids || retired_ids || auto_archived_ids)
    ORDER BY value->>'kind',value->>'id') unique_archives;
  IF jsonb_array_length(combined_archives)>10304
     OR octet_length(combined_archives::text)>1048576 THEN
    RAISE EXCEPTION 'Document definition archives exceed their limit' USING ERRCODE='54000';
  END IF;

  -- Re-run the canonical validators after retained subtrees join fresh source rows.
  modules := survey_private.normalize_document_template_survey(
    jsonb_build_object('modules',modules));
  entities := survey_private.normalize_document_template_entities(
    jsonb_build_object('entities',entities));
  RETURN jsonb_build_object('discovery',false,'headRevision',head.current_revision,
    'headDigest',head.current_digest,'surveySource',survey_source,'modules',modules,
    'entitySource',entity_source,'entities',entities,'removedRoots',removed_roots,
    'autoRetainedRoots',auto_roots,'retiredSemanticIds',retired_ids,
    'archivedSemanticIds',combined_archives,
    'sourceModes',jsonb_build_object(
      'survey',CASE WHEN p_survey_template_id IS NULL THEN 'keep' ELSE 'replace' END,
      'entity',CASE WHEN p_entity_template_id IS NULL THEN 'keep' ELSE 'replace' END));
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.preview_document_definition_core(
  p_document_id uuid, p_survey_template_id uuid, p_entity_template_id uuid,
  p_archived_semantic_ids jsonb, p_retired_semantic_roots jsonb,
  p_operation_id uuid, p_version integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE actor uuid:=auth.uid(); document_row public.documents%ROWTYPE;
  candidate jsonb; request_sha256 text;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'Document definition upgrade preview is invalid' USING ERRCODE='22023';
  END IF;
  SELECT d.* INTO document_row FROM public.documents d WHERE d.id=p_document_id;
  IF actor IS NULL OR NOT FOUND OR document_row.user_id IS DISTINCT FROM actor
     OR document_row.archived IS DISTINCT FROM false OR document_row.user_archived_at IS NOT NULL
     OR public.kal49_document_is_locked(p_document_id) THEN
    RAISE EXCEPTION 'Document definition upgrade is not permitted' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM survey_private.account_write_guards g
      WHERE g.user_id=actor AND g.closing) THEN
    RAISE EXCEPTION 'Document definition upgrade is not permitted' USING ERRCODE='42501';
  END IF;
  candidate:=survey_private.document_definition_candidate_core(actor,p_document_id,
    p_survey_template_id,p_entity_template_id,p_archived_semantic_ids,
    p_retired_semantic_roots,p_version);
  IF p_version=2 AND (candidate->>'discovery')::boolean THEN
    RETURN jsonb_build_object('status','retirement-required','version',2,
      'documentId',p_document_id,
      'current',jsonb_build_object('definitionRevision',(candidate->>'headRevision')::bigint,
        'definitionDigest',candidate->>'headDigest'),
      'sourceModes',jsonb_build_object(
        'survey',CASE WHEN p_survey_template_id IS NULL THEN 'keep' ELSE 'replace' END,
        'entity',CASE WHEN p_entity_template_id IS NULL THEN 'keep' ELSE 'replace' END),
      'removedRoots',candidate->'removedRoots',
      'autoRetainedRoots',candidate->'autoRetainedRoots','review',NULL);
  END IF;
  IF p_version IN (0,1) THEN
    request_sha256:=survey_private.document_definition_upgrade_request_digest(
      actor,p_document_id,(candidate->>'headRevision')::bigint,candidate->>'headDigest',
      p_survey_template_id,(candidate->'surveySource'->>'templateUpdatedAt')::timestamptz,
      candidate->'surveySource'->>'structureSha256',p_entity_template_id,
      (candidate->'entitySource'->>'templateUpdatedAt')::timestamptz,
      candidate->'entitySource'->>'entitiesSha256',p_archived_semantic_ids,p_operation_id);
    RETURN jsonb_build_object('status','preview','version',1,'documentId',p_document_id,
      'current',jsonb_build_object('definitionRevision',(candidate->>'headRevision')::bigint,
        'definitionDigest',candidate->>'headDigest'),
      'surveyDefinition',jsonb_build_object('source',candidate->'surveySource',
        'modules',candidate->'modules'),
      'entityCatalog',jsonb_build_object('source',candidate->'entitySource',
        'entities',candidate->'entities'),
      'review',jsonb_build_object('operationId',p_operation_id,
        'requestSha256',request_sha256,'archivedSemanticIds',p_archived_semantic_ids));
  END IF;
  request_sha256:=survey_private.document_definition_retirement_request_digest(
    actor,p_document_id,(candidate->>'headRevision')::bigint,candidate->>'headDigest',
    p_survey_template_id,CASE WHEN p_survey_template_id IS NULL THEN NULL ELSE
      (candidate->'surveySource'->>'templateUpdatedAt')::timestamptz END,
    CASE WHEN p_survey_template_id IS NULL THEN NULL ELSE
      candidate->'surveySource'->>'structureSha256' END,
    p_entity_template_id,CASE WHEN p_entity_template_id IS NULL THEN NULL ELSE
      (candidate->'entitySource'->>'templateUpdatedAt')::timestamptz END,
    CASE WHEN p_entity_template_id IS NULL THEN NULL ELSE
      candidate->'entitySource'->>'entitiesSha256' END,
    p_archived_semantic_ids,p_retired_semantic_roots,p_operation_id);
  RETURN jsonb_build_object('status','preview','version',2,'documentId',p_document_id,
    'current',jsonb_build_object('definitionRevision',(candidate->>'headRevision')::bigint,
      'definitionDigest',candidate->>'headDigest'),
    'sourceModes',candidate->'sourceModes',
    'surveyDefinition',jsonb_build_object('source',candidate->'surveySource',
      'modules',candidate->'modules'),
    'entityCatalog',jsonb_build_object('source',candidate->'entitySource',
      'entities',candidate->'entities'),
    'retirement',jsonb_build_object('requestedRoots',p_retired_semantic_roots,
      'retiredSemanticIds',candidate->'retiredSemanticIds',
      'autoRetainedRoots',candidate->'autoRetainedRoots',
      'archivedSemanticIds',candidate->'archivedSemanticIds'),
    'review',jsonb_build_object('operationId',p_operation_id,
      'requestSha256',request_sha256,'archivedSemanticIds',p_archived_semantic_ids,
      'retiredSemanticRoots',p_retired_semantic_roots));
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.publish_document_definition_revision_core(
  p_document_id uuid,p_expected_current_revision bigint,p_expected_current_digest text,
  p_survey_template_id uuid,p_expected_survey_template_updated_at timestamptz,
  p_expected_survey_structure_sha256 text,p_entity_template_id uuid,
  p_expected_entity_template_updated_at timestamptz,p_expected_entity_entities_sha256 text,
  p_archived_semantic_ids jsonb,p_retired_semantic_roots jsonb,
  p_operation_id uuid,p_request_sha256 text,p_version integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC'
  SET lock_timeout='2s' SET statement_timeout='30s' AS $$
DECLARE actor uuid:=auth.uid(); document_row public.documents%ROWTYPE;
  head survey_private.document_definition_revision_heads%ROWTYPE;
  replay survey_private.document_definition_revisions%ROWTYPE;
  candidate jsonb; expected_request text; next_revision bigint; next_digest text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Document definition upgrade requires READ COMMITTED' USING ERRCODE='25001';
  END IF;
  PERFORM survey_private.document_definition_validate_choices(
    p_archived_semantic_ids,'Document definition archive choices');
  PERFORM survey_private.document_definition_validate_choices(
    p_retired_semantic_roots,'Document definition retirement roots');
  IF actor IS NULL OR p_document_id IS NULL OR p_expected_current_revision IS NULL
     OR p_expected_current_revision NOT BETWEEN 1 AND 9007199254740991
     OR p_expected_current_digest !~ '^[0-9a-f]{64}$'
     OR p_operation_id IS NULL OR p_request_sha256 !~ '^[0-9a-f]{64}$'
     OR p_version NOT IN(1,2)
     OR (p_version=1 AND (p_survey_template_id IS NULL OR p_entity_template_id IS NULL
       OR p_retired_semantic_roots<>'[]'::jsonb))
     OR ((p_survey_template_id IS NULL) <> (p_expected_survey_template_updated_at IS NULL))
     OR ((p_survey_template_id IS NULL) <> (p_expected_survey_structure_sha256 IS NULL))
     OR ((p_entity_template_id IS NULL) <> (p_expected_entity_template_updated_at IS NULL))
     OR ((p_entity_template_id IS NULL) <> (p_expected_entity_entities_sha256 IS NULL))
     OR (p_survey_template_id IS NOT NULL AND p_expected_survey_structure_sha256 !~ '^[0-9a-f]{64}$')
     OR (p_entity_template_id IS NOT NULL AND p_expected_entity_entities_sha256 !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'Document definition upgrade request is invalid' USING ERRCODE='22023';
  END IF;
  SELECT d.* INTO document_row FROM public.documents d WHERE d.id=p_document_id FOR UPDATE;
  IF NOT FOUND OR document_row.user_id IS DISTINCT FROM actor
     OR document_row.archived IS DISTINCT FROM false OR document_row.user_archived_at IS NOT NULL
     OR public.kal49_document_is_locked(p_document_id) THEN
    RAISE EXCEPTION 'Document definition upgrade is not permitted' USING ERRCODE='42501';
  END IF;
  PERFORM survey_private.assert_account_open(actor);
  IF p_version=1 THEN
    expected_request:=survey_private.document_definition_upgrade_request_digest(actor,p_document_id,
      p_expected_current_revision,p_expected_current_digest,p_survey_template_id,
      p_expected_survey_template_updated_at,p_expected_survey_structure_sha256,
      p_entity_template_id,p_expected_entity_template_updated_at,
      p_expected_entity_entities_sha256,p_archived_semantic_ids,p_operation_id);
  ELSE
    expected_request:=survey_private.document_definition_retirement_request_digest(actor,p_document_id,
      p_expected_current_revision,p_expected_current_digest,p_survey_template_id,
      p_expected_survey_template_updated_at,p_expected_survey_structure_sha256,
      p_entity_template_id,p_expected_entity_template_updated_at,
      p_expected_entity_entities_sha256,p_archived_semantic_ids,
      p_retired_semantic_roots,p_operation_id);
  END IF;
  IF expected_request IS DISTINCT FROM p_request_sha256 THEN
    RAISE EXCEPTION 'Document definition upgrade review proof changed' USING ERRCODE='40001';
  END IF;

  -- This is before head or Template reads. A late exact retry is immutable.
  SELECT * INTO replay FROM survey_private.document_definition_revisions r
    WHERE r.document_id=p_document_id AND r.operation_id=p_operation_id;
  IF FOUND THEN
    IF replay.reviewed_by=actor AND replay.request_sha256=p_request_sha256 THEN
      RETURN survey_private.document_definition_revision_receipt(
        p_document_id,replay.definition_revision);
    END IF;
    RAISE EXCEPTION 'Document definition upgrade operation conflicts' USING ERRCODE='23505';
  END IF;
  SELECT * INTO head FROM survey_private.document_definition_revision_heads h
    WHERE h.document_id=p_document_id FOR UPDATE;
  IF NOT FOUND OR head.current_revision IS DISTINCT FROM p_expected_current_revision
     OR head.current_digest IS DISTINCT FROM p_expected_current_digest THEN
    RAISE EXCEPTION 'Document definition upgrade review is stale' USING ERRCODE='40001';
  END IF;
  -- Only changed sources lock, always in UUID order.
  PERFORM 1 FROM public.templates t WHERE t.id IN
    (p_survey_template_id,p_entity_template_id) ORDER BY t.id FOR SHARE;
  candidate:=survey_private.document_definition_candidate_core(actor,p_document_id,
    p_survey_template_id,p_entity_template_id,p_archived_semantic_ids,
    p_retired_semantic_roots,p_version);
  IF (candidate->>'discovery')::boolean THEN
    RAISE EXCEPTION 'Document definition retirement review is required' USING ERRCODE='40001';
  END IF;
  IF p_survey_template_id IS NOT NULL AND
     ((candidate->'surveySource'->>'templateUpdatedAt')::timestamptz
        IS DISTINCT FROM p_expected_survey_template_updated_at
      OR candidate->'surveySource'->>'structureSha256'
        IS DISTINCT FROM p_expected_survey_structure_sha256) THEN
    RAISE EXCEPTION 'Document definition upgrade source changed after review' USING ERRCODE='40001';
  END IF;
  IF p_entity_template_id IS NOT NULL AND
     ((candidate->'entitySource'->>'templateUpdatedAt')::timestamptz
        IS DISTINCT FROM p_expected_entity_template_updated_at
      OR candidate->'entitySource'->>'entitiesSha256'
        IS DISTINCT FROM p_expected_entity_entities_sha256) THEN
    RAISE EXCEPTION 'Document definition upgrade source changed after review' USING ERRCODE='40001';
  END IF;
  IF head.current_revision>=9007199254740991 THEN
    RAISE EXCEPTION 'Document definition revision limit reached' USING ERRCODE='54000';
  END IF;
  next_revision:=head.current_revision+1;
  next_digest:=survey_private.document_definition_combined_digest(p_document_id,next_revision,
    candidate->'surveySource',candidate->'modules',candidate->'entitySource',candidate->'entities',
    candidate->'archivedSemanticIds');
  INSERT INTO survey_private.document_definition_revisions(document_id,definition_revision,
    definition_digest,survey_source,modules,entity_source,entities,archived_semantic_ids,
    operation_id,request_sha256,reviewed_by)
  VALUES(p_document_id,next_revision,next_digest,candidate->'surveySource',candidate->'modules',
    candidate->'entitySource',candidate->'entities',candidate->'archivedSemanticIds',
    p_operation_id,p_request_sha256,actor);
  UPDATE survey_private.document_definition_revision_heads SET current_revision=next_revision,
    current_digest=next_digest,updated_by=actor,updated_at=clock_timestamp()
  WHERE document_id=p_document_id AND current_revision=p_expected_current_revision
    AND current_digest=p_expected_current_digest;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document definition upgrade review is stale' USING ERRCODE='40001';
  END IF;
  RETURN survey_private.document_definition_revision_receipt(p_document_id,next_revision);
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.document_definition_root_descriptor(
  p_modules jsonb, p_entities jsonb, p_kind text, p_id text)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  WITH RECURSIVE nodes AS (
    SELECT * FROM survey_private.document_definition_semantic_nodes(p_modules, p_entities)
  ), tree AS (
    SELECT n.*, 0 AS depth FROM nodes n
      WHERE n.kind = p_kind AND n.semantic_id = p_id
    UNION ALL
    SELECT n.*, t.depth + 1 FROM tree t JOIN nodes n ON
      (n.kind = 'category' AND t.kind = 'module' AND n.parent_id = t.semantic_id)
      OR (n.kind = 'checklistItem' AND t.kind = 'category'
        AND n.parent_id = t.semantic_id)
  ), descriptor AS (
    SELECT jsonb_build_object('kind', kind, 'id', semantic_id,
      'parentId', parent_id, 'label', label) AS value, sort_key
    FROM tree
  ), root AS (
    SELECT * FROM nodes WHERE kind = p_kind AND semantic_id = p_id
  )
  SELECT jsonb_build_object('kind', root.kind, 'id', root.semantic_id,
    'parentId', root.parent_id, 'label', root.label,
    'subtree', (SELECT jsonb_agg(value ORDER BY sort_key) FROM descriptor))
  FROM root
$$;

CREATE OR REPLACE FUNCTION survey_private.document_definition_append_subtree(
  p_modules jsonb, p_entities jsonb, p_kind text, p_parent_id text, p_node jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
DECLARE modules jsonb := p_modules; entities jsonb := p_entities;
  module_index integer; category_index integer;
BEGIN
  IF p_kind = 'module' THEN
    modules := modules || jsonb_build_array(p_node);
  ELSIF p_kind = 'entity' THEN
    entities := entities || jsonb_build_array(p_node);
  ELSIF p_kind = 'category' THEN
    SELECT (m.ordinal - 1)::integer INTO module_index
      FROM jsonb_array_elements(modules) WITH ORDINALITY m(value, ordinal)
      WHERE m.value->>'id' = p_parent_id;
    IF module_index IS NULL THEN
      RAISE EXCEPTION 'DOCUMENT_DEFINITION_SEMANTIC_ID_REUSED' USING ERRCODE='23514';
    END IF;
    modules := jsonb_set(modules, ARRAY[module_index::text, 'categories'],
      modules #> ARRAY[module_index::text, 'categories'] || jsonb_build_array(p_node));
  ELSIF p_kind = 'checklistItem' THEN
    SELECT (m.ordinal - 1)::integer, (c.ordinal - 1)::integer
      INTO module_index, category_index
    FROM jsonb_array_elements(modules) WITH ORDINALITY m(value, ordinal)
    CROSS JOIN LATERAL jsonb_array_elements(m.value->'categories')
      WITH ORDINALITY c(value, ordinal)
    WHERE c.value->>'id' = p_parent_id;
    IF module_index IS NULL OR category_index IS NULL THEN
      RAISE EXCEPTION 'DOCUMENT_DEFINITION_SEMANTIC_ID_REUSED' USING ERRCODE='23514';
    END IF;
    modules := jsonb_set(modules,
      ARRAY[module_index::text, 'categories', category_index::text, 'checklist'],
      modules #> ARRAY[module_index::text, 'categories', category_index::text, 'checklist']
        || jsonb_build_array(p_node));
  ELSE
    RAISE EXCEPTION 'Document definition semantic kind is invalid' USING ERRCODE='22023';
  END IF;
  RETURN jsonb_build_object('modules', modules, 'entities', entities);
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.document_definition_retirement_request_digest(
  p_actor_id uuid, p_document_id uuid, p_expected_current_revision bigint,
  p_expected_current_digest text,
  p_survey_template_id uuid, p_expected_survey_template_updated_at timestamptz,
  p_expected_survey_structure_sha256 text,
  p_entity_template_id uuid, p_expected_entity_template_updated_at timestamptz,
  p_expected_entity_entities_sha256 text,
  p_archived_semantic_ids jsonb, p_retired_semantic_roots jsonb, p_operation_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' SET TimeZone='UTC' AS $$
  SELECT encode(extensions.digest(convert_to(
    survey_private.document_definition_stable_json(jsonb_build_object(
      'version', 2, 'actorId', p_actor_id, 'documentId', p_document_id,
      'expectedCurrentRevision', p_expected_current_revision,
      'expectedCurrentDigest', p_expected_current_digest,
      'surveyMode', CASE WHEN p_survey_template_id IS NULL THEN 'keep' ELSE 'replace' END,
      'surveyTemplateId', p_survey_template_id,
      'expectedSurveyTemplateUpdatedAt', p_expected_survey_template_updated_at,
      'expectedSurveyStructureSha256', p_expected_survey_structure_sha256,
      'entityMode', CASE WHEN p_entity_template_id IS NULL THEN 'keep' ELSE 'replace' END,
      'entityTemplateId', p_entity_template_id,
      'expectedEntityTemplateUpdatedAt', p_expected_entity_template_updated_at,
      'expectedEntityEntitiesSha256', p_expected_entity_entities_sha256,
      'archivedSemanticIds', p_archived_semantic_ids,
      'retiredSemanticRoots', p_retired_semantic_roots,
      'operationId', p_operation_id)), 'UTF8'), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION survey_private.document_definition_validate_choices(
  p_value jsonb, p_name text)
RETURNS void LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
DECLARE choice jsonb;
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_value) > 10304
     OR octet_length(p_value::text) > 1048576 THEN
    RAISE EXCEPTION '% is invalid', p_name USING ERRCODE='22023';
  END IF;
  FOR choice IN SELECT value FROM jsonb_array_elements(p_value) LOOP
    IF jsonb_typeof(choice) IS DISTINCT FROM 'object'
       OR (choice - ARRAY['kind','id']::text[]) <> '{}'::jsonb
       OR jsonb_typeof(choice->'kind') IS DISTINCT FROM 'string'
       OR jsonb_typeof(choice->'id') IS DISTINCT FROM 'string'
       OR (choice->>'kind' IN ('module','category','checklistItem','entity')) IS NOT TRUE
       OR (length(choice->>'id') BETWEEN 1 AND 128) IS NOT TRUE THEN
      RAISE EXCEPTION '% is invalid', p_name USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(p_value)) <>
     (SELECT count(*) FROM (SELECT DISTINCT value->>'kind', value->>'id'
       FROM jsonb_array_elements(p_value)) unique_values) THEN
    RAISE EXCEPTION '% contains duplicates', p_name USING ERRCODE='23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_document_definition_revision_upgrade(
  p_document_id uuid,p_survey_template_id uuid,p_entity_template_id uuid,
  p_archived_semantic_ids jsonb,p_operation_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
  SELECT survey_private.preview_document_definition_core(p_document_id,p_survey_template_id,
    p_entity_template_id,p_archived_semantic_ids,'[]'::jsonb,p_operation_id,0)
$$;

CREATE OR REPLACE FUNCTION public.preview_document_definition_revision_upgrade_v2(
  p_document_id uuid,p_survey_template_id uuid,p_entity_template_id uuid,
  p_archived_semantic_ids jsonb,p_retired_semantic_roots jsonb,p_operation_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
  SELECT survey_private.preview_document_definition_core(p_document_id,p_survey_template_id,
    p_entity_template_id,p_archived_semantic_ids,p_retired_semantic_roots,p_operation_id,2)
$$;

CREATE OR REPLACE FUNCTION public.apply_reviewed_document_definition_revision(
  p_document_id uuid,p_expected_current_revision bigint,p_expected_current_digest text,
  p_survey_template_id uuid,p_expected_survey_template_updated_at timestamptz,
  p_expected_survey_structure_sha256 text,p_entity_template_id uuid,
  p_expected_entity_template_updated_at timestamptz,p_expected_entity_entities_sha256 text,
  p_archived_semantic_ids jsonb,p_operation_id uuid,p_request_sha256 text)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC'
  SET lock_timeout='2s' SET statement_timeout='30s' AS $$
  SELECT survey_private.publish_document_definition_revision_core(p_document_id,
    p_expected_current_revision,p_expected_current_digest,p_survey_template_id,
    p_expected_survey_template_updated_at,p_expected_survey_structure_sha256,
    p_entity_template_id,p_expected_entity_template_updated_at,
    p_expected_entity_entities_sha256,p_archived_semantic_ids,'[]'::jsonb,
    p_operation_id,p_request_sha256,1)
$$;

CREATE OR REPLACE FUNCTION public.apply_reviewed_document_definition_revision_v2(
  p_document_id uuid,p_expected_current_revision bigint,p_expected_current_digest text,
  p_survey_template_id uuid,p_expected_survey_template_updated_at timestamptz,
  p_expected_survey_structure_sha256 text,p_entity_template_id uuid,
  p_expected_entity_template_updated_at timestamptz,p_expected_entity_entities_sha256 text,
  p_archived_semantic_ids jsonb,p_retired_semantic_roots jsonb,
  p_operation_id uuid,p_request_sha256 text)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC'
  SET lock_timeout='2s' SET statement_timeout='30s' AS $$
  SELECT survey_private.publish_document_definition_revision_core(p_document_id,
    p_expected_current_revision,p_expected_current_digest,p_survey_template_id,
    p_expected_survey_template_updated_at,p_expected_survey_structure_sha256,
    p_entity_template_id,p_expected_entity_template_updated_at,
    p_expected_entity_entities_sha256,p_archived_semantic_ids,p_retired_semantic_roots,
    p_operation_id,p_request_sha256,2)
$$;

ALTER FUNCTION survey_private.document_definition_semantic_nodes(jsonb,jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.document_definition_root_descriptor(jsonb,jsonb,text,text) OWNER TO postgres;
ALTER FUNCTION survey_private.document_definition_append_subtree(jsonb,jsonb,text,text,jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.document_definition_retirement_request_digest(uuid,uuid,bigint,text,uuid,timestamptz,text,uuid,timestamptz,text,jsonb,jsonb,uuid) OWNER TO postgres;
ALTER FUNCTION survey_private.document_definition_validate_choices(jsonb,text) OWNER TO postgres;
ALTER FUNCTION survey_private.document_definition_candidate_core(uuid,uuid,uuid,uuid,jsonb,jsonb,integer) OWNER TO postgres;
ALTER FUNCTION survey_private.preview_document_definition_core(uuid,uuid,uuid,jsonb,jsonb,uuid,integer) OWNER TO postgres;
ALTER FUNCTION survey_private.publish_document_definition_revision_core(uuid,bigint,text,uuid,timestamptz,text,uuid,timestamptz,text,jsonb,jsonb,uuid,text,integer) OWNER TO postgres;
ALTER FUNCTION public.preview_document_definition_revision_upgrade(uuid,uuid,uuid,jsonb,uuid) OWNER TO postgres;
ALTER FUNCTION public.preview_document_definition_revision_upgrade_v2(uuid,uuid,uuid,jsonb,jsonb,uuid) OWNER TO postgres;
ALTER FUNCTION public.apply_reviewed_document_definition_revision(uuid,bigint,text,uuid,timestamptz,text,uuid,timestamptz,text,jsonb,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.apply_reviewed_document_definition_revision_v2(uuid,bigint,text,uuid,timestamptz,text,uuid,timestamptz,text,jsonb,jsonb,uuid,text) OWNER TO postgres;

REVOKE ALL ON FUNCTION
  survey_private.document_definition_semantic_nodes(jsonb,jsonb),
  survey_private.document_definition_root_descriptor(jsonb,jsonb,text,text),
  survey_private.document_definition_append_subtree(jsonb,jsonb,text,text,jsonb),
  survey_private.document_definition_retirement_request_digest(uuid,uuid,bigint,text,uuid,timestamptz,text,uuid,timestamptz,text,jsonb,jsonb,uuid),
  survey_private.document_definition_validate_choices(jsonb,text),
  survey_private.document_definition_candidate_core(uuid,uuid,uuid,uuid,jsonb,jsonb,integer),
  survey_private.preview_document_definition_core(uuid,uuid,uuid,jsonb,jsonb,uuid,integer),
  survey_private.publish_document_definition_revision_core(uuid,bigint,text,uuid,timestamptz,text,uuid,timestamptz,text,jsonb,jsonb,uuid,text,integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.preview_document_definition_revision_upgrade(uuid,uuid,uuid,jsonb,uuid),
  public.preview_document_definition_revision_upgrade_v2(uuid,uuid,uuid,jsonb,jsonb,uuid),
  public.apply_reviewed_document_definition_revision(uuid,bigint,text,uuid,timestamptz,text,uuid,timestamptz,text,jsonb,uuid,text),
  public.apply_reviewed_document_definition_revision_v2(uuid,bigint,text,uuid,timestamptz,text,uuid,timestamptz,text,jsonb,jsonb,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.preview_document_definition_revision_upgrade(uuid,uuid,uuid,jsonb,uuid),
  public.preview_document_definition_revision_upgrade_v2(uuid,uuid,uuid,jsonb,jsonb,uuid),
  public.apply_reviewed_document_definition_revision(uuid,bigint,text,uuid,timestamptz,text,uuid,timestamptz,text,jsonb,uuid,text),
  public.apply_reviewed_document_definition_revision_v2(uuid,bigint,text,uuid,timestamptz,text,uuid,timestamptz,text,jsonb,jsonb,uuid,text)
  TO authenticated;

COMMIT;
