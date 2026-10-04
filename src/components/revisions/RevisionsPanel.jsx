// History panel (left-rail History tab; phone History sheet).
//
// RULED 2026-09-28 owner: History option A — an activity feed. The owner
// picked prototype A (w60, history-A.html) from docs/HISTORY-REDESIGN-PROPOSAL.md:
//   - one line per thing a person did, newest first, split by day (Today /
//     Yesterday / weekday / date); "Maya moved a rectangle", with the person,
//     time and page; the mark's own tool glyph at the left;
//   - repeat edits of one mark by one person close together fold into one line
//     ("moved a rectangle · 3 edits") that opens to each edit;
//   - filters Everyone / Only me / Deleted, and a search;
//   - clicking a line takes you to the mark: its page, zoomed so the mark fills
//     ~40% of the view, and draws the blue highlight around it where it is NOW
//     (pulses twice, fades); Up/Down step lines, Enter acts, Esc clears;
//   - pointing at a mark on the page marks its lines with a blue bar;
//   - a moved / resized / recolored line opens a Before / After peek (a ghost of
//     the old place or color on the page);
//   - a deleted line shows a dashed ghost where the mark was, with Restore in
//     the line and on the ghost. Restore is one undo step, writes a "restored"
//     line, respects locks and edit rights (viewers never see it) and, for a
//     Survey Marker, brings its Excel row back.
// House rules: dark theme, gold only for the selected line's glyph, glyph-only
// buttons with no plates, hairline rows (no card per row), plain words.
//
// RULED 2026-09-29 owner: cleaner History. Each line is a status dot (added
// blue, edited green, deleted red, restored teal — legend under the filters,
// the verb tinted to match, the words kept), the mark's glyph and one sentence,
// with a small "time · page" line under it. Details (colors, quoted text,
// "deleted later") and the line's buttons (Restore, Before / After) show only
// on the selected line. A mark picked on the page shows as one small chip;
// "Load older" is one quiet link at the end of the list. On the page the
// selected mark gets a plain highlight that covers all of it (no pulse), and
// a deleted mark a faint ghost with one small Restore on the highlight.
//
// Data (w55, unchanged): the first 50 rows, "Load older" pages further back, the
// open panel reads only rows that arrived since the newest shown (10 s, never
// while the tab is hidden), and every read is dropped if you switched
// documents meanwhile. Named versions stay hidden until rebuilt (w55 defect 3).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import Icon from '../../Icons';
import {
  createRevision,
  listRevisions,
  getRevision,
  restoreRevision,
} from '../../services/documentRevisionService';
import { listDocumentHistoryEvents, findDeletedSpaceHistoryEvent, isTrashHistoryEvent } from '../../services/documentHistoryService';
import { resolveRegionRestoreCascade, describeHistoryEventSubject } from '../../services/annotationTrashHistory';
import { claimBodyReadOnly } from '../../utils/readOnlyBodyReasons.js';
import {
  HISTORY_FILTERS,
  HISTORY_PEEK_KINDS,
  HISTORY_STATUS_LEGEND,
  buildHistoryFeed,
  historyClockLabel,
  historyColorName,
  historyMarkColor,
  historyRangeLabel,
  historyRowKey,
  historyRowMarkIds,
  historyRowTimeMs,
  historyShortVerb,
  latestDeleteRowByMark,
} from '../../utils/historyFeed.js';
import {
  HISTORY_MARK_LOOKUP_MAX_PAGES,
  HISTORY_PAGE_SELECTION_EVENT,
  historyMarkFilterEmptyText,
  historyMarkFilterLabel,
  historyRowsTouchMarks,
  mergePageSelections,
  selectionKey,
} from '../../utils/historyMarkFilter.js';
import { historyAnnotationBox, historyAnnotationInkBox, historyBulkGhosts, historyRowGhostAnnotation, historyUnionBox } from '../../utils/historyGeometry.js';
import { createHistoryPageOverlay, findMarkElements, measureMarkBox, measureMarksBox } from './historyPageOverlay.js';

const DRAWER_WIDTH = 360;
const HISTORY_PANEL_STYLE_ID = 'document-history-panel-style';
// w55: named versions ("Save version" / "Open read-only" / "Restore vN") are
// hidden until they are rebuilt on the live mark store: today they save and
// restore a table the viewer no longer reads, so Save records 0 marks,
// Restore changes nothing on the page, and Open shows today's marks.
const NAMED_VERSIONS_ENABLED = false;
// w55: History loads a page of rows at a time ("Load older" fetches the next),
// and refreshes by asking only for rows at or after the newest one it shows
// (minus a small overlap for rows that reach the server a little late).
const HISTORY_PAGE_SIZE = 50;
const HISTORY_REFRESH_OVERLAP_MS = 2 * 60 * 1000;

// How long the highlight on a mark you just restored stays before it fades.
const RESTORED_HIGHLIGHT_MS = 2600;

// UX (option A): the panel's own sheet — hairline rows edge to edge, no card
// per row, glyph-only controls with no plates (states.css), gold only on the
// selected line's glyph, the selection blue (#4a90e2) for the "pointing at
// this mark on the page" bar. Desktop sizes first; the phone sheet
// (.dh-panel--phone) only resizes (44px tap rows, 14px type).
function ensureHistoryPanelStyle() {
  if (typeof document === 'undefined' || document.getElementById(HISTORY_PANEL_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HISTORY_PANEL_STYLE_ID;
  style.textContent = `
    .dh-panel { --dh-edge: 12px; --dh-row-pad: 9px; --dh-type: 13px; --dh-meta: 12px; --dh-glyph: 18px;
      /* Status colors (RULED 2026-09-29 owner): added blue, edited green,
         deleted red, restored a light teal (lighter than the blue, so the two
         read apart). Dots only; the verb gets a light tint. */
      --dh-c-created: #4a90e2; --dh-c-edited: var(--success, #548c71); --dh-c-deleted: var(--danger, #d95a56);
      --dh-c-restored: #6fd3d8; --dh-c-other: var(--text-3);
      display: flex; flex-direction: column; min-height: 0; height: 100%; background: var(--surface-1); color: var(--text-2); }
    .dh-panel--phone { --dh-edge: var(--sheet-pad-x, 16px); --dh-row-pad: 11px; --dh-type: 14px; --dh-meta: 12px; --dh-glyph: 20px; background: var(--sheet-bg, var(--surface-2)); font-family: var(--sheet-font, inherit); }
    .dh-head { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 8px var(--dh-edge) 10px; border-bottom: 1px solid var(--border); }
    .dh-headrow { display: flex; align-items: center; gap: 8px; min-height: 28px; }
    .dh-count { flex: 1; display: flex; align-items: baseline; gap: 8px; color: var(--text-3); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dh-title { color: var(--text-1); font-size: 13px; font-weight: 600; }
    .dh-ib { width: 28px; height: 28px; display: grid; place-items: center; flex: none; padding: 0; border: 0; background: none; color: var(--text-3); cursor: pointer; }
    .dh-ib:hover { color: var(--text-1); }
    .dh-ib > * { transition: transform .08s; }
    .dh-ib:active > * { transform: scale(.86); }
    .dh-search { flex: 1; min-width: 0; height: 28px; border: 0; border-bottom: 1px solid var(--border); background: none; color: var(--text-1);
      font: inherit; font-size: 13px; padding: 0 2px; outline: none; -webkit-appearance: none; appearance: none; }
    .dh-search::-webkit-search-cancel-button { display: none; }
    .dh-search:focus { border-bottom-color: var(--text-3); }
    .dh-chips { display: flex; gap: 2px; background: var(--surface-0); padding: 2px; border-radius: 8px; }
    .dh-chip { flex: 1; border: 0; background: none; color: var(--text-3); padding: 5px 6px; border-radius: 6px; font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
    .dh-chip:hover { color: var(--text-1); }
    .dh-chip.on { background: var(--surface-3); color: var(--text-1); }
    .dh-legend { display: flex; flex-wrap: wrap; align-items: center; column-gap: 12px; row-gap: 2px; color: var(--text-3); font-size: 11px; line-height: 16px; }
    .dh-legend > span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
    .dh-legend i, .dh-st { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex: none; background: var(--dh-c, var(--dh-c-other)); }
    .dh-legend i { width: 6px; height: 6px; }
    .dh-panel [data-status="created"] { --dh-c: var(--dh-c-created); }
    .dh-panel [data-status="edited"] { --dh-c: var(--dh-c-edited); }
    .dh-panel [data-status="deleted"] { --dh-c: var(--dh-c-deleted); }
    .dh-panel [data-status="restored"] { --dh-c: var(--dh-c-restored); }
    .dh-panel [data-status="other"] { --dh-c: var(--dh-c-other); }
    .dh-markchip { display: inline-flex; align-items: center; align-self: flex-start; gap: 2px; max-width: 100%; min-width: 0;
      padding: 0 2px 0 10px; border-radius: 999px; background: var(--surface-3); color: var(--text-1); font-size: 12px; line-height: 24px; }
    .dh-markchip > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dh-markchip button { width: 22px; height: 22px; flex: none; display: grid; place-items: center; padding: 0; border: 0; background: none; color: var(--text-3); cursor: pointer; }
    .dh-markchip button:hover { color: var(--text-1); }
    .dh-body { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; outline: none; }
    .dh-day { position: sticky; top: 0; z-index: 2; padding: 12px var(--dh-edge) 6px; font-size: 11px; font-weight: 600; letter-spacing: 0;
      color: var(--text-3); background: inherit; border-bottom: 1px solid var(--border); }
    .dh-panel .dh-day { background: var(--surface-1); }
    .dh-panel--phone .dh-day { background: var(--surface-2); }
    .dh-row { position: relative; display: grid; grid-template-columns: 7px var(--dh-glyph) minmax(0, 1fr); column-gap: 9px; align-items: start;
      padding: var(--dh-row-pad) var(--dh-edge); border-bottom: 1px solid var(--border); cursor: pointer; }
    .dh-row .dh-st { margin-top: calc((var(--dh-type) * 1.35 - 7px) / 2); }
    .dh-row .dh-g { color: var(--text-3); line-height: 0; }
    .dh-row.sel .dh-g { color: var(--accent); }
    .dh-row .dh-s { color: var(--text-2); font-size: var(--dh-type); line-height: 1.35; overflow-wrap: anywhere; }
    .dh-row .dh-s b { color: var(--text-1); font-weight: 600; }
    .dh-row .dh-v { color: color-mix(in srgb, var(--dh-c, var(--text-2)) 45%, var(--text-1)); }
    .dh-row[data-status="other"] .dh-v { color: inherit; }
    .dh-row:hover .dh-s, .dh-row.sel .dh-s { color: var(--text-1); }
    .dh-row .dh-m { margin-top: 2px; color: var(--text-3); font-size: var(--dh-meta); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dh-row.linked::before { content: ""; position: absolute; left: 0; top: 5px; bottom: 5px; width: 3px; border-radius: 0 2px 2px 0; background: #4a90e2; }
    .dh-row.focus::after { content: ""; position: absolute; inset: 0; box-shadow: inset 0 0 0 1px rgba(74,144,226,.7); pointer-events: none; }
    .dh-row.del .dh-g { opacity: .7; }
    .dh-row.child { padding-left: calc(var(--dh-edge) + 16px); background: rgba(255,255,255,.015); }
    .dh-fold { display: inline-flex; align-items: center; gap: 2px; margin-left: 4px; padding: 0; border: 0; background: none; color: var(--text-3);
      font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; vertical-align: baseline; }
    .dh-fold:hover { color: var(--text-1); }
    .dh-fold > span:last-child { display: inline-grid; transition: transform .15s; }
    .dh-fold.open > span:last-child { transform: rotate(180deg); }
    .dh-sw { display: inline-flex; align-items: center; gap: 5px; margin-top: 6px; color: var(--text-3); font-size: 12px; }
    .dh-sw i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .dh-quote { margin-top: 6px; padding-left: 8px; border-left: 2px solid var(--border); color: var(--text-3); font-size: 12px; overflow-wrap: anywhere; }
    .dh-note { color: var(--text-3); font-size: var(--dh-meta); }
    .dh-detail { margin-top: 6px; }
    .dh-act { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 8px; }
    .dh-restore { display: inline-flex; align-items: center; gap: 5px; padding: 0; border: 0; background: none; color: var(--text-1);
      font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .dh-restore:hover { color: #4a90e2; }
    .dh-restore:disabled { color: var(--text-3); cursor: wait; }
    .dh-restore > span:first-child { display: inline-grid; transition: transform .08s; }
    .dh-restore:active > span:first-child { transform: scale(.86); }
    .dh-peek { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border-radius: 7px; background: var(--surface-0); }
    .dh-peek > span { padding: 0 6px 0 4px; color: var(--text-3); font-size: 11px; }
    .dh-peek button { border: 0; background: none; color: var(--text-3); font: inherit; font-size: 12px; padding: 3px 8px; border-radius: 5px; cursor: pointer; }
    .dh-peek button.on { background: var(--surface-3); color: var(--text-1); }
    .dh-empty { padding: 24px var(--dh-edge); color: var(--text-3); font-size: 13px; line-height: 1.5; }
    .dh-more { display: block; margin: 6px auto 10px; padding: 6px 10px; border: 0; background: none; color: var(--text-3);
      font: inherit; font-size: 12px; cursor: pointer; }
    .dh-more:hover { color: var(--text-1); }
    .dh-more:disabled { cursor: wait; }
    .dh-foot { flex: none; padding: 9px var(--dh-edge); border-top: 1px solid var(--border); color: var(--text-3); font-size: 12px; }
    .dh-link { padding: 0; border: 0; background: none; color: var(--text-2); font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
    .dh-link:hover { color: var(--text-1); }
    /* Phone: the shared PHONE SHEET SCALE (src/styles/tokens.css, owner
       2026-10-01 "consistency across all bottom panels") - a 16/700 title,
       12/600 day labels in sentence case (no caps or tracking on the phone),
       12px meta and the sheet's empty-state line. */
    .dh-panel--phone .dh-title { font: var(--sheet-title); }
    .dh-panel--phone .dh-day { font: var(--sheet-section); letter-spacing: 0; text-transform: none; }
    .dh-panel--phone .dh-empty { font: var(--sheet-empty); }
    .dh-panel--phone .dh-row .dh-m { font: var(--sheet-row-meta); }
    .dh-panel--phone .dh-row { min-height: 44px; }
    .dh-panel--phone .dh-chip { padding: 8px 6px; font-size: 13px; }
    .dh-panel--phone .dh-legend { font-size: 12px; }
    .dh-panel--phone .dh-markchip { font-size: 13px; line-height: 32px; }
    .dh-panel--phone .dh-markchip button { width: 32px; height: 32px; }
    .dh-panel--phone .dh-ib { width: 44px; height: 44px; margin-right: -8px; }
    .dh-panel--phone .dh-restore { font-size: 14px; min-height: 44px; }
    .dh-panel--phone .dh-peek button { padding: 10px 14px; font-size: 13px; }
    .dh-panel--phone .dh-fold { font-size: 13px; padding: 8px 0; margin: -8px 0 -8px 4px; }
    .dh-panel--phone .dh-more { min-height: 44px; font-size: 13px; }
    .dh-panel--phone .dh-body { padding-bottom: var(--mobile-bottom-inset, 10px); }
    .dh-panel--phone .dh-foot { padding-bottom: calc(var(--mobile-bottom-inset, 10px) + 8px); }
    @media (prefers-reduced-motion: reduce) { .dh-fold > span:last-child { transition: none; } }
  `;
  document.head.appendChild(style);
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${mo}-${da} ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

// Merge freshly read rows into the rows already shown (dedupe by client id,
// newest first). Rows already shown stay; a re-read row replaces its copy.
function mergeHistoryRowLists(current, incoming) {
  const byKey = new Map();
  for (const row of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const key = historyRowKey(row);
    if (key) byKey.set(key, row);
  }
  return Array.from(byKey.values()).sort((a, b) => historyRowTimeMs(b) - historyRowTimeMs(a));
}

function hasRestoreData(row) {
  return Boolean(
    row?.payload?.restoreAction
    || (row?.event_type === 'annotations_bulk_deleted'
      && Array.isArray(row?.payload?.objects)
      && row.payload.objects.length > 0),
  );
}

function boxCenter(box) {
  return box ? [box.x + box.width / 2, box.y + box.height / 2] : null;
}

export default function RevisionsPanel({
  documentId,
  user,
  embedded = false,
  // The phone History sheet: the same feed, sized for touch.
  mobileMode = false,
  // History-audit P1: when embedded, the sidebar keeps this panel mounted
  // behind display:none. isActive=false means the History tab is deselected
  // or the rail is collapsed — preview/highlight state must be torn down so
  // body[data-readonly] and the on-page ghosts can't outlive the panel.
  isActive = true,
  onClose = null,
  onNavigateToPage = null,
  onRestoreHistoryActivity = null,
  onCascadeRestoreRegion = null,
  // Decision 10 (KAL-90) / w55: a survey-scoped line moves you INTO its space /
  // module / category (never closes your survey panel or leaves your space).
  onRestoreHistoryContext = null,
  // w55: false for viewers and locked documents — Restore is never shown.
  canRestore = false,
  // Option A viewer hooks (PDFViewer, stable identities).
  getHistoryMarkIndex = null,
  locateHistoryMark = null,
  focusHistoryMark = null,
}) {
  const [open, setOpen] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [revisions, setRevisions] = useState([]);
  const [historyEvents, setHistoryEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [viewingRevision, setViewingRevision] = useState(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  // KAL-313 CONFIRM-CASCADE: pending cascade restore { regionEvent, spaceEvent }
  const [cascadePending, setCascadePending] = useState(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Option A view state.
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const [peekMode, setPeekMode] = useState('after');
  const [openFolds, setOpenFolds] = useState(() => new Set());
  const [linkedMarkId, setLinkedMarkId] = useState(null);
  // w64: the marks picked on the page ({ key, items }) — the list shows only
  // their lines until cleared — and the look-further-back state for them:
  // 'idle' | 'looking' | 'none' (nothing, looked back to the start) |
  // 'partial' (nothing in the pages looked through; Load older goes further).
  const [markFilter, setMarkFilter] = useState(null);
  const [markLookup, setMarkLookup] = useState('idle');
  const markFilterKeyRef = useRef('');
  // Each page layer's pick (pageNumber -> items), and the pick last applied.
  const pageSelectionRef = useRef(new Map());
  const appliedPickKeyRef = useRef('');
  // The pick whose newest line still has to be selected and scrolled to.
  const pendingMarkJumpRef = useRef('');
  // The selected line came from a pick on the page: never redraw its
  // Before / After ghosts while you work on that mark.
  const selectedFromPageRef = useRef(false);
  const selectedKeyRef = useRef(null);
  selectedKeyRef.current = selectedKey;
  // The line the pointer last MOVED onto (lines shifting under a still
  // pointer, e.g. when the selected line opens, never count as pointing).
  const hoveredKeyRef = useRef(null);
  const [listFocused, setListFocused] = useState(false);
  // The focus outline is for keyboard use only (never on a mouse click).
  const [keyboardNav, setKeyboardNav] = useState(false);
  const keyboardNavRef = useRef(false);
  // Bumped when marks change on the page, so Restore / "Back on the page
  // now" follow what is on the page now.
  const [, setMarksTick] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const hasLoadedRef = useRef(false);
  const historyEventsRef = useRef([]);
  historyEventsRef.current = historyEvents;
  // w55: each selection gets a number; retries and timers from an older one
  // check it and stop, so they can never replace the newer one's highlight.
  const activityClickSeqRef = useRef(0);
  // w55: the document the panel is showing NOW. Every async read checks it
  // before writing state, so a slow read for the previous document can never
  // land in (or restore into) the next one.
  const currentDocumentIdRef = useRef(documentId);
  currentDocumentIdRef.current = documentId;
  const refreshTimeoutRef = useRef(null);
  const overlayRef = useRef(null);
  const listRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  // Embedded panels stay mounted while hidden. Only the visible History
  // panel needs list reads, event refreshes, or the polling fallback.
  const shouldLoadHistory = isActive && (embedded || open);
  const panelVisible = embedded ? isActive : open;

  const overlay = useCallback(() => {
    if (!overlayRef.current) overlayRef.current = createHistoryPageOverlay();
    return overlayRef.current;
  }, []);

  // Resolve ownership once per (documentId, user) — matches the open-coded
  // owner check in _kal48_can_access: project owner OR document creator.
  useEffect(() => {
    let cancelled = false;
    setIsOwner(false);
    if (!NAMED_VERSIONS_ENABLED || !documentId || !user?.id || !supabase) return undefined;
    (async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('user_id, project_id, projects!documents_project_id_fkey(user_id)')
        .eq('id', documentId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setIsOwner(false);
        return;
      }
      const creatorOwner = data.user_id === user.id && !data.project_id;
      const projectOwner = data?.projects?.user_id === user.id;
      setIsOwner(Boolean(creatorOwner || projectOwner || data.user_id === user.id));
    })();
    return () => { cancelled = true; };
  }, [documentId, user?.id]);

  // Load list when drawer opens, when embedded in the left rail, or after a mutation.
  // w55: `full` reads the newest page from scratch (open / reopen); otherwise
  // only rows at or after the newest shown one are read and merged in, so the
  // 10 s refresh downloads what is new, not the whole list again.
  const refresh = useCallback(async (options = {}) => {
    if (!shouldLoadHistory) return;
    const full = options?.full === true || !hasLoadedRef.current;
    const silent = options?.silent === true || hasLoadedRef.current;
    if (!documentId) {
      setRevisions([]);
      setHistoryEvents([]);
      setHasOlder(false);
      hasLoadedRef.current = false;
      return;
    }
    if (!silent) setLoading(true);
    setErr(null);
    try {
      // Incremental: rows that ARRIVED on the server since the newest arrival
      // shown (created_at is set by the server), minus a small overlap.
      const serverRows = historyEventsRef.current.filter((row) => !row?.__local && row?.created_at);
      const newestArrival = full ? 0 : serverRows.reduce((max, row) => Math.max(max, Date.parse(row.created_at) || 0), 0);
      const arrivedSince = newestArrival
        ? new Date(Math.max(0, newestArrival - HISTORY_REFRESH_OVERLAP_MS)).toISOString()
        : null;
      const [rows, events] = await Promise.all([
        NAMED_VERSIONS_ENABLED ? listRevisions(documentId) : Promise.resolve([]),
        listDocumentHistoryEvents(documentId, arrivedSince ? { limit: 200, arrivedSince } : { limit: HISTORY_PAGE_SIZE }),
      ]);
      if (currentDocumentIdRef.current !== documentId) return; // switched documents meanwhile
      setRevisions(rows);
      setNowMs(Date.now());
      if (arrivedSince && Array.isArray(events) && events.length >= 200) {
        // Too much arrived to merge safely (a gap could open): start over.
        hasLoadedRef.current = false;
        await refresh({ full: true, silent: true });
        return;
      }
      if (arrivedSince) {
        setHistoryEvents((prev) => mergeHistoryRowLists(prev, events));
      } else {
        setHistoryEvents(events);
        setHasOlder(Array.isArray(events) && events.length >= HISTORY_PAGE_SIZE);
      }
      hasLoadedRef.current = true;
    } catch (e) {
      if (currentDocumentIdRef.current === documentId) setErr(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [documentId, shouldLoadHistory]);

  // w55: "Load older" — the next page below the oldest row shown. Deleted
  // items older than the first page stay reachable (and restorable).
  const loadOlder = useCallback(async () => {
    if (!documentId || loadingOlder) return;
    // The cursor is the oldest SERVER row (device-only rows have no server id).
    const serverRows = historyEventsRef.current.filter((row) => !row?.__local);
    const oldest = serverRows[serverRows.length - 1] || historyEventsRef.current[historyEventsRef.current.length - 1];
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const older = await listDocumentHistoryEvents(documentId, {
        limit: HISTORY_PAGE_SIZE,
        before: oldest.occurred_at || oldest.created_at,
        beforeId: oldest.__local ? null : oldest.id,
      });
      if (currentDocumentIdRef.current !== documentId) return;
      setHistoryEvents((prev) => mergeHistoryRowLists(prev, older));
      setHasOlder(Array.isArray(older) && older.length >= HISTORY_PAGE_SIZE);
    } catch (e) {
      setStatusMsg('Couldn’t load older changes. Try again.');
    } finally {
      setLoadingOlder(false);
    }
  }, [documentId, loadingOlder]);

  // A new document starts from an empty list and a fresh first page.
  useEffect(() => {
    hasLoadedRef.current = false;
    setHistoryEvents([]);
    setHasOlder(false);
    setSelectedKey(null);
    setOpenFolds(new Set());
    setLinkedMarkId(null);
    setCascadePending(null);
    setStatusMsg(null);
    setMarkFilter(null);
    setMarkLookup('idle');
    markFilterKeyRef.current = '';
    pendingMarkJumpRef.current = '';
  }, [documentId]);

  // Row styles are injected up front so the keyboard focus is visible from
  // the first Tab.
  useEffect(() => { ensureHistoryPanelStyle(); }, []);

  useEffect(() => {
    // Opening (or reopening) the panel reads the newest page from scratch.
    if (shouldLoadHistory) refresh({ full: true, silent: hasLoadedRef.current });
  }, [shouldLoadHistory, refresh]);

  useEffect(() => {
    if (!documentId || !shouldLoadHistory) return undefined;
    const handleRecorded = (event) => {
      if (event?.detail?.documentId && event.detail.documentId !== documentId) return;
      const row = event?.detail?.row;
      if (row?.client_event_id) {
        setNowMs(Date.now());
        setHistoryEvents((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          return [
            // Not yet a server copy: flagged so it never becomes a paging or
            // refresh cursor (its times come from this device's clock).
            { ...row, __local: true },
            ...list.filter((entry) => entry?.client_event_id !== row.client_event_id),
          ].sort((a, b) => new Date(b.occurred_at || b.created_at || 0) - new Date(a.occurred_at || a.created_at || 0));
        });
      }
      if (refreshTimeoutRef.current) window.clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = window.setTimeout(() => {
        refresh({ silent: true });
      }, 900);
    };
    window.addEventListener('document-history:event-recorded', handleRecorded);
    // w34 (2026-09-25): the 10 s poll only picks up other people's history
    // rows for someone looking at the panel. A backgrounded tab or minimised
    // window is not looking, so it skips the read (the next tick after it is
    // shown again catches up).
    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      refresh({ silent: true });
    }, 10000);
    return () => {
      window.removeEventListener('document-history:event-recorded', handleRecorded);
      window.clearInterval(intervalId);
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [documentId, shouldLoadHistory, refresh]);

  // body[data-readonly] mirroring — set when viewing a prior revision.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    if (viewingRevision) {
      const token = Symbol('revision-readonly');
      return claimBodyReadOnly(token, document);
    }
    return undefined;
  }, [viewingRevision]);

  const handleSave = useCallback(async () => {
    if (!documentId || busy) return;
    const label = window.prompt('Label for this revision (optional):', '');
    if (label === null) return; // user cancelled
    setBusy(true);
    setStatusMsg(null);
    try {
      const row = await createRevision(documentId, { label: label || null });
      setStatusMsg(`Saved revision v${row.revision_number}.`);
      await refresh();
    } catch (e) {
      setStatusMsg(`Save failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [documentId, refresh, busy]);

  const handleOpenReadOnly = useCallback(async (rev) => {
    if (busy) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const full = await getRevision(rev.id);
      setViewingRevision({ ...rev, snapshot: full?.snapshot_json || null });
    } catch (e) {
      setStatusMsg(`Open failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const handleReturnToCurrent = useCallback(() => {
    setViewingRevision(null);
  }, []);

  const handleRestore = useCallback(async (rev) => {
    if (busy) return;
    const ok = window.confirm(
      `Restore v${rev.revisionNumber}? The current state will be saved as an auto revision first, then overwritten by this snapshot.`,
    );
    if (!ok) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const pre = await restoreRevision(rev.id);
      setStatusMsg(`Restored v${rev.revisionNumber}. Previous state saved as v${pre.revision_number}.`);
      setViewingRevision(null);
      await refresh();
    } catch (e) {
      setStatusMsg('Couldn’t restore it. Try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  const clearPageMarks = useCallback(() => {
    activityClickSeqRef.current += 1;
    overlayRef.current?.clear();
  }, []);

  // History-audit P1: tear down preview + page marks whenever the panel stops
  // being visible (embedded panels stay mounted behind display:none).
  useEffect(() => {
    if (!panelVisible) {
      clearPageMarks();
      setViewingRevision(null);
      setSelectedKey(null);
      setLinkedMarkId(null);
      setMarkFilter(null);
      setMarkLookup('idle');
      markFilterKeyRef.current = '';
      pendingMarkJumpRef.current = '';
      // Reopening with the same mark still picked does not re-filter; a new
      // pick does.
      appliedPickKeyRef.current = selectionKey(mergePageSelections(pageSelectionRef.current));
    }
  }, [panelVisible, clearPageMarks]);

  // w55: switching documents clears the page marks and cancels pending retries.
  useEffect(() => () => { clearPageMarks(); }, [documentId, clearPageMarks]);
  useEffect(() => () => { overlayRef.current?.destroy(); overlayRef.current = null; }, []);

  // Option A: pointing at a mark on the page marks its lines (blue bar).
  // Marks are DOM elements in Select / Callout mode (canvas otherwise).
  useEffect(() => {
    if (!panelVisible || mobileMode || typeof document === 'undefined') return undefined;
    const MARK_SELECTOR = '[data-annotation-id],[data-anno-id],[data-callout-id],[data-survey-marker-id]';
    let current = null;
    const onOver = (event) => {
      const el = event.target?.closest?.(MARK_SELECTOR);
      const inPage = el && el.closest?.('svg[data-svg-annotation-layer], .survey-pdfjs-page-div');
      const id = inPage
        ? (el.getAttribute('data-annotation-id') || el.getAttribute('data-anno-id')
          || el.getAttribute('data-callout-id') || el.getAttribute('data-survey-marker-id') || null)
        : null;
      if (id === current) return;
      current = id;
      setLinkedMarkId(id);
    };
    document.addEventListener('pointerover', onOver, true);
    return () => document.removeEventListener('pointerover', onOver, true);
  }, [panelVisible, mobileMode]);

  // ---- the feed -----------------------------------------------------------
  const currentUserId = user?.id || null;
  const feed = useMemo(
    () => buildHistoryFeed(historyEvents, {
      currentUserId,
      filter,
      query,
      now: nowMs,
      markIds: markFilter ? markFilter.items.map((item) => item.id) : null,
    }),
    [historyEvents, currentUserId, filter, query, nowMs, markFilter],
  );
  const latestDeleteByMark = useMemo(() => latestDeleteRowByMark(historyEvents), [historyEvents]);
  const groupsByKey = useMemo(() => {
    const map = new Map();
    for (const item of feed.items) {
      if (item.type !== 'group') continue;
      map.set(item.group.key, { group: item.group, entries: item.group.entries });
      for (const entry of item.group.entries) {
        map.set(`e:${entry.key}`, { group: item.group, entries: [entry] });
      }
    }
    return map;
  }, [feed]);
  // The keys of the lines on screen, in order (Up / Down step through them).
  const visibleKeys = useMemo(() => {
    const keys = [];
    for (const item of feed.items) {
      if (item.type !== 'group') continue;
      keys.push(item.group.key);
      if (item.group.count > 1 && openFolds.has(item.group.key)) {
        for (const entry of [...item.group.entries].reverse()) keys.push(`e:${entry.key}`);
      }
    }
    return keys;
  }, [feed, openFolds]);

  // Which marks exist right now (null = the viewer can't tell; then every
  // delete line keeps its Restore, as before option A).
  const markIndex = typeof getHistoryMarkIndex === 'function' ? getHistoryMarkIndex() : null;
  const markPresent = (id) => (markIndex && id != null ? markIndex.has(String(id)) : null);

  // Restore state of a delete line: 'restore' | 'back' | null.
  const deleteLineState = (entry) => {
    if (!entry.isTrash) return null;
    const ids = entry.markIds;
    if (!markIndex || ids.length === 0) return 'restore';
    const missing = ids.filter((id) => !markIndex.has(String(id)));
    if (missing.length === 0) return 'back';
    // Only the newest delete of a mark offers Restore (an older one is history).
    const isLatest = missing.some((id) => historyRowKey(latestDeleteByMark.get(String(id))) === entry.key);
    return isLatest ? 'restore' : null;
  };

  // The trash line that brings a mark back (for "deleted later" lines).
  const restoreRowForMark = (markId) => (markId != null ? latestDeleteByMark.get(String(markId)) || null : null);

  // ---- page marks (highlight, ghosts, zoom) -----------------------------
  const markLiveNow = (markId) => {
    if (markId == null) return null;
    const present = markPresent(markId);
    if (present === false) return null;
    const located = typeof locateHistoryMark === 'function' ? locateHistoryMark(markId) : null;
    if (!located?.pageNumber) return present ? { pageNumber: null, box: null } : null;
    return { pageNumber: located.pageNumber, box: historyAnnotationBox(located.annotation), annotation: located.annotation };
  };

  const handleRestoreActivityRef = useRef(null);

  // Build and draw what a selected line shows on the page.
  const showSelection = useCallback((key, { zoom = true, peek = 'after', highlight = true, restoreContext = false } = {}) => {
    const found = groupsByKey.get(key);
    if (!found) return;
    const entries = found.entries;
    const first = entries[0];
    const last = entries[entries.length - 1];
    const clickSeq = ++activityClickSeqRef.current;
    const ov = overlay();
    ov.setHover(null);
    hoveredKeyRef.current = null;
    // Decision 10 / w55: a survey-scoped line moves you into its context
    // (never out of your survey panel or space) — on a click or Enter only,
    // never while stepping with the arrow keys.
    // w64: not while showing a picked mark's history — you are already there,
    // and switching survey context would drop the pick (and the filter).
    if (restoreContext && !markFilterKeyRef.current && typeof onRestoreHistoryContext === 'function') {
      try { onRestoreHistoryContext(last.row); } catch (_err) { /* best-effort */ }
    }
    const markId = last.markId || last.markIds[0] || null;
    const live = markLiveNow(markId);
    const trashRow = last.isTrash ? last.row : restoreRowForMark(markId);
    // A bulk delete shows every mark it removed that is still gone.
    const bulk = last.isTrash && last.row?.event_type === 'annotations_bulk_deleted';
    // Marks already back are highlighted, never ghosted or offered again.
    let bulkAll = [];
    let bulkGhosts = [];
    if (bulk) {
      bulkAll = historyBulkGhosts(last.row);
      bulkGhosts = bulkAll.filter((g) => markPresent(g.markId) !== true);
    }
    const ghostAnnotation = live || bulk ? null : historyRowGhostAnnotation(trashRow || last.row);
    const pageNumber = bulk
      ? (bulkGhosts[0] || bulkAll[0])?.pageNumber
      : (live?.pageNumber || last.page || first.page);
    if (!Number.isFinite(pageNumber)) {
      ov.setScene(null);
      ov.clearHighlight();
      return;
    }
    const pageGhosts = bulk
      ? bulkGhosts.filter((g) => g.pageNumber === pageNumber).map((g) => ({ annotation: g.annotation, box: historyAnnotationBox(g.annotation) }))
      : [];
    const ghostBox = bulk
      ? historyUnionBox((pageGhosts.length ? pageGhosts : bulkAll.filter((g) => g.pageNumber === pageNumber)
        .map((g) => ({ box: historyAnnotationBox(g.annotation) }))).map((g) => g.box))
      : (ghostAnnotation ? historyAnnotationBox(ghostAnnotation) : null);
    // Every mark the line is about (a group move highlights them all).
    const lineMarkIds = (last.markIds?.length ? last.markIds : (markId ? [markId] : [])).map(String);
    // Where the line's live marks are when they are not drawn as SVG right
    // now: their stored boxes grown by half their stroke (the page measures
    // what is drawn otherwise).
    const liveInkBox = live
      ? (historyUnionBox(lineMarkIds.map((id) => {
        const located = String(id) === String(markId)
          ? live
          : (typeof locateHistoryMark === 'function' ? locateHistoryMark(id) : null);
        return located?.pageNumber === live.pageNumber ? historyAnnotationInkBox(located.annotation) : null;
      })) || live.box)
      : null;
    // Zoom to what is drawn when the page is on screen (a stored box can be
    // off for some marks, e.g. a counter), else to the stored boxes — all of
    // the line's marks, so a group move lands with every mark in view.
    const drawnNow = live?.pageNumber && lineMarkIds.length && typeof document !== 'undefined'
      ? measureMarksBox(document, lineMarkIds, live.pageNumber)
      : null;
    const targetBox = drawnNow || liveInkBox || ghostBox;
    if (zoom) {
      // The phone sheet covers the bottom of the page: land the mark above it.
      const sheetTop = mobileMode ? panelRef.current?.getBoundingClientRect?.().top : null;
      const bottomInset = Number.isFinite(sheetTop) && typeof window !== 'undefined'
        ? Math.max(0, window.innerHeight - sheetTop)
        : 0;
      const focused = targetBox && typeof focusHistoryMark === 'function'
        ? focusHistoryMark(pageNumber, targetBox, { bottomInset })
        : false;
      if (!focused && typeof onNavigateToPage === 'function') {
        onNavigateToPage(pageNumber, { fallback: 'nearest', bypassActiveSpace: true });
      }
    }
    // The page may still be scrolling in / mounting: try for ~1 s.
    const draw = (attempt) => {
      if (clickSeq !== activityClickSeqRef.current) return; // a newer selection owns the page marks
      const measured = live && markId ? measureMarkBox(document, markId, pageNumber) : null;
      const pageReady = typeof document !== 'undefined'
        && document.querySelector(`svg[data-svg-annotation-layer="${pageNumber}"]`);
      if (!pageReady || (live && !measured && attempt < 4)) {
        if (attempt < 8) {
          window.setTimeout(() => draw(attempt + 1), 120);
          return;
        }
      }
      const restorable = canRestore && trashRow && hasRestoreData(trashRow) && Boolean(onRestoreHistoryActivity)
        // "Deleted later" never restores a whole bulk delete for one mark.
        && (last.isTrash || trashRow.event_type !== 'annotations_bulk_deleted');
      const restorePin = restorable
        ? { label: 'Restore', onClick: () => handleRestoreActivityRef.current?.(trashRow) }
        : null;
      // RULED 2026-09-29 owner: one highlight, one outline. The highlight
      // always sits on the thing you are looking at: the mark as it is now,
      // or its ghost (deleted, or peeking at Before). Ghosts carry no tags.
      let scene = null;
      let target = null;
      if (bulk && pageGhosts.length) {
        scene = { pageNumber, ghosts: pageGhosts };
        target = { pageNumber, ghosts: true, box: ghostBox, pin: restorePin };
      } else if (bulk) {
        // Every mark it removed is back: highlight them where they are.
        const ids = bulkAll.filter((g) => g.pageNumber === pageNumber && g.markId).map((g) => String(g.markId));
        target = { pageNumber, markIds: ids, box: ghostBox };
      } else if (!live && ghostAnnotation) {
        scene = { pageNumber, ghosts: [{ annotation: ghostAnnotation, box: ghostBox }] };
        target = { pageNumber, ghosts: true, box: historyAnnotationInkBox(ghostAnnotation) || ghostBox, pin: restorePin };
      } else if (live && HISTORY_PEEK_KINDS.has(last.kind) && first.row?.payload?.previewBefore) {
        const beforeAnnotation = first.row.payload.previewBefore;
        const beforeBox = historyAnnotationBox(beforeAnnotation);
        const nowBox = measured || live.box;
        const recolor = last.kind === 'recolored';
        const beforeColor = historyMarkColor(beforeAnnotation);
        if (peek === 'before') {
          // The old shape, solid in its old color; the mark as it is now fades.
          scene = {
            pageNumber,
            ghosts: [{ annotation: beforeAnnotation, box: beforeBox, solid: true, color: beforeColor || '#e6e8eb' }],
            dimElements: findMarkElements(document, markId),
          };
          target = { pageNumber, ghosts: true, box: historyAnnotationInkBox(beforeAnnotation) || beforeBox };
        } else {
          // A faint ghost of where / how it was (a color change has none: the
          // mark is in the same place, the line shows both colors).
          scene = recolor ? null : {
            pageNumber,
            ghosts: [{ annotation: beforeAnnotation, box: beforeBox }],
            trail: last.kind === 'moved' && beforeBox && nowBox ? { from: boxCenter(beforeBox), to: boxCenter(nowBox) } : null,
          };
          target = { pageNumber, markIds: lineMarkIds, box: liveInkBox };
        }
      } else if (live) {
        target = { pageNumber, markIds: lineMarkIds, box: liveInkBox };
      } else if (targetBox) {
        target = { pageNumber, box: targetBox };
      }
      ov.setScene(scene);
      if (!target) {
        if (highlight) ov.clearHighlight();
      } else if (highlight) {
        ov.setHighlight(target);
      } else {
        ov.updateHighlight(target);
      }
    };
    draw(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsByKey, overlay, onRestoreHistoryContext, focusHistoryMark, onNavigateToPage, canRestore, onRestoreHistoryActivity, markIndex, latestDeleteByMark, locateHistoryMark, mobileMode]);

  const selectLine = useCallback((key, options = {}) => {
    selectedFromPageRef.current = false;
    setSelectedKey(key);
    setPeekMode('after');
    setStatusMsg(null);
    showSelection(key, { zoom: true, peek: 'after', ...options });
    scrollToSelectedRef.current = key;
  }, [showSelection]);

  // The selected line opens (its details and buttons show) and the previous
  // one closes, so bring it into view only once that layout is on screen —
  // stepping with Up / Down never leaves its buttons below the edge.
  const scrollToSelectedRef = useRef(null);
  useLayoutEffect(() => {
    const key = scrollToSelectedRef.current;
    if (!key || key !== selectedKey) return;
    scrollToSelectedRef.current = null;
    const el = listRef.current?.querySelector?.(`[data-key="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(key) : key}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedKey]);

  const clearSelection = useCallback(() => {
    setSelectedKey(null);
    clearPageMarks();
  }, [clearPageMarks]);

  // ---- w64: a mark picked on the page shows its history ------------------
  const clearMarkFilter = useCallback(() => {
    markFilterKeyRef.current = '';
    pendingMarkJumpRef.current = '';
    setMarkFilter(null);
    setMarkLookup('idle');
    if (selectedFromPageRef.current) {
      selectedFromPageRef.current = false;
      setSelectedKey(null);
    }
  }, []);

  // Look further back, a page at a time (bounded), for the picked marks'
  // lines. Stops when they turn up, when there is nothing older, when the
  // pick changes or when you switch documents.
  const lookBackForMarks = useCallback(async (key, ids) => {
    if (!documentId || !key) return;
    const idSet = new Set(ids.map(String));
    setMarkLookup('looking');
    let found = false;
    let more = true;
    try {
      for (let page = 0; page < HISTORY_MARK_LOOKUP_MAX_PAGES && more && !found; page += 1) {
        const serverRows = historyEventsRef.current.filter((row) => !row?.__local);
        const oldest = serverRows[serverRows.length - 1];
        if (!oldest) { more = false; break; }
        // eslint-disable-next-line no-await-in-loop
        const older = await listDocumentHistoryEvents(documentId, {
          limit: HISTORY_PAGE_SIZE,
          before: oldest.occurred_at || oldest.created_at,
          beforeId: oldest.id,
        });
        if (currentDocumentIdRef.current !== documentId || markFilterKeyRef.current !== key) return;
        const list = Array.isArray(older) ? older : [];
        more = list.length >= HISTORY_PAGE_SIZE;
        // Keep the ref in step now, so the next page's cursor is right.
        historyEventsRef.current = mergeHistoryRowLists(historyEventsRef.current, list);
        setHistoryEvents((prev) => mergeHistoryRowLists(prev, list));
        setHasOlder(more);
        found = historyRowsTouchMarks(list, idSet, historyRowMarkIds);
      }
    } catch (_err) {
      if (markFilterKeyRef.current === key) setMarkLookup('partial');
      return;
    }
    if (markFilterKeyRef.current !== key) return;
    setMarkLookup(found ? 'idle' : (more ? 'partial' : 'none'));
  }, [documentId]);

  const applyPagePick = useCallback((items) => {
    const key = selectionKey(items);
    if (key === appliedPickKeyRef.current) return;
    appliedPickKeyRef.current = key;
    if (!key) {
      // Deselecting on the page ends the filter.
      if (markFilterKeyRef.current) clearMarkFilter();
      return;
    }
    // Part of a multi-pick went away (its page scrolled out of view, a paste
    // moved it) while you were reading a line you clicked: keep your line,
    // only narrow the list.
    const previousIds = markFilterKeyRef.current ? markFilterKeyRef.current.split('|') : [];
    const shrinking = previousIds.length > 0 && items.every((item) => previousIds.includes(item.id));
    markFilterKeyRef.current = key;
    setMarkFilter({ key, items });
    if (shrinking && !selectedFromPageRef.current && selectedKeyRef.current) return;
    pendingMarkJumpRef.current = key;
    setQuery('');
    setMarkLookup('idle');
    // A new pick starts with no line selected, so its newest line is the one
    // selected next (never left blank by the old line being filtered out).
    setSelectedKey(null);
    activityClickSeqRef.current += 1;
    overlayRef.current?.clear();
  }, [clearMarkFilter]);

  // Every page layer reports its pick; this keeps the latest per page (even
  // while the panel is hidden) and, while it is showing, follows the pick.
  const panelVisibleRef = useRef(panelVisible);
  panelVisibleRef.current = panelVisible;
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onPick = (event) => {
      const pageNumber = Number(event?.detail?.pageNumber);
      if (!Number.isFinite(pageNumber)) return;
      const items = Array.isArray(event.detail.items) ? event.detail.items : [];
      if (items.length) pageSelectionRef.current.set(pageNumber, items);
      else pageSelectionRef.current.delete(pageNumber);
      if (!panelVisibleRef.current) return;
      applyPagePick(mergePageSelections(pageSelectionRef.current));
    };
    window.addEventListener(HISTORY_PAGE_SELECTION_EVENT, onPick);
    return () => window.removeEventListener(HISTORY_PAGE_SELECTION_EVENT, onPick);
  }, [applyPagePick]);

  // Select the newest line for the pick and bring it into view — without
  // moving the page or taking focus from it (arrow keys keep nudging the
  // mark). Not loaded yet: look further back.
  useEffect(() => {
    const firstGroup = markFilter ? feed.items.find((item) => item.type === 'group')?.group || null : null;
    // While you keep working on the picked mark (a nudge, a color change),
    // its newest line stays the selected one.
    if (!pendingMarkJumpRef.current && markFilter && selectedFromPageRef.current
      && selectedKey && firstGroup && firstGroup.key !== selectedKey) {
      setSelectedKey(firstGroup.key);
      if (listRef.current) listRef.current.scrollTop = 0;
      return;
    }
    const key = pendingMarkJumpRef.current;
    if (!key || !markFilter || markFilter.key !== key || !hasLoadedRef.current) return;
    if (firstGroup) {
      pendingMarkJumpRef.current = '';
      selectedFromPageRef.current = true;
      activityClickSeqRef.current += 1;
      overlayRef.current?.clear();
      setSelectedKey(firstGroup.key);
      if (markLookup !== 'idle') setMarkLookup('idle');
      const list = listRef.current;
      if (list && typeof window !== 'undefined') {
        const nextFrame = typeof window.requestAnimationFrame === 'function'
          ? (fn) => window.requestAnimationFrame(fn)
          : (fn) => fn();
        nextFrame(() => {
          const sel = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(firstGroup.key) : firstGroup.key;
          const el = list.querySelector?.(`[data-key="${sel}"]`);
          if (!el) { list.scrollTop = 0; return; }
          const listBox = list.getBoundingClientRect();
          const box = el.getBoundingClientRect();
          const DAY_HEADER = 34; // the sticky day heading sits over the top
          if (box.top < listBox.top + DAY_HEADER || box.bottom > listBox.bottom) {
            list.scrollTop = Math.max(0, list.scrollTop + (box.top - listBox.top) - DAY_HEADER);
          }
        });
      }
      return;
    }
    if (markLookup === 'partial' && !hasOlder) { setMarkLookup('none'); return; }
    if (markLookup !== 'idle') return; // looking now, or already looked
    if (hasOlder) lookBackForMarks(key, markFilter.items.map((item) => item.id));
    else setMarkLookup('none');
  }, [feed, markFilter, markLookup, hasOlder, lookBackForMarks, selectedKey]);

  // w55: Esc clears the highlight (and the open line's ghosts).
  useEffect(() => {
    if (typeof window === 'undefined' || !panelVisible) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      if (e.target?.closest?.('input, textarea, [contenteditable]')) return;
      // w64: Esc also ends "Showing history for this …".
      if (markFilterKeyRef.current) clearMarkFilter();
      if (!selectedKey && !overlayRef.current?.hasHighlight?.()) {
        overlayRef.current?.setHover(null);
        return;
      }
      clearSelection();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panelVisible, selectedKey, clearSelection, clearMarkFilter]);

  const handleRestoreActivity = useCallback(async (event) => {
    if (!event || typeof onRestoreHistoryActivity !== 'function' || busy) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const result = onRestoreHistoryActivity(event);
      if (result?.ok) {
        const spaceName = event.event_type === 'space_deleted'
          ? (event.payload?.spaceName ?? event.payload?.restoreAction?.spaceName)
          : null;
        // Marks and Survey Markers come back as one undo step; spaces and
        // regions have no undo step, so no Undo hint for them.
        const undoable = !['space_deleted', 'region_deleted'].includes(event.event_type)
          && Number.isFinite(Number(result.pageNumber)) && Number(result.pageNumber) > 0;
        setStatusMsg(event.event_type === 'space_deleted'
          ? `Restored the space${spaceName ? ` “${spaceName}”` : ''}.`
          : `Restored${result.pageNumber ? ` on page ${result.pageNumber}` : ''}.${undoable ? ' Undo takes it back.' : ''}`);
        if (listRef.current) listRef.current.scrollTop = 0;
        // Back to the whole feed, the restored mark highlighted where it is.
        setFilter((prev) => (prev === 'deleted' ? 'all' : prev));
        setSelectedKey(null);
        clearPageMarks();
        const markId = event.annotation_id || event.payload?.annotationId || event.payload?.restoreAction?.markerId || null;
        const page = Number(result.pageNumber);
        if (markId && Number.isFinite(page) && page > 0) {
          const seq = activityClickSeqRef.current;
          window.setTimeout(() => {
            if (seq !== activityClickSeqRef.current) return;
            const located = typeof locateHistoryMark === 'function' ? locateHistoryMark(markId) : null;
            // The restored mark, highlighted where it is (it fades on its own:
            // no line is selected now).
            overlay().setHighlight({
              pageNumber: page,
              markIds: [String(markId)],
              box: historyAnnotationInkBox(located?.annotation),
              lifetimeMs: RESTORED_HIGHLIGHT_MS,
            });
          }, 160);
        }
        await refresh({ silent: true });
      } else if (result?.reason === 'cascade-confirm') {
        // KAL-313 CONFIRM-CASCADE: the region's parent space is gone.
        const { spaceId } = result;
        let cascade = resolveRegionRestoreCascade({
          spaceId,
          liveSpaces: [], // not available here — we use historyEvents to find the space record
          historyEvents,
        });
        let spaceEvent = historyEvents.find(
          (ev) => ev.event_type === 'space_deleted' && ev.payload?.restoreAction?.spaceId === spaceId,
        );
        // w55: the space's delete row may be older than the rows loaded so far
        // — ask the server before saying there is no restore record.
        if (!spaceEvent) {
          spaceEvent = await findDeletedSpaceHistoryEvent(documentId, spaceId);
          if (currentDocumentIdRef.current !== documentId) return;
          if (spaceEvent) cascade = 'cascade';
        }
        if (cascade === 'cascade' && spaceEvent) {
          setCascadePending({ regionEvent: event, spaceEvent });
          setStatusMsg(null);
        } else {
          setStatusMsg("Can't restore this region: its space was deleted and can't be brought back.");
        }
      } else if (result?.reason === 'restore-noop') {
        setStatusMsg("It's already on the page, so nothing changed.");
      } else if (result?.reason === 'permission') {
        setStatusMsg('You can look at History here but not restore.');
      } else if (result?.reason === 'restore-conflict') {
        setStatusMsg("Couldn't restore it: it changed since. Try again.");
      } else {
        setStatusMsg("This can't be restored.");
      }
    } catch (e) {
      setStatusMsg('Couldn’t restore it. Try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, documentId, onRestoreHistoryActivity, refresh, historyEvents, clearPageMarks, locateHistoryMark, overlay]);
  handleRestoreActivityRef.current = handleRestoreActivity;

  // KAL-313: Execute the confirmed cascade restore (space first, then region).
  const handleCascadeConfirm = useCallback(async () => {
    if (!cascadePending || typeof onCascadeRestoreRegion !== 'function') return;
    const { regionEvent, spaceEvent } = cascadePending;
    setCascadePending(null);
    setBusy(true);
    setStatusMsg(null);
    try {
      const result = onCascadeRestoreRegion(spaceEvent, regionEvent);
      if (result?.ok) {
        setStatusMsg(`Restored the space and its region${result.pageNumber ? ` on page ${result.pageNumber}` : ''}.`);
        await refresh({ silent: true });
      } else {
        setStatusMsg("Couldn't restore both. Try again.");
      }
    } catch (e) {
      setStatusMsg('Couldn’t restore it. Try again.');
    } finally {
      setBusy(false);
    }
  }, [cascadePending, onCascadeRestoreRegion, refresh]);

  // Marks changed on the page (a save, an erase, a restore): re-read which
  // marks exist so Restore / "Back on the page now" are right at once.
  useEffect(() => {
    if (!panelVisible || typeof window === 'undefined') return undefined;
    const bump = () => setMarksTick((n) => n + 1);
    window.addEventListener('annotations:fabric-save-action', bump);
    return () => window.removeEventListener('annotations:fabric-save-action', bump);
  }, [panelVisible]);

  // A search or filter that hides the open line closes it (and its ghosts).
  useEffect(() => {
    if (selectedKey && !visibleKeys.includes(selectedKey)) {
      setSelectedKey(null);
      clearPageMarks();
    }
  }, [visibleKeys, selectedKey, clearPageMarks]);

  // Re-draw the open line's ghosts when the marks change (a restore, an undo,
  // a teammate's edit arriving) without moving the view.
  const markIndexForEffect = markIndex;
  useEffect(() => {
    if (!selectedKey || !panelVisible) return;
    if (!groupsByKey.has(selectedKey)) return;
    if (selectedFromPageRef.current) return; // w64: you are working on this mark
    showSelection(selectedKey, { zoom: false, peek: peekMode, highlight: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markIndexForEffect]);

  const timelineRevisions = useMemo(() => (NAMED_VERSIONS_ENABLED ? revisions : []), [revisions]);

  // w55: this early return must stay BELOW every hook — the sidebar keeps the
  // panel mounted, and a document id going null -> set used to change the
  // hook count and crash the sidebar.
  if (!documentId) return null;

  const toggleFold = (key) => {
    setOpenFolds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Up / Down step lines (and show each on the page); Enter acts on the line
  // (Restore, or open / close its edits); Esc clears. Keys stay in the list so
  // they never nudge a selected mark on the page.
  const handleListKeyDown = (e) => {
    if (e.target?.closest?.('button, input')) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (!keyboardNavRef.current) { keyboardNavRef.current = true; setKeyboardNav(true); }
      if (visibleKeys.length === 0) return;
      const at = visibleKeys.indexOf(selectedKey);
      const next = e.key === 'ArrowDown'
        ? visibleKeys[Math.min(visibleKeys.length - 1, at + 1)]
        : visibleKeys[Math.max(0, at < 0 ? 0 : at - 1)];
      if (next && next !== selectedKey) selectLine(next);
      return;
    }
    if (e.key === 'Enter' && selectedKey) {
      e.preventDefault();
      e.stopPropagation();
      const el = listRef.current?.querySelector?.(`[data-key="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(selectedKey) : selectedKey}"]`);
      const action = el?.querySelector?.('[data-restore]') || el?.querySelector?.('[data-fold]');
      if (action) action.click();
      else showSelection(selectedKey, { zoom: true, peek: peekMode, restoreContext: true });
      return;
    }
    if (e.key === 'Escape' && selectedKey) {
      e.preventDefault();
      e.stopPropagation();
      if (markFilterKeyRef.current) clearMarkFilter();
      clearSelection();
    }
  };

  // Pointing at a line shows the same highlight, quieter — never a second
  // outline on the line that is already open.
  const hoverLine = (entry, key = null) => {
    if (mobileMode) return;
    const ov = overlay();
    if (!entry || (key && key === selectedKey)) { ov.setHover(null); return; }
    const markId = entry.markId || entry.markIds[0] || null;
    const open = selectedKey ? groupsByKey.get(selectedKey) : null;
    if (open) {
      const openIds = new Set(open.entries.flatMap((item) => item.markIds.map(String)));
      if ((entry.markIds || []).some((id) => openIds.has(String(id)))) { ov.setHover(null); return; }
    }
    const live = markLiveNow(markId);
    if (live?.pageNumber) {
      const markIds = (entry.markIds?.length ? entry.markIds : [markId]).map(String);
      ov.setHover({ pageNumber: live.pageNumber, markIds, box: historyAnnotationInkBox(live.annotation) || live.box });
      return;
    }
    const ghost = historyRowGhostAnnotation(entry.isTrash ? entry.row : (restoreRowForMark(markId) || entry.row));
    const box = ghost ? historyAnnotationInkBox(ghost) : null;
    ov.setHover(box && entry.page ? { pageNumber: entry.page, box } : null);
  };

  // Only a real pointer move counts (the browser also sends moves with no
  // movement when lines shift under a still pointer).
  const pointAtLine = (event, entry, key) => {
    if (!event.movementX && !event.movementY) return;
    if (hoveredKeyRef.current === key) return;
    hoveredKeyRef.current = key;
    hoverLine(entry, key);
  };

  const renderSentence = (entry) => (
    <>
      <b>{entry.actorShort}</b>
      {' '}
      <span className="dh-v">{entry.verb}</span>
      {entry.noun ? ` ${entry.noun}` : ''}
      {entry.suffix ? ` ${entry.suffix}` : ''}
    </>
  );

  const renderDetail = (entry, firstEntry = entry) => {
    const payload = entry.row?.payload || {};
    if (entry.kind === 'recolored') {
      const before = historyMarkColor(firstEntry.row?.payload?.previewBefore);
      const after = historyMarkColor(payload.previewAnnotation);
      if (!before && !after) return null;
      return (
        <div className="dh-sw">
          {before && <><i style={{ background: before }} />{historyColorName(before)}</>}
          <span style={{ opacity: 0.6 }}>to</span>
          {after && <><i style={{ background: after }} />{historyColorName(after)}</>}
        </div>
      );
    }
    if (entry.kind === 'textEdited' || (entry.kind === 'created' && (entry.typeKey === 'text' || entry.typeKey === 'callout'))) {
      const text = payload.previewAnnotation?.text || payload.previewAnnotation?.data?.text;
      if (typeof text === 'string' && text.trim()) {
        const trimmed = text.trim().length > 90 ? `${text.trim().slice(0, 89)}…` : text.trim();
        return <div className="dh-quote">“{trimmed}”</div>;
      }
      return null;
    }
    if (entry.kind === 'locked') {
      return <div className="dh-note dh-detail">No one can change or delete it until it’s unlocked.</div>;
    }
    if (entry.row?.event_type === 'space_deleted' || entry.row?.event_type === 'region_deleted') {
      const subject = describeHistoryEventSubject(entry.row);
      return subject && !entry.noun.includes('“') ? <div className="dh-note dh-detail">{subject}</div> : null;
    }
    return null;
  };

  const restoreButton = (row) => (
    <button
      type="button"
      className="dh-restore"
      data-restore="1"
      data-testid={`document-history-restore-${row.id}`}
      disabled={busy}
      aria-label="Restore: put it back where it was"
      onClick={(e) => {
        e.stopPropagation();
        handleRestoreActivity(row);
      }}
    >
      <span><Icon name="rotateCcw" size={mobileMode ? 17 : 15} /></span>
      Restore
    </button>
  );

  const peekToggle = () => (
    <span className="dh-peek" role="group" aria-label="Show on the page">
      <span>Peek</span>
      {['before', 'after'].map((mode) => (
        <button
          key={mode}
          type="button"
          className={peekMode === mode ? 'on' : ''}
          aria-pressed={peekMode === mode}
          data-testid={`document-history-peek-${mode}`}
          onClick={(e) => {
            e.stopPropagation();
            setPeekMode(mode);
            showSelection(selectedKey, { zoom: false, peek: mode, highlight: false });
          }}
        >
          {mode === 'before' ? 'Before' : 'After'}
        </button>
      ))}
    </span>
  );

  // RULED 2026-09-29 owner: cleaner History. A line is: status dot, the
  // mark's glyph, one sentence, "time · page". Its details and buttons show
  // only while it is the selected line.
  const renderGroup = (group) => {
    const e = group.last;
    const first = group.first;
    const key = group.key;
    const selected = selectedKey === key;
    const folded = group.count > 1;
    const isOpen = folded && openFolds.has(key);
    const markId = e.markId || e.markIds[0] || null;
    const present = markPresent(markId);
    const actions = [];
    // Restore only on deleted items, only for people who can edit (w55).
    const isDeleted = isTrashHistoryEvent(e.row);
    const canRestoreDeleted = isDeleted && canRestore && Boolean(onRestoreHistoryActivity) && hasRestoreData(e.row);
    if (selected && isDeleted) {
      const state = deleteLineState(e);
      if (state === 'back') actions.push(<span key="back" className="dh-note">Back on the page now</span>);
      else if (state === 'restore' && canRestoreDeleted) actions.push(<span key="restore">{restoreButton(e.row)}</span>);
    } else if (selected && present === false && markId) {
      actions.push(<span key="later" className="dh-note">This mark was deleted later.</span>);
      const trash = restoreRowForMark(markId);
      if (trash && canRestore && Boolean(onRestoreHistoryActivity) && hasRestoreData(trash)) {
        actions.push(<span key="restore">{restoreButton(trash)}</span>);
      }
    }
    if (selected && present !== false && HISTORY_PEEK_KINDS.has(e.kind) && first.row?.payload?.previewBefore) {
      actions.push(<span key="peek">{peekToggle()}</span>);
    }
    const time = folded ? historyRangeLabel(first.ms, e.ms, nowMs) : historyClockLabel(e.ms, nowMs);
    const linked = linkedMarkId != null && group.entries.some((entry) => entry.markIds.includes(String(linkedMarkId)));
    const rows = [(
      <div
        key={key}
        id={`dh-line-${key}`}
        className={`dh-row${selected ? ' sel' : ''}${isDeleted ? ' del' : ''}${linked ? ' linked' : ''}${selected && listFocused && keyboardNav ? ' focus' : ''}`}
        data-key={key}
        data-mark={markId || ''}
        data-kind={e.kind}
        data-status={e.status}
        data-testid={`document-history-event-${e.row.id}`}
        role="option"
        aria-selected={selected}
        onClick={() => { keyboardNavRef.current = false; setKeyboardNav(false); selectLine(key, { restoreContext: true }); }}
        onMouseMove={(ev) => pointAtLine(ev, e, key)}
        onMouseLeave={() => { hoveredKeyRef.current = null; hoverLine(null); }}
      >
        <i className="dh-st" aria-hidden="true" />
        <span className="dh-g" aria-hidden="true"><Icon name={e.glyph} size={mobileMode ? 20 : 18} /></span>
        <div>
          <div className="dh-s">
            {renderSentence(e)}
            {folded && (
              <button
                type="button"
                className={`dh-fold${isOpen ? ' open' : ''}`}
                data-fold="1"
                aria-expanded={isOpen}
                data-testid="document-history-fold"
                onClick={(ev) => {
                  ev.stopPropagation();
                  toggleFold(key);
                  selectLine(key, { restoreContext: true });
                }}
              >
                <span>· {group.count} edits</span>
                <span><Icon name="chevronDown" size={12} /></span>
              </button>
            )}
          </div>
          <div className="dh-m">{time}{e.page ? ` · p. ${e.page}` : ''}</div>
          {selected && renderDetail(e, first)}
          {actions.length > 0 && <div className="dh-act">{actions}</div>}
        </div>
      </div>
    )];
    if (isOpen) {
      for (const child of [...group.entries].reverse()) {
        const childKey = `e:${child.key}`;
        const childSelected = selectedKey === childKey;
        rows.push(
          <div
            key={childKey}
            id={`dh-line-${childKey}`}
            className={`dh-row child${childSelected ? ' sel' : ''}${linked ? ' linked' : ''}${childSelected && listFocused && keyboardNav ? ' focus' : ''}`}
            data-key={childKey}
            data-mark={markId || ''}
            data-kind={child.kind}
            data-status={child.status}
            role="option"
            aria-selected={childSelected}
            onClick={() => { keyboardNavRef.current = false; setKeyboardNav(false); selectLine(childKey, { restoreContext: true }); }}
            onMouseMove={(ev) => pointAtLine(ev, child, childKey)}
            onMouseLeave={() => { hoveredKeyRef.current = null; hoverLine(null); }}
          >
            <span aria-hidden="true" />
            <span className="dh-g" aria-hidden="true"><Icon name={child.glyph} size={15} /></span>
            <div>
              <div className="dh-s">{historyShortVerb(child.kind)}</div>
              <div className="dh-m">{historyClockLabel(child.ms, nowMs)}</div>
              {childSelected && renderDetail(child)}
              {childSelected && present !== false && HISTORY_PEEK_KINDS.has(child.kind) && child.row?.payload?.previewBefore && (
                <div className="dh-act">{peekToggle()}</div>
              )}
            </div>
          </div>,
        );
      }
    }
    return rows;
  };

  const emptyText = query.trim()
    ? 'Nothing matches that search.'
    : filter === 'me'
      ? 'You haven’t changed anything in this document yet.'
      : filter === 'deleted'
        ? (canRestore
          ? 'Nothing has been deleted. Deleted marks show up here so you can bring them back.'
          : 'Nothing has been deleted.')
        : 'No changes yet. What people add, move, change or delete shows up here.';


  const panel = (
    <div
      ref={panelRef}
      data-testid="kal48-revisions-panel"
      className={`dh-panel${mobileMode ? ' dh-panel--phone' : ''}`}
      style={{
        position: embedded ? 'relative' : 'fixed',
        right: embedded ? 'auto' : 0,
        top: embedded ? 'auto' : 0,
        bottom: embedded ? 'auto' : 0,
        width: embedded ? '100%' : DRAWER_WIDTH,
        height: embedded ? '100%' : 'auto',
        zIndex: embedded ? 'auto' : 9050,
        boxShadow: embedded ? 'none' : '-4px 0 16px rgba(0,0,0,0.5)',
        borderLeft: embedded ? 0 : '1px solid var(--border)',
      }}
    >
      {/* Header (layout B: no title — the tab names the panel): how many
          lines, search on the right; the filters under it. */}
      <div className="dh-head">
        <div className="dh-headrow">
          {searchOpen ? (
            <input
              ref={searchRef}
              className="dh-search"
              data-testid="document-history-search"
              type="search"
              placeholder="Search history"
              value={query}
              onChange={(e) => {
                if (markFilterKeyRef.current) clearMarkFilter();
                setQuery(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setQuery('');
                  setSearchOpen(false);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  listRef.current?.focus();
                  if (visibleKeys[0]) selectLine(visibleKeys[0]);
                }
              }}
            />
          ) : (
            <span className="dh-count">
              <span className="dh-title">History</span>
              <span data-testid="document-history-count">{feed.groupCount === 1 ? '1 entry' : `${feed.groupCount} entries`}</span>
            </span>
          )}
          <button
            type="button"
            className="dh-ib"
            data-glyph-only=""
            aria-label={searchOpen ? 'Close search' : 'Search history'}
            onClick={() => {
              if (searchOpen) { setQuery(''); setSearchOpen(false); } else {
                setSearchOpen(true);
                window.setTimeout(() => searchRef.current?.focus(), 0);
              }
            }}
          >
            <span><Icon name={searchOpen ? 'close' : 'search'} size={mobileMode ? 20 : 17} /></span>
          </button>
          {!embedded && (
            <button
              type="button"
              className="dh-ib"
              data-glyph-only=""
              onClick={() => {
                setOpen(false);
                if (onClose) onClose();
              }}
              aria-label="Close version history panel"
            >
              <span><Icon name="close" size={17} /></span>
            </button>
          )}
        </div>
        <div className="dh-chips" role="group" aria-label="Show">
          {HISTORY_FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={!markFilter && filter === option.id}
              className={`dh-chip${!markFilter && filter === option.id ? ' on' : ''}`}
              data-testid={`document-history-filter-${option.id}`}
              onClick={() => {
                if (markFilter) clearMarkFilter();
                setFilter(option.id);
                clearSelection();
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        {markFilter ? (
          // A mark picked on the page: one small chip (its × clears it).
          <div className="dh-markchip" data-testid="document-history-mark-filter" role="status">
            <span>{historyMarkFilterLabel(markFilter.items)}</span>
            <button
              type="button"
              data-glyph-only=""
              data-testid="document-history-mark-filter-clear"
              aria-label="Clear: show all history"
              title="Show all history"
              onClick={clearMarkFilter}
            >
              <Icon name="close" size={mobileMode ? 15 : 13} />
            </button>
          </div>
        ) : (
          // What the dots mean (the words on each line say it too).
          <div className="dh-legend" data-testid="document-history-legend">
            {HISTORY_STATUS_LEGEND.map((item) => (
              <span key={item.id} data-status={item.id}><i aria-hidden="true" />{item.label}</span>
            ))}
          </div>
        )}
      </div>

      <div
        ref={listRef}
        className="dh-body"
        role="listbox"
        aria-label="History"
        aria-activedescendant={selectedKey ? `dh-line-${selectedKey}` : undefined}
        tabIndex={0}
        data-testid="document-history-list"
        onKeyDown={handleListKeyDown}
        onFocus={() => setListFocused(true)}
        onBlur={() => setListFocused(false)}
      >
        {(loading || (!hasLoadedRef.current && !err)) && historyEvents.length === 0 && <div className="dh-empty">Loading…</div>}
        {err && historyEvents.length === 0 && (
          <div className="dh-empty">Couldn’t reach the server. History will try again in a few seconds.</div>
        )}
        {!loading && !err && hasLoadedRef.current && feed.items.length === 0 && (
          <div className="dh-empty" data-testid="document-history-empty">
            {!markFilter
              ? emptyText
              : markLookup === 'none'
                ? historyMarkFilterEmptyText(markFilter.items, { searchedAll: true })
                : markLookup === 'partial'
                  ? historyMarkFilterEmptyText(markFilter.items, { searchedAll: false })
                  : 'Looking…'}
          </div>
        )}
        {feed.items.map((item) => (item.type === 'day'
          ? <div key={item.key} className="dh-day">{item.label}</div>
          : renderGroup(item.group)))}
        {timelineRevisions.map((rev) => (
          <div key={`revision:${rev.id}`} className="dh-row" data-testid={`kal48-revision-row-${rev.revisionNumber}`}>
            <span aria-hidden="true" />
            <span className="dh-g" aria-hidden="true"><Icon name="history" size={18} /></span>
            <div>
              <div className="dh-s"><b>v{rev.revisionNumber}</b>{rev.label ? ` ${rev.label}` : ''}</div>
              <div className="dh-m"><span>{formatDate(rev.createdAt)}</span></div>
              <div className="dh-act">
                <button type="button" className="dh-restore" data-testid={`kal48-open-v${rev.revisionNumber}`} disabled={busy} onClick={() => handleOpenReadOnly(rev)}>Open</button>
                {isOwner && (
                  <button type="button" className="dh-restore" data-testid={`kal48-restore-v${rev.revisionNumber}`} disabled={busy} onClick={() => handleRestore(rev)}>Restore</button>
                )}
              </div>
            </div>
          </div>
        ))}
        {hasOlder && (
          // One quiet link at the end of the list.
          <button
            type="button"
            className="dh-more"
            data-testid="document-history-load-older"
            onClick={loadOlder}
            disabled={loadingOlder}
          >
            {loadingOlder ? 'Loading…' : 'Load older'}
          </button>
        )}
      </div>

      {(statusMsg || (NAMED_VERSIONS_ENABLED && isOwner)) && (
        <div className="dh-foot">
          {statusMsg && <div className="dh-status" data-testid="kal48-status" role="status">{statusMsg}</div>}
          {NAMED_VERSIONS_ENABLED && isOwner && (
            <button type="button" className="dh-link" data-testid="kal48-save-revision" onClick={handleSave} disabled={busy}>Save version</button>
          )}
        </div>
      )}
    </div>
  );

  // KAL-313 CONFIRM-CASCADE modal — shared across embedded and non-embedded renders.
  const cascadeModal = cascadePending ? (
    <div
      data-testid="cascade-restore-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cascade-restore-heading"
      onClick={(e) => { if (e.target === e.currentTarget) setCascadePending(null); }}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 9200,
        // UX (KAL-62): the app's one modal scrim — warm-dark dim plus an 8px
        // blur, so a cascade-restore confirm carries the same weight as every
        // other dialog rather than a flat black dim.
        background: 'var(--overlay-scrim)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'confirm-delete-modal-fade-in 120ms cubic-bezier(0,0,0.2,1)',
      }}
    >
      <div
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-dialog)',
          boxShadow: 'var(--shadow-dialog)',
          width: '100%',
          maxWidth: 480,
          margin: '0 16px',
          padding: 24,
          fontFamily: 'var(--font-primary, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          color: 'var(--text-2)',
        }}
      >
        <h2 id="cascade-restore-heading" style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-2)' }}>
          Restore this region?
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-3)', lineHeight: 1.5 }}>
          {"This region's space was deleted too. Restore both?"}
          {cascadePending.spaceEvent?.payload?.spaceName
            ? ` (Space: "${cascadePending.spaceEvent.payload.spaceName}")`
            : ''}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            type="button"
            data-testid="cascade-restore-cancel"
            onClick={() => setCascadePending(null)}
            style={{
              fontSize: 13,
              background: 'transparent',
              color: 'var(--text-3)',
              border: '1px solid var(--border-strong)',
              borderRadius: 4,
              padding: '6px 14px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="cascade-restore-confirm"
            onClick={handleCascadeConfirm}
            style={{
              fontSize: 13,
              background: 'var(--surface-3)',
              // House rule: no gold rings — a raised neutral button.
              color: 'var(--text-1)',
              border: 0,
              borderRadius: 4,
              padding: '6px 14px',
              cursor: 'pointer',
            }}
          >
            Restore both
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // History F3: the read-only banner renders in both modes (named versions only).
  const viewingBanner = viewingRevision ? (
    <div
      data-testid="kal48-readonly-banner"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        background: 'var(--surface-3)',
        color: 'var(--text-1)',
        padding: '8px 16px',
        zIndex: 9100,
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <span>
        Viewing version {viewingRevision.revisionNumber}
        {viewingRevision.label ? ` — ${viewingRevision.label}` : ''} · {formatDate(viewingRevision.createdAt)}. Editing is off.
      </span>
      <button
        type="button"
        data-testid="kal48-return-to-current"
        onClick={handleReturnToCurrent}
        className="dh-link"
      >
        Back to now
      </button>
    </div>
  ) : null;

  if (embedded) return <>{panel}{viewingBanner}{cascadeModal}</>;

  return (
    <>
      {/* Launcher */}
      <button
        type="button"
        data-testid="kal48-revisions-launcher"
        onClick={() => setOpen((v) => !v)}
        style={{
          position: 'fixed',
          right: 14,
          bottom: 80,
          zIndex: 9000,
          background: 'var(--surface-2)',
          color: 'var(--text-2)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 12,
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}
        title="History"
      >
        History
      </button>
      {viewingBanner}
      {open && panel}
      {cascadeModal}
    </>
  );
}
