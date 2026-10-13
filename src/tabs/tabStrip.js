/**
 * tabStrip.js — pure rules for the desktop document tab strip (Drawboard shell
 * audit, Chunk C, 2026-10-13). No React, no DOM: AppShell and TabBar call these
 * and tests/tabStrip.test.mjs pins them.
 *
 *  - which tabs a menu action closes, and which tab becomes active after;
 *  - which tabs hold work a close would lose (the same rule the reload warning
 *    uses: utils/beforeUnloadGuard.js), and the words of the one confirm;
 *  - the saved list of open tabs (per signed-in user, localStorage) and the
 *    plan that reopens it after a reload.
 */
import { shouldWarnBeforeUnloadForTab } from '../utils/beforeUnloadGuard.js';

export const TAB_SESSION_VERSION = 1;
const TAB_SESSION_PREFIX = 'survey.openTabs.v1:';
// A long session can hold many documents; past this the oldest are dropped.
export const TAB_SESSION_MAX_TABS = 40;

const isDocumentTab = (tab) => Boolean(tab) && !tab.isHome;

/** The ids of the tabs a menu action closes, in strip order. */
export function tabIdsForCloseAction(tabs, action, tabId) {
  const documentTabs = (Array.isArray(tabs) ? tabs : []).filter(isDocumentTab);
  if (action === 'close') return documentTabs.some((tab) => tab.id === tabId) ? [tabId] : [];
  if (action === 'closeOthers') return documentTabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id);
  if (action === 'closeAll') return documentTabs.map((tab) => tab.id);
  return [];
}

/**
 * The tab that is active after `closingIds` close. The active tab stays when it
 * survives. Otherwise the next document to its right takes over (what the old
 * single close did), else the nearest one to its left, else Home.
 */
export function pickActiveTabAfterClose(tabs, closingIds, activeTabId, homeTabId) {
  const closing = new Set(closingIds || []);
  const list = Array.isArray(tabs) ? tabs : [];
  if (!closing.has(activeTabId)) return activeTabId;
  const index = list.findIndex((tab) => tab.id === activeTabId);
  for (let i = index + 1; i < list.length; i += 1) {
    if (isDocumentTab(list[i]) && !closing.has(list[i].id)) return list[i].id;
  }
  for (let i = index - 1; i >= 0; i -= 1) {
    if (isDocumentTab(list[i]) && !closing.has(list[i].id)) return list[i].id;
  }
  return homeTabId;
}

/** The tabs among `closingIds` whose close would lose work. */
export function tabsWithUnsavedWork(tabs, closingIds) {
  const closing = new Set(closingIds || []);
  return (Array.isArray(tabs) ? tabs : [])
    .filter((tab) => closing.has(tab.id) && shouldWarnBeforeUnloadForTab(tab));
}

/**
 * The confirm a close needs, or null when it can go straight through.
 * Close all always asks once (Drawboard: "Close all open documents (N)?");
 * anything else asks only when a closing tab holds work that is not saved.
 */
export function closeConfirmFor({ tabs, closingIds, action }) {
  const count = (closingIds || []).length;
  const unsaved = tabsWithUnsavedWork(tabs, closingIds);
  const askAll = action === 'closeAll' && count > 1;
  if (!askAll && unsaved.length === 0) return null;

  let message = '';
  if (unsaved.length === 1) {
    message = `"${unsaved[0].name}" has changes that are not saved. Closing loses them.`;
  } else if (unsaved.length > 1) {
    message = `${unsaved.length} documents have changes that are not saved. Closing loses them.`;
  } else {
    message = 'They stay in Documents.';
  }

  let title;
  if (askAll) title = `Close all open documents (${count})?`;
  else if (count === 1) title = 'Close without saving?';
  else title = `Close ${count} documents?`;

  return {
    title,
    message,
    confirmLabel: unsaved.length ? 'Close without saving' : 'Close all',
    danger: unsaved.length > 0,
  };
}

/* ---------- saved open tabs ---------- */

/** A cloud document id the app can open again, or null. */
export function persistableDocumentId(tab) {
  if (!isDocumentTab(tab)) return null;
  const id = tab.file?.id ?? tab.documentId ?? null;
  if (id == null) return null;
  const text = String(id);
  // temp-… rows are uploads still in flight; they get a new id when they land.
  if (!text || text.startsWith('temp-')) return null;
  return text;
}

export function tabSessionStorageKey(userId) {
  return userId ? `${TAB_SESSION_PREFIX}${userId}` : null;
}

/** The open tabs as the small record kept in localStorage. */
export function serializeTabSession(tabs, activeTabId) {
  const entries = [];
  const seen = new Set();
  let active = null;
  for (const tab of Array.isArray(tabs) ? tabs : []) {
    const id = persistableDocumentId(tab);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    entries.push({ id, name: String(tab.name || '') });
    if (tab.id === activeTabId) active = id;
  }
  return {
    v: TAB_SESSION_VERSION,
    tabs: entries.slice(-TAB_SESSION_MAX_TABS),
    active,
  };
}

/** Reads the saved tabs; null for nothing saved, a bad record or no storage. */
export function readTabSession(storage, userId) {
  const key = tabSessionStorageKey(userId);
  if (!key || !storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== TAB_SESSION_VERSION || !Array.isArray(parsed.tabs)) return null;
    const tabs = parsed.tabs
      .filter((entry) => entry && typeof entry.id === 'string' && entry.id)
      .map((entry) => ({ id: entry.id, name: typeof entry.name === 'string' ? entry.name : '' }));
    return { v: TAB_SESSION_VERSION, tabs, active: typeof parsed.active === 'string' ? parsed.active : null };
  } catch {
    return null;
  }
}

/** Writes the saved tabs. Returns false when storage refused (private mode, full). */
export function writeTabSession(storage, userId, session) {
  const key = tabSessionStorageKey(userId);
  if (!key || !storage) return false;
  try {
    storage.setItem(key, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

/**
 * What to reopen: the saved documents that still exist in `documents` (the
 * signed-in user's library — deleted, archived and no-longer-shared documents
 * are not in it), in saved order, minus the ones already open.
 */
export function planTabRestore(session, documents, openTabs = []) {
  if (!session || !Array.isArray(session.tabs) || !session.tabs.length) {
    return { rows: [], activeDocumentId: null, skipped: [] };
  }
  const byId = new Map();
  for (const row of Array.isArray(documents) ? documents : []) {
    if (row?.id != null) byId.set(String(row.id), row);
  }
  const alreadyOpen = new Set(
    (Array.isArray(openTabs) ? openTabs : []).map(persistableDocumentId).filter(Boolean),
  );
  const rows = [];
  const skipped = [];
  for (const entry of session.tabs) {
    const row = byId.get(entry.id);
    if (!row) { skipped.push(entry.id); continue; }
    if (alreadyOpen.has(entry.id)) continue;
    alreadyOpen.add(entry.id);
    rows.push(row);
  }
  const activeDocumentId = session.active && rows.some((row) => String(row.id) === session.active)
    ? session.active
    : null;
  return { rows, activeDocumentId, skipped };
}

/** True when the library holds at least one real (not in-flight) document. */
export function libraryHasLoaded(documents) {
  return (Array.isArray(documents) ? documents : [])
    .some((row) => row?.id != null && !String(row.id).startsWith('temp-'));
}

/** A cloud document the signed-in user can rename from its tab. */
export function canRenameTab(tab, signedIn) {
  return Boolean(signedIn) && persistableDocumentId(tab) !== null;
}

/**
 * The restore / save rules of useTabSession, without React. One per AppShell.
 *
 * Account switch without a reload (Codex on #817): a session can expire and a
 * different person sign in while the strip still holds the first person's
 * tabs, and `documents` still holds the first person's library until the new
 * one arrives. So:
 *  - restore waits for a library that belongs to the signed-in user
 *    (`documentsUserId`, stamped where the library is loaded);
 *  - every tab belongs to the account that was signed in when it was opened,
 *    and only the signed-in user's own tabs are ever matched or written under
 *    that user's key. Another account's tab ids are never saved.
 */
export function createTabSessionController(getStorage) {
  let restoredFor = null;
  let lastWritten = null;
  // The commit that restores still holds the old strip; its write would
  // replace the saved list with it, so that one write is skipped.
  let skipWrite = false;
  let lastSignedIn = null;
  let tabOwner = new Map(); // tab id -> the user it was opened under

  const claim = (list, userId) => {
    const next = new Map();
    for (const tab of list) if (tab?.id != null) next.set(tab.id, tabOwner.get(tab.id) ?? userId);
    tabOwner = next;
  };
  const noteUser = (userId, tabs) => {
    const list = Array.isArray(tabs) ? tabs : [];
    // Tabs opened before a switch (or while signed out after it) stay with the
    // account that was signed in before.
    if (userId && lastSignedIn && userId !== lastSignedIn) claim(list, lastSignedIn);
    if (userId) {
      lastSignedIn = userId;
      claim(list, userId);
    }
  };
  const ownTabs = (tabs, userId) => (Array.isArray(tabs) ? tabs : [])
    .filter((tab) => tabOwner.get(tab?.id) === userId);

  return {
    /** Reopens the saved tabs once per signed-in user; returns the plan or null. */
    restore({ enabled = true, userId, documents, documentsUserId, tabs, onRestore }) {
      noteUser(userId, tabs);
      if (!enabled || !userId || restoredFor === userId) return null;
      if (documentsUserId !== userId || !libraryHasLoaded(documents)) return null;
      restoredFor = userId;
      lastWritten = null;
      skipWrite = false;
      const plan = planTabRestore(readTabSession(getStorage(), userId), documents, ownTabs(tabs, userId));
      if (plan.skipped.length) {
        console.info('[TabSession] skipped documents that are no longer available:', plan.skipped.length);
      }
      if (plan.rows.length) {
        skipWrite = true;
        try {
          onRestore?.(plan);
        } catch (error) {
          console.warn('[TabSession] restore failed', error);
        }
      }
      return plan;
    },
    /** Saves the signed-in user's own tabs; true when something was written. */
    save({ enabled = true, userId, tabs, activeTabId }) {
      noteUser(userId, tabs);
      if (!enabled || !userId || restoredFor !== userId) return false;
      if (skipWrite) { skipWrite = false; return false; }
      const session = serializeTabSession(ownTabs(tabs, userId), activeTabId);
      const text = JSON.stringify(session);
      if (text === lastWritten) return false;
      if (!writeTabSession(getStorage(), userId, session)) return false;
      lastWritten = text;
      return true;
    },
  };
}
