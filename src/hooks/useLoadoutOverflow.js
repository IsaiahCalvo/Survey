import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { EDGE_CLEARANCE } from '../utils/responsiveToolbar.js';
import { loadoutItemKey, planLoadoutOverflow } from '../utils/loadoutOverflow.js';

const HIDDEN_ATTR = 'data-loadout-overflow';

/**
 * Keeps the tool bar's loadout (the chosen group's tools, drawn by PDFViewer
 * into #chrome-subtools-host) clear of the right-hand buttons (KAL-667). See
 * utils/loadoutOverflow.js for the rule.
 *
 * The tools are PDFViewer's own buttons, so this works on the DOM: a tool that
 * does not fit is hidden with an inline `display: none` (kept on a loadout
 * ghost copy too, so the fade-out never shows the full row), and More lists it
 * by name and icon. Picking it there clicks the real button, so it does
 * exactly what pressing it in the row does; once armed it comes back into the
 * row (the armed tool is never hidden).
 *
 * Re-planned before paint whenever the row's buttons change (a group switch,
 * a tool armed) and whenever the bar changes width.
 *
 * @returns {{ hidden: Array<{key: string, label: string, svg: string, glyph: ?Element}>, pick: (key: string) => void }}
 */
export default function useLoadoutOverflow(slotEl, enabled) {
  const [hidden, setHidden] = useState([]);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const widthsRef = useRef(new Map());

  const stripItems = useCallback(() => {
    const strip = slotEl?.querySelector('#chrome-subtools-host [data-chrome-subtools-row]');
    return strip ? { strip, items: [...strip.children] } : { strip: null, items: [] };
  }, [slotEl]);

  useLayoutEffect(() => {
    if (!slotEl || !enabled || typeof window === 'undefined') {
      if (hiddenRef.current.length) setHidden([]);
      return undefined;
    }
    const host = slotEl.querySelector('#chrome-subtools-host');
    let bar = slotEl.parentElement;
    while (bar && !bar.querySelector('[data-toolbar-export]')) bar = bar.parentElement;
    if (!host || !bar) return undefined;

    const run = () => {
      const { strip, items } = stripItems();
      if (!strip || items.length === 0) {
        if (hiddenRef.current.length) setHidden([]);
        return;
      }
      const style = window.getComputedStyle(slotEl);
      const gap = parseFloat(style.getPropertyValue('--chrome-tool-gap')) || 6;
      const controlW = parseFloat(style.getPropertyValue('--chrome-control-w')) || 28;
      const keys = items.map((item, i) => loadoutItemKey(item, i));
      const widths = items.map((item, i) => {
        // Layout width, not the drawn box: a tool growing in (the loadout
        // morph scales it) must still count at its full size.
        const shownNow = !item.hasAttribute(HIDDEN_ATTR);
        const w = shownNow ? item.offsetWidth : 0;
        if (w > 0) widthsRef.current.set(keys[i], w);
        return widthsRef.current.get(keys[i]) ?? controlW;
      });
      let rightLimit = Infinity;
      for (const el of bar.querySelectorAll('[data-toolbar-export]')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0) rightLimit = Math.min(rightLimit, r.left);
      }
      if (!Number.isFinite(rightLimit)) rightLimit = bar.getBoundingClientRect().right - 10;
      const room = rightLimit - Math.max(EDGE_CLEARANCE, gap) - strip.getBoundingClientRect().left;
      const keep = items.findIndex((item) => item.getAttribute('aria-pressed') === 'true'
        || Boolean(item.querySelector?.('[aria-pressed="true"]')));
      const moreButton = slotEl.querySelector('[data-loadout-more]');
      const moreWidth = moreButton?.offsetWidth || widths[0] || controlW;
      const { hidden: hiddenIdx } = planLoadoutOverflow({ widths, gap, room, moreWidth, keep });
      const hide = new Set(hiddenIdx);
      items.forEach((item, i) => {
        if (hide.has(i)) {
          if (!item.hasAttribute(HIDDEN_ATTR)) {
            item.setAttribute(HIDDEN_ATTR, 'true');
            item.style.display = 'none';
          }
        } else if (item.hasAttribute(HIDDEN_ATTR)) {
          item.removeAttribute(HIDDEN_ATTR);
          item.style.display = '';
        }
      });
      const next = hiddenIdx.map((i) => {
        const item = items[i];
        const button = item.matches?.('button') ? item : item.querySelector?.('button');
        const svg = item.querySelector?.('svg');
        return {
          key: keys[i],
          label: button?.getAttribute('aria-label') || keys[i],
          svg: svg ? svg.outerHTML : '',
          glyph: svg ? svg.cloneNode(true) : null,
        };
      });
      const prev = hiddenRef.current;
      const same = prev.length === next.length
        && prev.every((p, i) => p.key === next[i].key && p.label === next[i].label && p.svg === next[i].svg);
      if (!same) {
        hiddenRef.current = next;
        setHidden(next);
      }
    };

    run();
    const mutations = new MutationObserver(run);
    mutations.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-pressed', 'aria-label', 'data-morph-icon'],
    });
    const exportsWatch = new MutationObserver(run);
    exportsWatch.observe(bar, { childList: true, subtree: true });
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(run) : null;
    resize?.observe(bar);
    window.addEventListener('resize', run);
    return () => {
      mutations.disconnect();
      exportsWatch.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', run);
      for (const item of stripItems().items) {
        if (item.hasAttribute(HIDDEN_ATTR)) {
          item.removeAttribute(HIDDEN_ATTR);
          item.style.display = '';
        }
      }
    };
  }, [slotEl, enabled, stripItems]);

  const pick = useCallback((key) => {
    const { items } = stripItems();
    const item = items.find((el, i) => loadoutItemKey(el, i) === key);
    const button = item?.matches?.('button') ? item : item?.querySelector?.('button');
    button?.click();
  }, [stripItems]);

  return { hidden, pick };
}
