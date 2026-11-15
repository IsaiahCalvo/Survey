// Kal Voe suite library rules (KAL-585): My library and Company library of
// Categories and Category Types, shared by Walkthru, Plot and Survey. Pure:
// no React, no Supabase, so the Node tests pin every rule. The database
// enforces the same rules (supabase/migrations/20261115191000_suite_library.sql).

export const LIBRARY_KINDS = Object.freeze({ category: 'category', categoryType: 'categoryType' });
export const LIBRARY_NAME_MAX = 120;

export function cleanLibraryName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, LIBRARY_NAME_MAX);
}

/** Names match exactly, ignoring case and extra spaces. Nothing is guessed. */
export function sameLibraryName(a, b) {
  const x = cleanLibraryName(a);
  return Boolean(x) && x.toLocaleLowerCase() === cleanLibraryName(b).toLocaleLowerCase();
}

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * The tabs a person sees: My library always; Company library once they are
 * in a company. `company` is get_my_organization()'s answer (or null).
 */
export function libraryTabs(company) {
  const tabs = [{ id: 'mine', label: 'My library' }];
  if (company?.id) tabs.push({ id: 'company', label: 'Company library' });
  return tabs;
}

/** The library a new entry goes to by default: the company's when in one. */
export function defaultLibraryScope(company) {
  return company?.id ? 'company' : 'mine';
}

/** May this person add an entry to this library? Any member may. */
export function canAddToLibrary(scope, { userId, company } = {}) {
  if (!userId) return false;
  if (scope === 'mine') return true;
  return scope === 'company' && Boolean(company?.id);
}

/** May this person rename or remove this entry? Owner of a My library entry, or a company owner / admin. */
export function canManageEntry(entry, { userId, company } = {}) {
  if (!entry || !userId) return false;
  if (entry.scope === 'mine') return entry.ownerId === userId;
  if (entry.scope === 'company') {
    return Boolean(company?.id) && entry.organizationId === company.id
      && (company.my_role === 'owner' || company.my_role === 'admin');
  }
  return false;
}

/** Is this entry in the given tab for this person? */
export function entryInTab(entry, tab, { userId, company } = {}) {
  if (!entry || entry.removedAt) return false;
  if (tab === 'mine') return entry.scope === 'mine' && entry.ownerId === userId;
  if (tab === 'company') return entry.scope === 'company' && Boolean(company?.id) && entry.organizationId === company.id;
  return false;
}

/** A new entry made on this device (its id too, so it can sync offline). */
export function newLibraryEntry({ kind = 'category', name, parentId = null, scope = 'mine', userId, company = null, id = uuid(), now = new Date().toISOString() }) {
  const clean = cleanLibraryName(name);
  if (!clean) throw new Error('Give it a name.');
  if (kind !== 'category' && kind !== 'categoryType') throw new Error('Unknown library entry kind.');
  if (kind === 'categoryType' && !parentId) throw new Error('A Category Type needs a Category.');
  if (!canAddToLibrary(scope, { userId, company })) throw new Error('You cannot add to that library.');
  return {
    id,
    kind,
    parentId: kind === 'categoryType' ? parentId : null,
    name: clean,
    scope,
    ownerId: userId,
    organizationId: scope === 'company' ? company.id : null,
    createdAt: now,
    updatedAt: now,
    removedAt: null,
  };
}

/** Categories of one tab, A to Z, each with its live Category Types. */
export function libraryTree(entries, tab, ctx) {
  const live = (entries || []).filter((e) => entryInTab(e, tab, ctx));
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  return live.filter((e) => e.kind === 'category').sort(byName).map((category) => ({
    ...category,
    types: live.filter((e) => e.kind === 'categoryType' && e.parentId === category.id).sort(byName),
  }));
}

/** A live Category of `scope` named `name` (exact), or null. */
export function findCategory(entries, name, scope, ctx) {
  return (entries || []).find((e) => e.kind === 'category' && entryInTab(e, scope, ctx) && sameLibraryName(e.name, name)) || null;
}

function templateModules(template) {
  return Array.isArray(template?.modules) ? template.modules : (Array.isArray(template?.spaces) ? template.spaces : []);
}

/**
 * Link every template Category to a library entry, so other apps can match
 * it. A Category that already has `libraryEntryId` keeps it. Others link by
 * exact name: first the company library (when in one), then My library; with
 * no match a new entry is made in the default library. The same name in two
 * Modules links to one entry. Checklists are never touched.
 * Returns { templates, created } (templates unchanged when nothing linked).
 */
export function linkTemplateCategories(templates, entries, { userId, company = null, makeId } = {}) {
  if (!userId || !Array.isArray(templates)) return { templates, created: [] };
  const known = [...(entries || [])];
  const created = [];
  const scope = defaultLibraryScope(company);
  const ctx = { userId, company };
  const resolve = (name) => {
    const hit = (company?.id ? findCategory(known, name, 'company', ctx) : null) || findCategory(known, name, 'mine', ctx);
    if (hit) return hit.id;
    const entry = newLibraryEntry({ kind: 'category', name, scope, userId, company, ...(makeId ? { id: makeId() } : {}) });
    known.push(entry);
    created.push(entry);
    return entry.id;
  };
  let changedAny = false;
  const next = templates.map((template) => {
    const modules = templateModules(template);
    let changed = false;
    const nextModules = modules.map((mod) => {
      const categories = Array.isArray(mod?.categories) ? mod.categories : [];
      let modChanged = false;
      const nextCats = categories.map((cat) => {
        if (!cat || cat.libraryEntryId || !cleanLibraryName(cat.name)) return cat;
        modChanged = true;
        return { ...cat, libraryEntryId: resolve(cat.name) };
      });
      if (!modChanged) return mod;
      changed = true;
      return { ...mod, categories: nextCats };
    });
    if (!changed) return template;
    changedAny = true;
    const out = { ...template, modules: nextModules };
    if (Array.isArray(template.spaces)) out.spaces = nextModules;
    return out;
  });
  return { templates: changedAny ? next : templates, created };
}

// ---------------------------------------------------------------------------
// Offline outbox: one op per entry change, sent one at a time, oldest first.
// ---------------------------------------------------------------------------

/** Apply one outbox op to the local entry list. */
export function applyLibraryOp(entries, op, now = new Date().toISOString()) {
  const list = Array.isArray(entries) ? entries : [];
  if (!op) return list;
  if (op.op === 'create') {
    if (list.some((e) => e.id === op.entry.id)) return list;
    return [...list, op.entry];
  }
  if (op.op === 'rename') {
    const name = cleanLibraryName(op.name);
    if (!name) return list;
    return list.map((e) => (e.id === op.id ? { ...e, name, updatedAt: now } : e));
  }
  if (op.op === 'remove') {
    return list.map((e) => (e.id === op.id || (op.withTypes !== false && e.parentId === op.id) ? { ...e, removedAt: e.removedAt || now } : e));
  }
  return list;
}

/** Server rows plus the ops still waiting to send. */
export function mergeServerEntries(serverEntries, outbox) {
  return (outbox || []).reduce((list, op) => applyLibraryOp(list, op), [...(serverEntries || [])]);
}

/**
 * Send the outbox, one op at a time. `send(op)` resolves on success, rejects
 * with { offline: true } to stop and keep the rest for later, or rejects with
 * anything else to drop that op (refused, say for a non-admin rename).
 * Returns { outbox: what is left, sent, refused }.
 */
export async function flushLibraryOutbox(outbox, send) {
  const left = [...(outbox || [])];
  const sent = [];
  const refused = [];
  while (left.length) {
    const op = left[0];
    try {
      await send(op);
      sent.push(op);
      left.shift();
    } catch (err) {
      if (err?.offline) break;
      refused.push({ op, error: err });
      left.shift();
    }
  }
  return { outbox: left, sent, refused };
}

/** Row <-> local entry. */
export function entryFromRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    parentId: row.parent_id ?? null,
    name: row.name,
    scope: row.scope,
    ownerId: row.owner_id,
    organizationId: row.organization_id ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    removedAt: row.removed_at ?? null,
  };
}

export function rowFromEntry(entry) {
  return {
    id: entry.id,
    kind: entry.kind,
    parent_id: entry.parentId ?? null,
    name: entry.name,
    scope: entry.scope,
    owner_id: entry.ownerId,
    organization_id: entry.organizationId ?? null,
  };
}
