import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  TOOLBAR_SLOTS,
  planFormatRow,
  planTextRow,
  planTextRowStep,
  planTopBar,
  textRowWidth,
  slotDefinition,
} from '../utils/responsiveToolbar.js';
import { getViewerSideOccluders, subscribeViewerSideOccluders } from '../utils/viewerSideOverlay.js';

/**
 * Responsive desktop tool bar (w42; rows flipped w44) — measures the tool bar
 * and the formatting row below it and hands back both plans (see
 * src/utils/responsiveToolbar.js for the order each gives ground in and why).
 *
 * Intended UX: nothing in either row ever overlaps or slides under a side
 * panel, at any desktop width, and neither row flickers while it adapts. The
 * plans are worked out in a layout effect after every render (before the
 * browser paints) and again, forced through synchronously, whenever the bar
 * changes width, so a narrowing window never shows a frame of overlapping
 * controls.
 *
 * Widths of each setting are remembered per look (full / compact) the first
 * time it is drawn that way, so a setting moved into More (and therefore not in
 * the row to measure) still counts at its real width when the window widens
 * again. The first guess, before a setting has ever been drawn, is its token
 * width from TOOLBAR_SLOTS.
 *
 * DOM contract:
 *   inside the tool bar (`hostRef`):
 *     [data-undo-redo-controls]      Undo / Redo, pinned left
 *     [data-toolbar-export]          Export (optional)
 *     [data-tool-toolbar]            the Draw / Shapes / Text icons (w47:
 *                                    centred on the column between the rails
 *                                    — the formatting row's host — and fixed
 *                                    there; an open side panel never moves
 *                                    them, owner 2026-10-01)
 *     [data-toolbar-left-block]      Pan / Select and their rule, hung off
 *                                    the icons' left edge (w48)
 *     [data-toolbar-subtools]        the loadout, hanging off the icons'
 *                                    right edge; NOT read by the plan, so it
 *                                    never moves anything
 *   inside the formatting row (`formatRowRef`, display:none while hidden):
 *     [data-chrome-settings-holder]  the settings; its in-flow children, and
 *                                    those of [data-toolbar-settings-row], are
 *                                    the row. .chrome-divider = a rule;
 *                                    [data-toolbar-slot=id] = a setting that
 *                                    may collapse or move ([data-toolbar-compact]
 *                                    says which look it is in now,
 *                                    [data-toolbar-can-compact="false"] that it
 *                                    may not collapse right now);
 *                                    [data-toolbar-slot-divider=id] a rule that
 *                                    goes wherever its setting goes;
 *                                    [data-toolbar-more] the More button.
 *   side panels over the row: registered with viewerSideOverlay (the Pages and
 *   Survey panels), counted while their data-viewer-occluder is "side".
 *
 * `overflowSlotsRef.current` lists the settings the last render put in More
 * (id + divider flag), since those are not in the row to be found.
 */

export const DEFAULT_TOOLBAR_PLAN = Object.freeze({
  anchor: 'center',
  shift: 0,
  clusterLeft: null,
  formatLeft: null,
  formatUsableLeft: 0,
  textRowLeft: null,
  // Owner Test 41 (2026-10-04): how far the text bar (row 3) has given ground
  // in a narrow row — see TEXT_ROW_STEPS in utils/responsiveToolbar.js.
  textRowStep: 'full',
  tight: false,
  compact: [],
  overflow: [],
  fits: true,
});

const near = (a, b) => (a === b || (a !== null && b !== null && Math.abs(a - b) < 0.5));

const samePlan = (a, b) => (
  a.anchor === b.anchor
  && near(a.shift, b.shift)
  && near(a.formatLeft, b.formatLeft)
  && near(a.formatUsableLeft ?? 0, b.formatUsableLeft ?? 0)
  && near(a.textRowLeft, b.textRowLeft)
  && a.textRowStep === b.textRowStep
  && a.tight === b.tight
  && a.compact.join('|') === b.compact.join('|')
  && a.overflow.join('|') === b.overflow.join('|')
);

const CANONICAL = TOOLBAR_SLOTS.map((slot) => slot.id);

function rowFromDom(holder, cache, overflowSlots) {
  const entries = [];
  const visit = (element) => {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.position === 'absolute' || style.position === 'fixed') return;
    if (element.hasAttribute('data-toolbar-more')) return;
    if (element.hasAttribute('data-toolbar-settings-row')) {
      [...element.children].forEach(visit);
      return;
    }
    if (element.classList.contains('chrome-divider')) {
      entries.push({ kind: 'divider', slot: element.getAttribute('data-toolbar-slot-divider') || undefined });
      return;
    }
    const width = element.getBoundingClientRect().width;
    const slot = element.getAttribute('data-toolbar-slot');
    if (!slot) {
      if (width > 0) entries.push({ kind: 'item', width });
      return;
    }
    const look = element.getAttribute('data-toolbar-compact') === 'true' ? 'compact' : 'full';
    const known = cache.get(slot) || {};
    if (width > 0) cache.set(slot, { ...known, [look]: width });
    entries.push({
      kind: 'item',
      slot,
      canCompact: element.getAttribute('data-toolbar-can-compact') !== 'false',
    });
  };
  [...holder.children].forEach(visit);

  // Settings sitting in More are not in the row: put them back where the row
  // draws them, so the plan can weigh bringing them back.
  for (const { id, divider, canCompact = true } of overflowSlots) {
    if (entries.some((entry) => entry.slot === id)) continue;
    const order = CANONICAL.indexOf(id);
    let at = entries.length;
    for (let i = 0; i < entries.length; i += 1) {
      const other = entries[i].slot ? CANONICAL.indexOf(entries[i].slot) : -1;
      if (entries[i].slot && entries[i].kind === 'item' && other > order) {
        at = i;
        while (at > 0 && entries[at - 1].kind === 'divider' && entries[at - 1].slot === entries[i].slot) at -= 1;
        break;
      }
    }
    // Its "may collapse" flag comes from the render that moved it: a pill
    // reading "Mixed" in More would read "Mixed" back in the row too.
    const inserted = [{ kind: 'item', slot: id, canCompact }];
    if (divider) inserted.unshift({ kind: 'divider', slot: id });
    entries.splice(at, 0, ...inserted);
  }

  return entries.map((entry) => {
    if (!entry.slot || entry.kind !== 'item') return entry;
    const definition = slotDefinition(entry.slot) || {};
    const known = cache.get(entry.slot) || {};
    const full = known.full ?? definition.fullWidth ?? 80;
    const compact = known.compact ?? definition.compactWidth ?? full;
    return { ...entry, widths: { full, compact } };
  });
}

/**
 * The part of a rect no side panel covers, in that rect's coordinates. A
 * panel counts when it overlaps the rect's height and touches its left or
 * right edge (the Pages panel on the left, the Survey panel on the right).
 * `rowRect` is { left, top, bottom, width } in window coordinates.
 */
function usableRowSpan(rowRect) {
  let left = 0;
  let right = rowRect.width;
  for (const panel of getViewerSideOccluders()) {
    if (!panel?.isConnected || panel.getAttribute?.('data-viewer-occluder') !== 'side') continue;
    const r = panel.getBoundingClientRect();
    if (!(r.width > 1) || r.bottom <= rowRect.top + 1 || r.top >= rowRect.bottom - 1) continue;
    const pl = r.left - rowRect.left;
    const pr = r.right - rowRect.left;
    if (pr <= 0 || pl >= rowRect.width) continue;
    if (pl <= 1) left = Math.max(left, pr);
    else if (pr >= rowRect.width - 1) right = Math.min(right, pl);
  }
  // Panels that together cover the whole row leave nothing to plan in: fall
  // back to the whole row rather than a negative span. Any real gap, however
  // narrow, is honoured — the settings then move into More instead of
  // running under a panel (tests/responsiveToolbar.test.mjs pins it).
  if (right - left <= 0) return { left: 0, right: rowRect.width };
  return { left, right };
}

export default function useResponsiveToolbar({ hostRef, formatRowRef, enabled, overflowSlotsRef }) {
  const [plan, setPlan] = useState(DEFAULT_TOOLBAR_PLAN);
  const planRef = useRef(plan);
  planRef.current = plan;
  const cacheRef = useRef(new Map());
  // A guard against a plan ping-ponging between two answers (it should not:
  // every width it reads is fixed per look). Counts the plan changes made
  // before the browser gets to paint; past a few it stops re-planning until
  // the next frame, so a bad measurement can never lock the page up.
  const churnRef = useRef({ count: 0, frameRequested: false });
  const contentWatchRef = useRef({ observer: null, holder: null });

  const measureAndPlan = useCallback(() => {
    const host = hostRef.current;
    if (!host || typeof window === 'undefined') return false;
    const hostRect = host.getBoundingClientRect();
    if (hostRect.width <= 0) return false;
    const rel = (element, edge) => (element ? element.getBoundingClientRect()[edge] - hostRect.left : null);
    const undo = host.querySelector('[data-undo-redo-controls]');
    // RULED 2026-09-27 owner: Pan/Select beside the groups (w48). Pan /
    // Select hang off the icons' left edge; the plan keeps them clear of
    // Undo/Redo. Their block is the same width in every state.
    const leftBlock = host.querySelector('[data-toolbar-left-block]');
    const exportButton = host.querySelector('[data-toolbar-export]');
    const cluster = host.querySelector('[data-tool-toolbar]');
    if (!cluster) return false;
    const clusterRect = cluster.getBoundingClientRect();

    // RULED 2026-09-26 owner: fixed centred groups + animated loadouts (w47).
    // The group icons centre on the column between the two slim rails (the
    // host the lower rows live in). Nothing read here depends on the tool,
    // the pick or the loadout showing, so the icons never move with them.
    // Owner 2026-10-01 (desktop chrome): "when I expand any of the rails ...
    // it pushes the top bar ... Those should not get affected by the left or
    // right rails." An open side panel (Pages / Search / Bookmarks / Spaces /
    // Survey) is NOT taken off that column any more: the panels open below
    // the tool bar, never over it, so the icons, Pan / Select and the loadout
    // stay put while a panel opens or closes. Only the window width (Undo /
    // Redo and Export) can slide them. Rows 2 and 3 centre under the icons
    // too; they only slide off that centre if an open panel would otherwise
    // cover them (usableRowSpan below).
    const formatRow = formatRowRef?.current;
    const column = formatRow?.parentElement || null;
    const columnRect = column?.getBoundingClientRect();
    let canvasLeft = 0;
    let canvasRight = hostRect.width;
    if (columnRect && columnRect.width > 0) {
      canvasLeft = columnRect.left - hostRect.left;
      canvasRight = columnRect.right - hostRect.left;
    }
    // Where the icons sit with no shift: their box less the shift drawn now.
    const drawnShift = -(parseFloat(cluster.style.left) || 0);
    const top = planTopBar({
      barWidth: hostRect.width,
      startRight: rel(undo, 'right') ?? 0,
      leftBlockWidth: leftBlock ? leftBlock.getBoundingClientRect().width : 0,
      exportLeft: rel(exportButton, 'left') ?? hostRect.width - 10,
      clusterWidth: clusterRect.width,
      spanLeft: canvasLeft,
      spanRight: canvasRight,
      clusterNaturalLeft: clusterRect.left - hostRect.left + drawnShift,
    });

    // The formatting row: planned only while it is on screen. A hidden row
    // keeps its last plan, and is re-planned before the frame that shows it.
    const current = planRef.current;
    let format = {
      formatLeft: current.formatLeft,
      formatUsableLeft: current.formatUsableLeft,
      textRowLeft: current.textRowLeft,
      textRowStep: current.textRowStep,
      tight: current.tight,
      compact: current.compact,
      overflow: current.overflow,
      fits: current.fits,
    };
    const holder = formatRow?.querySelector('[data-chrome-settings-holder]');
    const rowRect = formatRow?.getBoundingClientRect();
    if (holder && rowRect && rowRect.width > 0) {
      const row = rowFromDom(holder, cacheRef.current, overflowSlotsRef?.current || []);
      const span = usableRowSpan(rowRect);
      // RULED 2026-09-27 owner: rows 2/3 centred, animated (w48). The
      // settings centre under the group icons (RULED 2026-09-28: a move is
      // not animated; row 2 crossfades in place — useRowCrossfade).
      const centre = hostRect.left + top.clusterLeft + clusterRect.width / 2 - rowRect.left;
      const input = { usableLeft: span.left, usableRight: span.right, centre, row };
      let next = planFormatRow(input);
      // Centred on the width the row is DRAWN at once this plan is on screen:
      // when the plan keeps what is drawn now, that is the measured width
      // (exact); otherwise the worked-out one, corrected on the next pass.
      const keepsDrawn = next.tight === current.tight
        && next.compact.join('|') === current.compact.join('|')
        && next.overflow.join('|') === current.overflow.join('|');
      if (keepsDrawn) next = planFormatRow({ ...input, width: holder.getBoundingClientRect().width });
      // A row whose controls have not changed never moves: a pixel of
      // sub-pixel measuring noise is not a reason to re-centre.
      const formatLeft = Number.isFinite(current.formatLeft) && Math.abs(next.left - current.formatLeft) <= 1
        ? current.formatLeft
        : next.left;
      format = {
        formatLeft,
        formatUsableLeft: Math.round(span.left),
        textRowLeft: current.textRowLeft,
        textRowStep: current.textRowStep,
        tight: next.tight,
        compact: next.compact,
        overflow: next.overflow,
        fits: next.fits,
      };
    }
    // The text bar (row 3, the Aa bar): centred like row 2 (w48), planned
    // only while it is on screen, from its controls' drawn width (the caption
    // hangs out of the flow and does not count).
    const textBar = column?.querySelector('[data-chrome-text-format-row] [data-rich-text-toolbar]');
    const textBarRect = textBar?.getBoundingClientRect();
    if (textBar && textBarRect.width > 0) {
      const boxes = [...textBar.children]
        .filter((child) => {
          const style = window.getComputedStyle(child);
          return style.display !== 'none' && style.position !== 'absolute' && style.position !== 'fixed';
        })
        .map((child) => child.getBoundingClientRect())
        .filter((box) => box.width > 0);
      if (boxes.length) {
        const span = usableRowSpan(textBarRect);
        // Owner Test 41 (2026-10-04): the bar gives ground step by step in a
        // narrow row (or beside an open side panel) instead of running under
        // the rail. The step depends only on the room, never on the bar's own
        // width, so it cannot flip back and forth.
        const verticalAlign = textBar.getAttribute('data-text-row-valign') !== 'false';
        const textRowStep = planTextRowStep(span.right - span.left, { verticalAlign }).step;
        // Centred on the width drawn now while the step is unchanged (exact);
        // on a step change, on the new step's known width — the next pass,
        // after it is drawn, measures it.
        const drawnWidth = Math.max(...boxes.map((b) => b.right)) - Math.min(...boxes.map((b) => b.left));
        const textRowLeft = planTextRow({
          usableLeft: span.left,
          usableRight: span.right,
          centre: hostRect.left + top.clusterLeft + clusterRect.width / 2 - textBarRect.left,
          width: textRowStep === current.textRowStep ? drawnWidth : textRowWidth(textRowStep, { verticalAlign }),
          caption: textRowStep !== 'no-caption',
        });
        format.textRowStep = textRowStep;
        format.textRowLeft = Number.isFinite(current.textRowLeft) && Math.abs(textRowLeft - current.textRowLeft) <= 1
          ? current.textRowLeft
          : textRowLeft;
      }
    }
    const next = { ...top, ...format };
    if (samePlan(next, planRef.current)) return false;
    const churn = churnRef.current;
    if (churn.count >= 4) return false;
    churn.count += 1;
    if (!churn.frameRequested) {
      churn.frameRequested = true;
      window.requestAnimationFrame(() => { churn.count = 0; churn.frameRequested = false; });
    }
    planRef.current = next;
    setPlan(next);
    return true;
  }, [hostRef, formatRowRef, overflowSlotsRef]);

  // Every render: the armed tool, the selection or a "Mixed" label may have
  // changed what the formatting row holds, or shown / hidden the row.
  useLayoutEffect(() => {
    if (!enabled) return;
    measureAndPlan();
    // The settings holder is portalled into the row after the row mounts (and
    // again if the row is rebuilt): keep the size watcher on the live one.
    const holder = formatRowRef?.current?.querySelector('[data-chrome-settings-holder]') || null;
    const watch = contentWatchRef.current;
    if (watch.observer && holder !== watch.holder) {
      if (watch.holder) watch.observer.unobserve(watch.holder);
      if (holder) watch.observer.observe(holder);
      watch.holder = holder;
    }
  });

  // The window (or split view) changed width: re-plan before the next paint.
  useEffect(() => {
    if (!enabled || typeof ResizeObserver === 'undefined') return undefined;
    const host = hostRef.current;
    if (!host) return undefined;
    let lastWidth = -1;
    const observer = new ResizeObserver((records) => {
      const width = records[records.length - 1]?.contentRect?.width ?? -1;
      if (width === lastWidth) return;
      lastWidth = width;
      flushSync(() => { measureAndPlan(); });
    });
    observer.observe(host);
    // The settings can also change width with no render of ours (a web font
    // arriving, a lazy control finishing), and the row itself changes width
    // when the viewer column does: re-plan when either does.
    const formatRow = formatRowRef?.current;
    const sizes = new Map();
    const contentObserver = new ResizeObserver((records) => {
      let changed = false;
      for (const record of records) {
        const width = record.contentRect?.width ?? -1;
        if (Math.abs(width - (sizes.get(record.target) ?? -1)) >= 0.5) changed = true;
        sizes.set(record.target, width);
      }
      if (changed) measureAndPlan();
    });
    if (formatRow) contentObserver.observe(formatRow);
    // w47: the loadout (the group's tools the viewer draws into the tool
    // bar) no longer moves anything, so its width changing is not watched.
    const holder = formatRow?.querySelector('[data-chrome-settings-holder]') || null;
    if (holder) contentObserver.observe(holder);
    contentWatchRef.current = { observer: contentObserver, holder };
    // A side panel opening, closing or being resized over the row: re-plan so
    // the settings never sit under it.
    const panelObserver = new ResizeObserver(() => measureAndPlan());
    // A panel's attributes flip as it STARTS to slide: planning against its
    // mid-slide box would step the colours twice. While it is animating, wait
    // for its transitionend (below) and plan once against where it settles.
    const isAnimating = (element) => {
      try {
        return (element.getAnimations?.() || []).some((a) => a.playState === 'running');
      } catch { return false; }
    };
    const attributeObserver = typeof MutationObserver !== 'undefined'
      ? new MutationObserver((records) => {
        if (records.every((record) => isAnimating(record.target))) return;
        measureAndPlan();
      })
      : null;
    const watchPanels = () => {
      panelObserver.disconnect();
      attributeObserver?.disconnect();
      for (const panel of getViewerSideOccluders()) {
        panelObserver.observe(panel);
        attributeObserver?.observe(panel, { attributes: true, attributeFilter: ['data-viewer-occluder', 'class', 'style'] });
      }
      measureAndPlan();
    };
    watchPanels();
    const unsubscribe = subscribeViewerSideOccluders(watchPanels);
    // A panel that slides in by transform changes no size: catch its end.
    // The Survey panel slides in with a CSS ANIMATION (surveyRailExpand,
    // 2026-09-30), which ends in animationend, not transitionend: without
    // that one the plan was last made mid-slide and a narrow window's row 2
    // stayed under the open Survey panel (measured at 1024px, 2026-10-01).
    const onTransitionEnd = (event) => {
      if (event.target?.closest?.('[data-viewer-occluder], .survey-rail')) measureAndPlan();
    };
    document.addEventListener('transitionend', onTransitionEnd, true);
    document.addEventListener('animationend', onTransitionEnd, true);
    return () => {
      observer.disconnect();
      contentObserver.disconnect();
      contentWatchRef.current = { observer: null, holder: null };
      panelObserver.disconnect();
      attributeObserver?.disconnect();
      unsubscribe();
      document.removeEventListener('transitionend', onTransitionEnd, true);
      document.removeEventListener('animationend', onTransitionEnd, true);
    };
  }, [enabled, hostRef, formatRowRef, measureAndPlan]);

  if (!enabled) return DEFAULT_TOOLBAR_PLAN;
  return plan;
}
