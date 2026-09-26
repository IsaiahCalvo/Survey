import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  TOOLBAR_SLOTS,
  planToolbarLayout,
  slotDefinition,
} from '../utils/responsiveToolbar.js';

/**
 * Responsive desktop tool bar (w42) — measures the bar and hands back the plan
 * from planToolbarLayout (see src/utils/responsiveToolbar.js for the order the
 * bar gives ground in and why).
 *
 * Intended UX: nothing in the top bar ever overlaps, at any desktop width, and
 * the bar never flickers while it adapts. The plan is worked out in a layout
 * effect after every render (before the browser paints) and again, forced
 * through synchronously, whenever the bar changes width, so a narrowing
 * window never shows a frame of overlapping controls.
 *
 * Widths of each setting are remembered per look (full / compact) the first
 * time it is drawn that way, so a setting moved into More (and therefore not in
 * the bar to measure) still counts at its real width when the window widens
 * again. The first guess, before a setting has ever been drawn, is its token
 * width from TOOLBAR_SLOTS.
 *
 * DOM contract (all inside the bar element `hostRef` points at):
 *   [data-undo-redo-controls]        Undo / Redo
 *   [data-toolbar-export]            Export (optional)
 *   [data-tool-toolbar]              the Draw / Shapes / Text icons
 *   [data-toolbar-left-block]        the Pan / Select block
 *   [data-chrome-settings-holder]    the settings; its in-flow children, and
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
 *
 * `overflowSlotsRef.current` lists the settings the last render put in More
 * (id + divider flag), since those are not in the bar to be found.
 */

export const DEFAULT_TOOLBAR_PLAN = Object.freeze({
  anchor: 'center', shift: 0, tight: false, compact: [], overflow: [], fits: true,
});

const samePlan = (a, b) => (
  a.anchor === b.anchor
  && Math.abs(a.shift - b.shift) < 0.5
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

  // Settings sitting in More are not in the bar: put them back where the row
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
    // reading "Mixed" in More would read "Mixed" back in the bar too.
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

export default function useResponsiveToolbar({ hostRef, enabled, overflowSlotsRef }) {
  const [plan, setPlan] = useState(DEFAULT_TOOLBAR_PLAN);
  const planRef = useRef(plan);
  planRef.current = plan;
  const cacheRef = useRef(new Map());
  // A guard against a plan ping-ponging between two answers (it should not:
  // every width it reads is fixed per look). Counts the plan changes made
  // before the browser gets to paint; past a few it stops re-planning until
  // the next frame, so a bad measurement can never lock the page up.
  const churnRef = useRef({ count: 0, frameRequested: false });

  const measureAndPlan = useCallback(() => {
    const host = hostRef.current;
    if (!host || typeof window === 'undefined') return false;
    const hostRect = host.getBoundingClientRect();
    if (hostRect.width <= 0) return false;
    const rel = (element, edge) => (element ? element.getBoundingClientRect()[edge] - hostRect.left : null);
    const undo = host.querySelector('[data-undo-redo-controls]');
    const exportButton = host.querySelector('[data-toolbar-export]');
    const cluster = host.querySelector('[data-tool-toolbar]');
    const leftBlock = host.querySelector('[data-toolbar-left-block]');
    const holder = host.querySelector('[data-chrome-settings-holder]');
    if (!cluster || !holder) return false;
    const row = rowFromDom(holder, cacheRef.current, overflowSlotsRef?.current || []);
    const next = planToolbarLayout({
      barWidth: hostRect.width,
      undoRight: rel(undo, 'right') ?? 0,
      exportLeft: rel(exportButton, 'left') ?? hostRect.width - 10,
      clusterWidth: cluster.getBoundingClientRect().width,
      leftBlockWidth: leftBlock ? leftBlock.getBoundingClientRect().width : 0,
      row,
    });
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
  }, [hostRef, overflowSlotsRef]);

  // Every render: the armed tool, the selection or a "Mixed" label may have
  // changed what the settings row holds.
  useLayoutEffect(() => {
    if (!enabled) return;
    measureAndPlan();
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
    // arriving, a lazy control finishing): re-plan when they do.
    const holder = host.querySelector('[data-chrome-settings-holder]');
    let holderWidth = -1;
    const holderObserver = new ResizeObserver((records) => {
      const width = records[records.length - 1]?.contentRect?.width ?? -1;
      if (Math.abs(width - holderWidth) < 0.5) return;
      holderWidth = width;
      measureAndPlan();
    });
    if (holder) holderObserver.observe(holder);
    return () => { observer.disconnect(); holderObserver.disconnect(); };
  }, [enabled, hostRef, measureAndPlan]);

  if (!enabled) return DEFAULT_TOOLBAR_PLAN;
  return plan;
}
