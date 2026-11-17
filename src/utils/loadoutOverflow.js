/**
 * Tool bar loadout overflow (KAL-667).
 *
 * Intended UX: the tools of the chosen group hang off the right edge of the
 * group icons and grow to the right. A group with many tools (Nightly's Text
 * group has 18) used to run under the Pin / Share / Export buttons at the
 * right of the bar. Now the tools that do not fit wait in a More (⋯) menu at
 * the end of the row, the way the formatting row below already does it. The
 * group icons never move; only the end of the row changes.
 *
 * The plan hides a run of tools at the END of the row, so what is left reads
 * in the same order. The armed tool is never hidden: if it falls in the
 * hidden run, the last tool that fits before it goes into More instead.
 *
 * @param {object} input
 * @param {number[]} input.widths  each tool's drawn width, in row order
 * @param {number} input.gap       the gutter between tools
 * @param {number} input.room      from the row's left edge to the last spot
 *   it may reach (the right-hand buttons less their clearance)
 * @param {number} input.moreWidth the More button's width
 * @param {number} [input.keep]    index of the armed tool, or -1
 * @returns {{ hidden: number[] }} indices of the tools that go into More
 */
export function planLoadoutOverflow({ widths, gap, room, moreWidth, keep = -1 }) {
  const n = Array.isArray(widths) ? widths.length : 0;
  if (n === 0) return { hidden: [] };
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * (n - 1);
  if (total <= room + 0.5) return { hidden: [] };

  // The More button follows the last tool shown, on the same gutter.
  const budget = room - moreWidth - gap;
  const kept = keep >= 0 && keep < n ? keep : -1;
  const shown = new Set();
  let used = 0;
  if (kept >= 0) {
    shown.add(kept);
    used = widths[kept];
  }
  for (let i = 0; i < n; i += 1) {
    if (i === kept) continue;
    const add = widths[i] + (shown.size > 0 ? gap : 0);
    if (used + add > budget + 0.5) break;
    shown.add(i);
    used += add;
  }
  const hidden = [];
  for (let i = 0; i < n; i += 1) if (!shown.has(i)) hidden.push(i);
  return { hidden };
}

/** A stable name for one tool button in the row, so a re-render that makes a
 * new button for the same tool keeps its place in or out of More. */
export function loadoutItemKey(element, index) {
  if (!element?.getAttribute) return String(index);
  if (element.hasAttribute('data-pin-tool-button')) return 'pin';
  return element.getAttribute('data-morph-icon')
    || element.getAttribute('aria-label')
    || element.querySelector?.('button[aria-label]')?.getAttribute('aria-label')
    || String(index);
}
