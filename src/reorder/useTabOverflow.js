// Measures a tab row and splits its tabs into the ones that fit and the ones
// for its "more" menu (fitTabs). The tabs' natural widths come from a hidden
// copy of the row (`measureRef`) whose tabs carry data-measure-tab="<id>" and
// whose more button carries data-measure-more, styled exactly like the real
// ones; the real row is `rowRef`.
import { useLayoutEffect, useState } from 'react';
import { fitTabs } from './tabOverflow.js';

const sameList = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

export default function useTabOverflow({ ids, activeId, rowRef, measureRef, enabled = true, contentKey = '' }) {
  const idsKey = ids.join('\u0000');
  const [fit, setFit] = useState(() => ({ visible: ids, hidden: [] }));
  useLayoutEffect(() => {
    if (!enabled) {
      setFit((prev) => (sameList(prev.visible, ids) && prev.hidden.length === 0 ? prev : { visible: ids, hidden: [] }));
      return undefined;
    }
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return undefined;
    const compute = () => {
      const widthOf = (selector) => measure.querySelector(selector)?.getBoundingClientRect().width || 0;
      const style = getComputedStyle(row);
      const available = row.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      // A hidden row (closed panel, other screen size) measures 0: keep the
      // last answer instead of collapsing to one tab.
      if (!(available > 0)) return;
      const widths = ids.map((id) => widthOf(`[data-measure-tab="${CSS.escape(String(id))}"]`));
      const result = fitTabs({
        widths,
        available,
        moreWidth: widthOf('[data-measure-more]'),
        activeIndex: ids.indexOf(activeId),
      });
      const visible = result.visible.map((index) => ids[index]);
      const hidden = result.hidden.map((index) => ids[index]);
      setFit((prev) => (sameList(prev.visible, visible) && sameList(prev.hidden, hidden) ? prev : { visible, hidden }));
    };
    compute();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(compute);
    observer.observe(row);
    observer.observe(measure);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, activeId, enabled, contentKey]);
  // The tabs keep the order of `ids` at once, even before the next measure:
  // a drag-reorder that drew one frame in the old order made the passed tabs
  // jump a whole tab back and glide forward again on the drop (frame capture,
  // owner 2026-10-30). Ids that left drop out at once; new ones show until
  // the measure places them.
  const hiddenSet = new Set(fit.hidden);
  return {
    visible: ids.filter((id) => !hiddenSet.has(id)),
    hidden: ids.filter((id) => hiddenSet.has(id)),
  };
}
