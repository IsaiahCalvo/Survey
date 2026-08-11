/**
 * KAL-426 — the one normalized Archive item shape.
 *
 * Every later ticket reads this module rather than raw Supabase rows: the
 * archive services (KAL-427/428/429) produce these items and the Archive screen
 * (KAL-430) consumes them. Keeping the shape here — and pure — is what lets the
 * screen be tested against mocks and the services be tested without a database.
 *
 * A normalized Archive item:
 *   {
 *     type:           'document' | 'project' | 'template'
 *     id:             row id
 *     name:           display name
 *     ownerId:        the PERMANENT owner (row.user_id). A collaborator whose
 *                     role is 'owner' is deliberately not represented here —
 *                     only the permanent owner can act on an archived item.
 *     projectId:      documents only; the project restore returns them to
 *     projectName:    documents only; resolved for display, may be null
 *     archiveGroupId: non-null only on a project group (the project row and
 *                     each of its child documents share the id)
 *     archivedAt:     ISO string
 *     expiresAt:      ISO string, archivedAt + 30 days
 *     daysRemaining:  whole days left, clamped to 0
 *     children:       projects only; descriptive child documents, each carrying
 *                     the filePath its row thumbnail renders from
 *     childCount:     children.length (0 for documents and templates)
 *     collaborators:  optional; people other than the permanent owner who still
 *                     have access. Attached by archiveService.loadArchive, and
 *                     absent entirely when the item is not shared.
 *     modules:        templates only; [{ id, name, categories: [{ id, name,
 *                     itemCount }] }] — the contents tree the preview shows
 *     entities:       templates only; [{ id, name, color, borderColor }]
 *   }
 */

// Explicit extension: this module is loaded directly by the Node test suite
// (tests/archiveContract.test.mjs), which does not resolve extensionless paths.
import { templateOutline } from './templateConfigShape.js';

/** Retention window. Mirrors public.archive_retention_interval() in the database. */
export const ARCHIVE_RETENTION_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const ARCHIVE_ITEM_TYPES = Object.freeze(['document', 'project', 'template']);

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Whole days between now and the expiry, rounded UP so a partial day still
 * reads as a day left, and clamped to 0 so an overdue row never shows a
 * negative count while it waits for the purge job.
 */
export function daysRemaining(expiresAt, now = Date.now()) {
  const iso = toIso(expiresAt);
  if (!iso) return 0;
  const delta = new Date(iso).getTime() - (now instanceof Date ? now.getTime() : now);
  if (delta <= 0) return 0;
  return Math.ceil(delta / MS_PER_DAY);
}

/** The expiry the database would compute for an archive happening at `archivedAt`. */
export function expiryFromArchivedAt(archivedAt) {
  const iso = toIso(archivedAt);
  if (!iso) return null;
  return new Date(new Date(iso).getTime() + ARCHIVE_RETENTION_DAYS * MS_PER_DAY).toISOString();
}

/** True when the row carries user-Archive metadata (never the plan-limit `archived` flag). */
export function isUserArchived(row) {
  return Boolean(row && row.user_archived_at);
}

/**
 * The three retention fields, derived once. Shared by top-level items and by a
 * project's child rows so a child's "Archived" and "Days remaining" columns can
 * never disagree with a top-level document's for the same moment in time.
 */
function archiveDates(row, now) {
  const archivedAt = toIso(row.user_archived_at);
  const expiresAt = toIso(row.user_archive_expires_at) || expiryFromArchivedAt(archivedAt);
  return { archivedAt, expiresAt, daysRemaining: daysRemaining(expiresAt, now) };
}

function baseItem(type, row, now) {
  const dates = archiveDates(row, now);
  return {
    type,
    id: row.id,
    name: row.name || 'Untitled',
    ownerId: row.user_id || null,
    projectId: null,
    projectName: null,
    archiveGroupId: row.archive_group_id || null,
    ...dates,
    children: [],
    childCount: 0,
  };
}

/** A document archived on its own — a top-level Archive item. */
export function normalizeDocumentItem(row, { projectName = null, now = Date.now() } = {}) {
  const item = baseItem('document', row, now);
  item.projectId = row.project_id || null;
  item.projectName = projectName;
  // Preview-pane fields. Kept on the item (not fetched again by the screen) so
  // the presentational component stays free of data access.
  item.filePath = row.file_path || null;
  item.fileSize = typeof row.file_size === 'number' ? row.file_size : null;
  item.pageCount = typeof row.page_count === 'number' ? row.page_count : null;
  return item;
}

/**
 * A template archived on its own.
 *
 * Carries a read-only outline of what is inside it — modules with their
 * categories nested underneath, plus the entities — so the preview pane can
 * show the user what they are about to restore or destroy. A template owns no
 * file, so its contents are the ONLY way to recognise it; a name alone does
 * not tell you which checklist set is about to be deleted forever.
 *
 * The outline comes from the same readers TemplatesEditor uses
 * (services/templateConfigShape), so an archived template reads as the same
 * object the editor shows. Both template queries must select `config` or this
 * degrades to empty lists.
 */
export function normalizeTemplateItem(row, { now = Date.now() } = {}) {
  const item = baseItem('template', row, now);
  const outline = templateOutline(row);
  item.modules = outline.modules;
  item.entities = outline.entities;
  return item;
}

/**
 * A project group: one Archive item whose children are descriptive rows.
 * Children cannot be restored or deleted on their own — the project acts as a
 * unit — so they are deliberately reduced to the fields the screen displays.
 */
export function normalizeProjectItem(row, childDocumentRows = [], { now = Date.now() } = {}) {
  const item = baseItem('project', row, now);
  item.children = (childDocumentRows || []).map((child) => {
    /* Owner call 2026-08-07: a child row IS a document, so it fills the same
       Type / Archived / Days remaining columns as a top-level one — a row with
       three blank cells reads as missing data, not as "inherited". A project
       archives as one unit, so a child that somehow stored no timestamps of its
       own falls back to the project's rather than showing an em dash. */
    const dates = child.user_archived_at ? archiveDates(child, now) : {
      archivedAt: item.archivedAt, expiresAt: item.expiresAt, daysRemaining: item.daysRemaining,
    };
    return {
      type: 'document',
      id: child.id,
      name: child.name || 'Untitled',
      projectId: child.project_id || row.id,
      archiveGroupId: child.archive_group_id || row.archive_group_id || null,
      // Carried so an expanded project's child rows can show the same real
      // first-page thumbnail the Documents ledger shows. Both child-row queries
      // (archiveService.loadArchive and projectArchiveService.listArchivedProjects)
      // must select file_path — and now user_archived_at /
      // user_archive_expires_at too — or the row silently falls back.
      filePath: child.file_path || null,
      fileSize: typeof child.file_size === 'number' ? child.file_size : null,
      ...dates,
    };
  });
  item.childCount = item.children.length;
  /* A project's size is the SUM of the documents that travel with it — the
     honest answer to "how much comes back if I restore this", and what lets a
     project take a real position in the Size sort instead of sinking to the
     bottom with the templates. Null (not 0) when nothing reported a size, so
     "no size" stays distinguishable from "empty". */
  const sized = item.children.filter((child) => typeof child.fileSize === 'number');
  item.fileSize = sized.length ? sized.reduce((total, child) => total + child.fileSize, 0) : null;
  return item;
}

/**
 * Assemble the whole Archive from the three raw row sets.
 *
 * A document belongs to a project group when it carries that project's
 * archive_group_id; those rows become children and never appear as top-level
 * items. Everything else is top level.
 */
export function buildArchiveItems({
  documents = [],
  projects = [],
  templates = [],
  projectNamesById = {},
  now = Date.now(),
} = {}) {
  const archivedDocuments = documents.filter(isUserArchived);
  const archivedProjects = projects.filter(isUserArchived);
  const archivedTemplates = templates.filter(isUserArchived);

  const groupIds = new Set(
    archivedProjects.map((project) => project.archive_group_id).filter(Boolean),
  );
  const childrenByGroup = new Map();
  const standaloneDocuments = [];

  for (const row of archivedDocuments) {
    const group = row.archive_group_id;
    if (group && groupIds.has(group)) {
      if (!childrenByGroup.has(group)) childrenByGroup.set(group, []);
      childrenByGroup.get(group).push(row);
      continue;
    }
    standaloneDocuments.push(row);
  }

  return [
    ...archivedProjects.map((row) => normalizeProjectItem(
      row,
      childrenByGroup.get(row.archive_group_id) || [],
      { now },
    )),
    ...standaloneDocuments.map((row) => normalizeDocumentItem(row, {
      projectName: row.project_id ? (projectNamesById[row.project_id] || null) : null,
      now,
    })),
    ...archivedTemplates.map((row) => normalizeTemplateItem(row, { now })),
  ];
}

/**
 * The confirmation copy locked in KAL-280. Kept beside the contract so the
 * archive call sites (KAL-432) and the Archive screen cannot drift apart.
 * Sentence case, curly apostrophes, matching the rest of the hub.
 */
export function archiveConfirmCopy(item) {
  if (!item) return null;
  if (item.type === 'project') {
    return {
      title: 'Archive this project?',
      message: `${item.name} and its ${item.childCount} ${item.childCount === 1 ? 'document' : 'documents'} will move to Archive and remain recoverable for ${ARCHIVE_RETENTION_DAYS} days. After ${ARCHIVE_RETENTION_DAYS} days, the project, its documents, and all markups will be permanently deleted.`,
      confirmLabel: 'Archive project',
    };
  }
  if (item.type === 'template') {
    return {
      title: 'Archive this template?',
      message: `${item.name} and all of its content will move to Archive and remain recoverable for ${ARCHIVE_RETENTION_DAYS} days. After ${ARCHIVE_RETENTION_DAYS} days, the template will be permanently deleted.`,
      confirmLabel: 'Archive template',
    };
  }
  return {
    title: 'Archive this document?',
    message: `${item.name} will move to Archive and remain recoverable for ${ARCHIVE_RETENTION_DAYS} days. After ${ARCHIVE_RETENTION_DAYS} days, the document and all its markups will be permanently deleted.`,
    confirmLabel: 'Archive document',
  };
}

/** The single permanent-deletion confirmation, identical for every selection. */
export const DELETE_FOREVER_COPY = Object.freeze({
  title: 'Delete forever?',
  message: 'This cannot be undone. The selected items and everything they contain will be permanently deleted.',
  confirmLabel: 'Delete forever',
});
