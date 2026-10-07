// Shared documents carry their survey templates (owner 2026-10-07: "Yes, they
// can use and edit it"). Mounted once by the viewer for the open document:
//
//   * In the app of a template's OWNER: once the document is open and shared,
//     every member gets the owner's templates this document's survey uses
//     (src/services/sharedTemplates.js grantDocumentTemplates). Reads first,
//     writes only what is missing, once per document open and again if the
//     document becomes shared while it is open. It also remembers, on this
//     device, which templates the document uses, so a share made later from
//     Home can grant them straight away.
//   * In every member's app: when the document has survey markers from a
//     template this person does not have yet, the templates lists read again
//     once, which picks up a grant the owner's app made since sign-in.
//
// Nothing here runs for a document without a database id (local files, the
// plain test route).
import { useEffect, useMemo, useRef } from 'react';
import { supabase } from '../supabaseClient';
import {
  grantDocumentTemplates,
  isUuid,
  ownTemplateRowIds,
  ownerDisplayName,
  refreshTemplateLists,
  rememberDocumentTemplates,
  surveyMarkersNeedUnknownTemplate,
  templatesUsedByDocument,
} from '../services/sharedTemplates.js';
import { readLastSurveyTemplateId } from '../utils/surveyLastTemplate.js';

const SETTLE_MS = 1500;
// Reasons the grant had nothing to do: no retry needed this session.
const DONE_REASONS = new Set(['no templates', 'not my templates', 'not shared', null]);

export default function useSharedDocumentTemplates({
  documentId,
  user,
  docRole = null,
  isDocShared = null,
  surveyMarkers,
  templates,
  selectedTemplateId = null,
  client = supabase,
  delayMs = SETTLE_MS,
}) {
  const userId = user?.id || null;
  const ownerName = ownerDisplayName(user);
  const enabled = Boolean(client && isUuid(documentId) && userId);

  const ownKey = useMemo(() => {
    if (!enabled) return '';
    const used = templatesUsedByDocument({
      surveyMarkers,
      templates,
      extraTemplateIds: [selectedTemplateId, readLastSurveyTemplateId(documentId)],
    });
    return ownTemplateRowIds(used).join(',');
  }, [enabled, documentId, surveyMarkers, templates, selectedTemplateId]);

  const grantedRef = useRef(new Set());
  useEffect(() => {
    if (!enabled) return undefined;
    const ids = ownKey ? ownKey.split(',') : [];
    rememberDocumentTemplates(documentId, ids);
    // A viewer cannot survey, and a document known to be private has nobody
    // to give the template to (null = not known yet: the grant checks).
    if (!ids.length || docRole === 'viewer' || isDocShared === false) return undefined;
    const signature = `${documentId}|${userId}|${ownKey}|${isDocShared}`;
    if (grantedRef.current.has(signature)) return undefined;
    const timer = setTimeout(() => {
      grantedRef.current.add(signature);
      grantDocumentTemplates({ client, documentId, userId, ownerName, templateRowIds: ids })
        .then((result) => {
          if (!DONE_REASONS.has(result?.skipped ?? null)) grantedRef.current.delete(signature);
        })
        .catch(() => grantedRef.current.delete(signature));
    }, delayMs);
    return () => clearTimeout(timer);
  }, [enabled, client, documentId, userId, ownerName, ownKey, docRole, isDocShared, delayMs]);

  const needsUnknownTemplate = useMemo(
    () => enabled && surveyMarkersNeedUnknownTemplate(surveyMarkers, templates),
    [enabled, surveyMarkers, templates],
  );
  const refreshedForRef = useRef(null);
  useEffect(() => {
    if (!needsUnknownTemplate || refreshedForRef.current === documentId) return undefined;
    const timer = setTimeout(() => {
      refreshedForRef.current = documentId;
      refreshTemplateLists();
    }, delayMs);
    return () => clearTimeout(timer);
  }, [needsUnknownTemplate, documentId, delayMs]);
}
