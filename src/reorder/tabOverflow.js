// Which tabs of a row fit, and which go in its "more" menu (owner 2026-10-26:
// "maybe we only show a certain amount, and then you have a dropdown after a
// certain amount"). Pure, so the rule is tested without a browser.
//
// Tabs keep their order. When they do not all fit, the row keeps room for the
// more button and shows as many leading tabs as fit. The open tab is always
// shown: if it would be hidden it takes the last place in the row. At least
// one tab is always shown.

/**
 * @param {object} p
 * @param {number[]} p.widths       each tab's natural width, in order
 * @param {number} p.available      the row's inner width
 * @param {number} p.moreWidth      the more button's width
 * @param {number} [p.activeIndex]  the open tab (-1 for none)
 * @returns {{ visible: number[], hidden: number[] }} indices into `widths`
 */
export function fitTabs({ widths, available, moreWidth, activeIndex = -1 }) {
  const n = widths.length;
  const all = Array.from({ length: n }, (_, i) => i);
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (n === 0 || total <= available + 0.5) return { visible: all, hidden: [] };
  const room = available - moreWidth;
  const visible = [];
  let used = 0;
  for (let i = 0; i < n; i += 1) {
    if (used + widths[i] > room + 0.5) break;
    used += widths[i];
    visible.push(i);
  }
  if (activeIndex >= 0 && activeIndex < n && !visible.includes(activeIndex)) {
    while (visible.length > 0 && used + widths[activeIndex] > room + 0.5) {
      used -= widths[visible.pop()];
    }
    visible.push(activeIndex);
  }
  if (visible.length === 0) visible.push(activeIndex >= 0 && activeIndex < n ? activeIndex : 0);
  const shown = new Set(visible);
  return { visible, hidden: all.filter((i) => !shown.has(i)) };
}
