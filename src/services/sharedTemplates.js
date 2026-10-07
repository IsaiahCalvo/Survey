// Survey templates shared through a document (owner 2026-10-07: "When you
// share a document, should the people you share it with get your survey
// template so they can see and place your survey markers?" -> "Yes, they can
// use and edit it").
//
// It rides the template sharing that already exists (migration
// 20260701120000_project_template_sharing.sql): a `template_collaborators`
// row gives a person the template. The database already lets
//   * anyone with a row READ the template (viewer and up) and an editor
//     UPDATE it;
//   * only the template's OWNER add or change those rows.
// So the grant runs in the template owner's app: when the owner has a shared
// document open (and right after they share one from Home), every member of
// the document gets a row for each of the owner's templates the document's
// survey uses. Editors (and co-owners) of the document get "editor" on the
// template, viewers get "viewer" (use only). When the owner switches a member
// to viewer, the template row the document gave them goes back to "viewer"
// too (realCheck3, 2026-10-07: on the real backend a document viewer could
// still change the template). A row the person got by accepting a template
// invite of its own is never lowered, and a row someone switched off (status
// other than active) is left alone.
//
// The collaborator's own app cannot ask for the template (no policy allows
// it); it just re-reads its templates when a document it opens has markers
// from a template it does not have yet, which picks up the owner's grant.
// scratchpad/sharedTemplates/PROPOSED-DB-CHANGE.md has the optional server
// function that would let the collaborator's app do the back-fill itself.

import { notifyTemplatesChanged } from '../hooks/libraryChangeBus.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

/** Extra field the templates read puts on a row shared with me (not a column). */
export const SHARED_ROLE_FIELD = 'shared_role';

const ROLE_RANK = { viewer: 1, editor: 2, owner: 3 };
const roleRank = (role) => ROLE_RANK[String(role || '').toLowerCase()] || 0;

/** The template role a document member gets: editors and owners of the
 *  document can edit the template, viewers can only use it. */
export function templateRoleForDocumentRole(documentRole) {
  const role = String(documentRole || '').toLowerCase();
  if (role === 'editor' || role === 'owner') return 'editor';
  if (role === 'viewer') return 'viewer';
  return null;
}

// ------------------------------------------------------------------ reading

/**
 * Own rows first (as given), then the rows shared with me, each tagged with
 * my role on it. A row I own never counts as shared; a shared row I cannot
 * resolve a role for is dropped.
 */
export function mergeOwnAndSharedTemplateRows({ ownRows = [], sharedRows = [], collaboratorRows = [], userId = null } = {}) {
  const roleByTemplate = new Map();
  for (const row of collaboratorRows || []) {
    if (!row?.template_id) continue;
    if (row.status && row.status !== 'active') continue;
    const prev = roleByTemplate.get(row.template_id);
    if (!prev || roleRank(row.role) > roleRank(prev)) roleByTemplate.set(row.template_id, row.role || 'viewer');
  }
  const own = (ownRows || []).filter(Boolean);
  const ownIds = new Set(own.map((row) => row.id));
  const shared = [];
  for (const row of sharedRows || []) {
    if (!row?.id || ownIds.has(row.id)) continue;
    if (userId && row.user_id === userId) continue;
    const role = roleByTemplate.get(row.id);
    if (!role) continue;
    shared.push({ ...row, [SHARED_ROLE_FIELD]: String(role).toLowerCase() });
  }
  return [...own, ...shared];
}

/** True when this templates ROW was shared with me (not mine). */
export const isSharedTemplateRow = (row) => Boolean(row && row[SHARED_ROLE_FIELD]);

/**
 * What the app keeps on a shared template: who owns it, their name (stamped
 * into the template by the owner's app) and whether I may edit it.
 */
export function sharedFromRow(row) {
  if (!isSharedTemplateRow(row)) return null;
  const config = row.config && typeof row.config === 'object' ? row.config : {};
  const role = row[SHARED_ROLE_FIELD];
  return {
    ownerId: row.user_id || null,
    ownerName: typeof config.ownerName === 'string' && config.ownerName.trim() ? config.ownerName.trim() : null,
    role,
    canEdit: roleRank(role) >= ROLE_RANK.editor,
  };
}

/** "Shared by Ann Lee" (+ " · use only" when you may not edit it). */
export function sharedTemplateLabel(sharedFrom) {
  if (!sharedFrom) return '';
  const who = sharedFrom.ownerName || 'another person';
  return `Shared by ${who}${sharedFrom.canEdit ? '' : ' · use only'}`;
}

/** Templates (the app's shape) split into my own and the ones shared with me. */
export function splitTemplatesForSave(templates = []) {
  const own = [];
  const shared = [];
  for (const template of templates || []) {
    if (!template) continue;
    if (template.sharedFrom) shared.push(template);
    else own.push(template);
  }
  return { own, shared };
}

/** Drop the fields that are about this app session, not the template. */
export function stripSharedFields(template) {
  if (!template || typeof template !== 'object') return template;
  const { sharedFrom, supabaseId, ...rest } = template;
  return rest;
}

const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};

/** Same stored template config, whatever the key order. */
export function sameTemplateConfig(a, b) {
  return stableJson(a || {}) === stableJson(b || {});
}

/** The person's display name the owner's app stamps on their templates. */
export function ownerDisplayName(user) {
  const meta = user?.user_metadata || {};
  const full = meta.full_name || [meta.first_name, meta.last_name].filter(Boolean).join(' ');
  return String(full || user?.name || user?.email || '').trim() || null;
}

// ---------------------------------------------- which templates a document uses

const surveyMarkerList = (surveyMarkers) => {
  if (!surveyMarkers) return [];
  if (Array.isArray(surveyMarkers)) return surveyMarkers.filter(Boolean);
  return Object.values(surveyMarkers).filter((m) => m && typeof m === 'object');
};

const modulesOf = (template) => {
  const list = template?.modules || template?.spaces;
  return Array.isArray(list) ? list.filter(Boolean) : [];
};

/** module and category ids the document's survey markers point at. */
export function surveyMarkerScopes(surveyMarkers) {
  const moduleIds = new Set();
  const categoryIds = new Set();
  for (const marker of surveyMarkerList(surveyMarkers)) {
    if (marker.moduleId) moduleIds.add(String(marker.moduleId));
    if (marker.spaceId) moduleIds.add(String(marker.spaceId));
    if (marker.categoryId) categoryIds.add(String(marker.categoryId));
  }
  return { moduleIds, categoryIds };
}

function templateMatchesScopes(template, { moduleIds, categoryIds }) {
  for (const mod of modulesOf(template)) {
    if (mod.id && moduleIds.has(String(mod.id))) return true;
    for (const cat of mod.categories || []) {
      if (cat?.id && categoryIds.has(String(cat.id))) return true;
    }
  }
  return false;
}

/**
 * The templates (the app's shape) a document's survey uses: any template with
 * a module or category a survey marker points at, plus the template open in
 * Survey right now and the one remembered for this document.
 */
export function templatesUsedByDocument({ surveyMarkers, templates = [], extraTemplateIds = [] } = {}) {
  const scopes = surveyMarkerScopes(surveyMarkers);
  const extra = new Set((extraTemplateIds || []).filter(Boolean).map(String));
  return (templates || []).filter((template) => template && (
    extra.has(String(template.id)) || (template.supabaseId && extra.has(String(template.supabaseId)))
    || templateMatchesScopes(template, scopes)
  ));
}

/** True when a survey marker points at a module or category no known template has. */
export function surveyMarkersNeedUnknownTemplate(surveyMarkers, templates = []) {
  const { moduleIds, categoryIds } = surveyMarkerScopes(surveyMarkers);
  if (moduleIds.size === 0 && categoryIds.size === 0) return false;
  const knownModules = new Set();
  const knownCategories = new Set();
  for (const template of templates || []) {
    for (const mod of modulesOf(template)) {
      if (mod.id) knownModules.add(String(mod.id));
      for (const cat of mod.categories || []) if (cat?.id) knownCategories.add(String(cat.id));
    }
  }
  for (const id of moduleIds) if (!knownModules.has(id)) return true;
  for (const id of categoryIds) if (!knownCategories.has(id)) return true;
  return false;
}

/** The templates ROW ids I own among `templates` (only those can be granted). */
export function ownTemplateRowIds(templates = []) {
  return [...new Set((templates || [])
    .filter((t) => t && !t.sharedFrom && isUuid(t.supabaseId))
    .map((t) => t.supabaseId))].sort();
}

// -------------------------------------------------- per-device memory (Home)

export const DOCUMENT_TEMPLATES_KEY_PREFIX = 'survey:documentTemplates:';

function defaultStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

/** Remember which of my templates this document uses, so a share from Home
 *  (where the document's markers are not loaded) can grant them at once. */
export function rememberDocumentTemplates(documentId, templateRowIds, storage = defaultStorage()) {
  if (!documentId || !storage) return false;
  const ids = [...new Set((templateRowIds || []).filter(isUuid))].sort();
  try {
    const key = `${DOCUMENT_TEMPLATES_KEY_PREFIX}${documentId}`;
    if (ids.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}

export function readRememberedDocumentTemplates(documentId, storage = defaultStorage()) {
  if (!documentId || !storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(`${DOCUMENT_TEMPLATES_KEY_PREFIX}${documentId}`) || '[]');
    return Array.isArray(parsed) ? parsed.filter(isUuid) : [];
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ granting

/**
 * Who is on the document and with which role, from the rows the database
 * returns: direct document rows win over project rows; the document's and the
 * project's creators are owners. `me` is left out.
 */
export function documentMembers({ me, documentOwnerId = null, documentRows = [], projectOwnerId = null, projectRows = [] } = {}) {
  const members = new Map();
  const put = (userId, role, email = null, { override = false } = {}) => {
    if (!userId || userId === me || !roleRank(role)) return;
    const prev = members.get(userId);
    if (!prev || override) members.set(userId, { userId, role, email: email || prev?.email || null });
  };
  for (const row of projectRows || []) {
    if (row?.status && row.status !== 'active') continue;
    put(row?.user_id, row?.role, row?.email);
  }
  if (projectOwnerId) put(projectOwnerId, 'owner', null, { override: true });
  for (const row of documentRows || []) {
    if (row?.status && row.status !== 'active') continue;
    put(row?.user_id, row?.role, row?.email, { override: true });
  }
  if (documentOwnerId) put(documentOwnerId, 'owner', null, { override: true });
  return [...members.values()];
}

/**
 * The rows to add and the roles to change so every member has each template
 * with the role their document role gives. `existing` are the
 * template_collaborators rows already there. A role is raised to match, and
 * lowered from editor to viewer only for a row that did not come from a
 * template invite (`invitedKeys`: "templateId|userId" of accepted invites).
 */
export function planTemplateGrants({ templateRowIds = [], templateOwners = new Map(), members = [], existing = [], grantedBy = null, invitedKeys = new Set() } = {}) {
  const inserts = [];
  const upgrades = [];
  const downgrades = [];
  const byKey = new Map((existing || []).map((row) => [`${row.template_id}|${row.user_id}`, row]));
  for (const templateId of templateRowIds) {
    const ownerId = templateOwners.get?.(templateId) ?? null;
    for (const member of members) {
      if (!member?.userId || member.userId === ownerId) continue;
      const role = templateRoleForDocumentRole(member.role);
      if (!role) continue;
      const row = byKey.get(`${templateId}|${member.userId}`);
      if (!row) {
        inserts.push({
          template_id: templateId,
          user_id: member.userId,
          email: member.email || null,
          role,
          status: 'active',
          invited_by: grantedBy,
        });
      } else if ((row.status ?? 'active') !== 'active') {
        // switched off: leave it
      } else if (roleRank(role) > roleRank(row.role)) {
        upgrades.push({ id: row.id, template_id: templateId, user_id: member.userId, role });
      } else if (role === 'viewer' && String(row.role || '').toLowerCase() === 'editor'
        && !invitedKeys.has(`${templateId}|${member.userId}`)) {
        downgrades.push({ id: row.id, template_id: templateId, user_id: member.userId, role });
      }
    }
  }
  return { inserts, upgrades, downgrades };
}

const inFlight = new Map();

/**
 * Give every member of `documentId` the templates in `templateRowIds` that I
 * own, with the role their document role gives. Safe to call often: it reads
 * first and writes only what is missing or different.
 * Returns { granted, upgraded, downgraded, skipped } (skipped: a reason).
 */
export function grantDocumentTemplates(args) {
  const key = `${args?.documentId}|${[...(args?.templateRowIds || [])].sort().join(',')}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const run = runGrant(args).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

async function runGrant({ client, documentId, userId, ownerName = null, templateRowIds = [] } = {}) {
  const ids = [...new Set((templateRowIds || []).filter(isUuid))].sort();
  if (!client?.from || !isUuid(documentId) || !userId) return { granted: 0, upgraded: 0, skipped: 'missing input' };
  if (ids.length === 0) return { granted: 0, upgraded: 0, skipped: 'no templates' };

  // Only templates I own can be granted (the database enforces it too).
  const { data: tplRows, error: tplError } = await client
    .from('templates').select('id, user_id, config').in('id', ids);
  if (tplError) return { granted: 0, upgraded: 0, skipped: tplError.message };
  const mine = (tplRows || []).filter((row) => row?.user_id === userId);
  if (mine.length === 0) return { granted: 0, upgraded: 0, skipped: 'not my templates' };
  const mineIds = mine.map((row) => row.id);

  const [docRes, collabRes] = await Promise.all([
    client.from('documents').select('id, user_id, project_id').eq('id', documentId).maybeSingle(),
    client.from('document_collaborators').select('user_id, role, email, status').eq('document_id', documentId).eq('status', 'active'),
  ]);
  if (docRes?.error || collabRes?.error) {
    return { granted: 0, upgraded: 0, skipped: (docRes?.error || collabRes?.error).message };
  }
  const projectId = docRes?.data?.project_id || null;
  let projectRows = [];
  let projectOwnerId = null;
  if (projectId) {
    // Best effort: a member who reaches the document through its project.
    const [projRes, projCollabRes] = await Promise.all([
      client.from('projects').select('id, user_id').eq('id', projectId).maybeSingle(),
      client.from('project_collaborators').select('user_id, role, email, status').eq('project_id', projectId).eq('status', 'active'),
    ]);
    if (!projRes?.error) projectOwnerId = projRes?.data?.user_id || null;
    if (!projCollabRes?.error) projectRows = projCollabRes?.data || [];
  }
  const members = documentMembers({
    me: userId,
    documentOwnerId: docRes?.data?.user_id || null,
    documentRows: collabRes?.data || [],
    projectOwnerId,
    projectRows,
  });
  if (members.length === 0) return { granted: 0, upgraded: 0, skipped: 'not shared' };

  // Record which of my templates this document uses (owner-approved
  // 2026-10-07, migration 20261007180000_document_templates.sql), so a member
  // who joins later can claim them without me being online. Best effort: an
  // older database without the table simply refuses and the grant below still
  // covers everyone who is a member now.
  await linkDocumentTemplates({ client, documentId, userId, templateRowIds: mineIds });

  const { data: existing, error: existingError } = await client
    .from('template_collaborators').select('id, template_id, user_id, role, status').in('template_id', mineIds);
  if (existingError) return { granted: 0, upgraded: 0, skipped: existingError.message };

  const planArgs = {
    templateRowIds: mineIds,
    templateOwners: new Map(mine.map((row) => [row.id, row.user_id])),
    members,
    existing: existing || [],
    grantedBy: userId,
  };
  let plan = planTemplateGrants(planArgs);
  if (plan.downgrades.length) {
    // Someone may hold the template through its own invite; only the
    // owner can read those (one read, only when a role would go down).
    const { data: invites, error: invitesError } = await client
      .from('template_invites').select('template_id, accepted_by').in('template_id', mineIds);
    const invitedKeys = new Set((invites || [])
      .filter((row) => row?.accepted_by)
      .map((row) => `${row.template_id}|${row.accepted_by}`));
    // Unknown (read failed): lower nothing.
    plan = invitesError ? { ...plan, downgrades: [] } : planTemplateGrants({ ...planArgs, invitedKeys });
  }

  let granted = 0;
  let upgraded = 0;
  let downgraded = 0;
  if (plan.inserts.length) {
    const { error } = await client.from('template_collaborators').insert(plan.inserts);
    if (error) return { granted: 0, upgraded: 0, skipped: error.message };
    granted = plan.inserts.length;
  }
  for (const up of plan.upgrades) {
    const { error } = await client.from('template_collaborators').update({ role: up.role }).eq('id', up.id);
    if (!error) upgraded += 1;
  }
  for (const down of plan.downgrades) {
    const { error } = await client.from('template_collaborators').update({ role: down.role }).eq('id', down.id);
    if (!error) downgraded += 1;
  }

  // The people I share with see my name on the template (initials + colour).
  if (ownerName) {
    for (const row of mine) {
      const config = row.config && typeof row.config === 'object' ? row.config : null;
      if (!config || config.ownerName === ownerName) continue;
      await client.from('templates').update({ config: { ...config, ownerName } }).eq('id', row.id).eq('user_id', userId);
    }
  }
  return { granted, upgraded, downgraded, skipped: null };
}

/**
 * After a document was shared from Home, or a member's role on it changed in
 * Manage access: grant (or re-role) the templates this device saw the
 * document use. Fire-and-forget; never throws.
 */
export async function grantRememberedDocumentTemplates({ client, documentId, user, storage } = {}) {
  try {
    const ids = readRememberedDocumentTemplates(documentId, storage);
    if (!ids.length || !user?.id) return { granted: 0, upgraded: 0, skipped: 'nothing remembered' };
    return await grantDocumentTemplates({ client, documentId, userId: user.id, ownerName: ownerDisplayName(user), templateRowIds: ids });
  } catch (err) {
    return { granted: 0, upgraded: 0, skipped: err?.message || String(err) };
  }
}

/** Link my templates to a document (document_templates). Never throws. */
export async function linkDocumentTemplates({ client, documentId, userId, templateRowIds = [] } = {}) {
  try {
    const ids = [...new Set((templateRowIds || []).filter(isUuid))];
    if (!client?.from || !isUuid(documentId) || !userId || ids.length === 0) return false;
    const rows = ids.map((templateId) => ({ document_id: documentId, template_id: templateId, linked_by: userId }));
    const { error } = await client.from('document_templates')
      .upsert(rows, { onConflict: 'document_id,template_id', ignoreDuplicates: true });
    return !error;
  } catch {
    return false;
  }
}

/** As a member: take the templates the owner linked to this document
 *  (claim_document_templates gives editor or viewer from my document role).
 *  Returns how many rows it added or raised; 0 on any refusal. Never throws. */
export async function claimDocumentTemplates({ client, documentId } = {}) {
  try {
    if (!client?.rpc || !isUuid(documentId)) return 0;
    const { data, error } = await client.rpc('claim_document_templates', { p_document_id: documentId });
    return error ? 0 : (Number(data) || 0);
  } catch {
    return 0;
  }
}

/** Ask every templates list to read again (a grant may have landed). */
export function refreshTemplateLists() {
  notifyTemplatesChanged();
}
