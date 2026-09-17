/**
 * toolShortcuts.js — THE one place that says which key arms which tool.
 *
 * Intended UX: every tool button answers two questions on hover — "what is
 * this?" and "how do I get back here without the mouse?". Drawboard PDF puts
 * both in one chip ("Rectangle  R"), so a user who reaches for a tool three
 * times in a row learns the letter without ever opening a help screen. Survey
 * had the letters in the keyboard handler and the names in the tooltips, and
 * the two never met, so the shortcuts were effectively undiscoverable.
 *
 * Reference behavior matched: Drawboard PDF's tool tooltips, which render the
 * tool name followed by a keycap badge. Letters read off Drawboard's web app on
 * 2026-09-16: V select, P pen, H highlighter, T text, L line, A arrow,
 * R rectangle, I image. Survey keeps every one of those it can.
 *
 * Two deliberate divergences from Drawboard, both forced, both documented at
 * their entries below:
 *   - Ellipse is O here, not E. E has been Survey's Eraser since long before
 *     this module existed (and Shift+E its Partial erase — a pair that only
 *     reads right while E stays the eraser). O is the letter Figma and Sketch
 *     give the oval, so it is not an invention.
 *   - Pan is M ("move the page"). Drawboard's hand-tool letter could not be
 *     read out of the web app, and the obvious H is already the Highlighter.
 *     Holding Space still pans momentarily, which is the gesture most people
 *     actually use; M is for whoever wants the tool to stay put.
 *
 * This module is data only — no React, no DOM — so the keyboard handler, the
 * toolbars and the tests all read one source.
 */

/**
 * One entry per armed tool. Fields:
 *   tool      — the activeTool id the key sets.
 *   label     — the tool's user-facing name. Must match the button's
 *               aria-label, so the tooltip and the screen reader say one thing.
 *   badge     — exactly what the tooltip prints after the name, and what a
 *               keycap in a help sheet would show.
 *   key       — the lowercase KeyboardEvent.key the handler matches.
 *   shift/alt — the modifier the handler requires, when there is one.
 *   mutates   — true when arming the tool is a step toward changing the
 *               document. Read-only documents swallow exactly these keys; a
 *               key that only changes how you LOOK at the page (Pan, Select,
 *               Text select) stays live, matching the existing read-only rule.
 */
export const TOOL_SHORTCUTS = [
  // --- Navigation and selection: live even on a read-only document ---------
  {
    tool: 'pan',
    label: 'Pan',
    badge: 'M',
    key: 'm',
    mutates: false,
    // UX: "M for move". Hold Space to pan momentarily without putting the
    // armed tool down; press M when you want the tool put down for good.
  },
  {
    tool: 'select',
    selectionMode: 'rectangle',
    label: 'Rectangle Select',
    badge: 'V',
    key: 'v',
    mutates: false,
  },
  {
    tool: 'select',
    selectionMode: 'lasso',
    label: 'Lasso Select',
    badge: 'Alt+V',
    key: 'v',
    alt: true,
    mutates: false,
    // UX: L is already the Line tool, so Lasso borrows Select's letter with a
    // modifier rather than taking a letter off a drawing tool.
  },
  {
    tool: 'text-select',
    label: 'Text Select',
    badge: 'Shift+V',
    key: 'v',
    shift: true,
    mutates: false,
    // UX: V picks annotations up off the page, Shift+V picks the PDF's own
    // words off it — same key, "more" modifier.
  },

  // --- Draw group ----------------------------------------------------------
  { tool: 'pen', label: 'Pen', badge: 'P', key: 'p', mutates: true },
  { tool: 'highlighter', label: 'Highlighter', badge: 'H', key: 'h', mutates: true },
  {
    tool: 'eraser',
    label: 'Eraser',
    // UX: the Eraser button renames itself to the mode it is in, so the map
    // has to answer to both names or the tooltip loses its badge the moment
    // the user switches the eraser to full-stroke.
    altLabels: ['Full stroke erase'],
    badge: 'E',
    key: 'e',
    mutates: true,
  },
  {
    tool: 'eraser',
    eraserMode: 'partial',
    label: 'Partial erase',
    badge: 'Shift+E',
    key: 'e',
    shift: true,
    mutates: true,
  },

  // --- Shapes group --------------------------------------------------------
  {
    tool: 'rect',
    label: 'Rectangle',
    badge: 'R',
    key: 'r',
    mutates: true,
    // UX: matches Drawboard exactly — R is the letter people arrive with.
  },
  {
    tool: 'ellipse',
    label: 'Ellipse',
    badge: 'O',
    key: 'o',
    mutates: true,
    // UX: Drawboard uses E, but E is Survey's Eraser (and Shift+E its partial
    // erase). O is the oval's letter in Figma and Sketch, so it still lands
    // where a designer's finger expects.
  },
  {
    tool: 'polygon',
    label: 'Polygon',
    badge: 'G',
    key: 'g',
    mutates: true,
    // UX: P belongs to the Pen, so the polyGon takes the next mnemonic letter
    // out of its own name.
  },
  {
    tool: 'polyline',
    label: 'Polyline',
    badge: 'K',
    key: 'k',
    mutates: true,
    // UX: the many-segment Line sits on the free key next to L, so the two
    // line-family tools stay neighbours under one finger.
  },
  { tool: 'line', label: 'Line', badge: 'L', key: 'l', mutates: true },
  { tool: 'arrow', label: 'Arrow', badge: 'A', key: 'a', mutates: true },
  { tool: 'counter', label: 'Counter', badge: 'C', key: 'c', mutates: true },

  // --- Text group ----------------------------------------------------------
  { tool: 'text', label: 'Text', badge: 'T', key: 't', mutates: true },
  {
    tool: 'callout',
    label: 'Callout',
    badge: 'Q',
    key: 'q',
    mutates: true,
    // UX: C is the Counter, so the Callout takes the free letter beside it.
  },
];

/** Every tool id that owns at least one binding. */
export const SHORTCUT_TOOL_IDS = [...new Set(TOOL_SHORTCUTS.map((s) => s.tool))];

/**
 * The plain letters a read-only document must swallow: arming a drawing tool
 * there would promise an edit the document cannot take. Navigation letters are
 * deliberately absent — looking is always allowed.
 */
export const READ_ONLY_BLOCKED_KEYS = [...new Set(
  TOOL_SHORTCUTS.filter((s) => s.mutates && !s.alt).map((s) => s.key),
)].sort();

/** A stable identity for one binding: the key plus its modifiers. */
const chordOf = (s) => [s.alt ? 'alt' : '', s.shift ? 'shift' : '', s.key].filter(Boolean).join('+');

/**
 * Two bindings conflict when the same chord would fire two different actions.
 * Returns the offending chords, so a test can name them rather than just fail.
 */
export function shortcutConflicts(shortcuts = TOOL_SHORTCUTS) {
  const byChord = new Map();
  for (const s of shortcuts) {
    const chord = chordOf(s);
    if (!byChord.has(chord)) byChord.set(chord, []);
    byChord.get(chord).push(s);
  }
  return [...byChord.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([chord, list]) => ({ chord, labels: list.map((s) => s.label) }));
}

/**
 * The badge for a tool, or '' when it has none. `variant` disambiguates the
 * tools that own more than one binding: the select family by selectionMode,
 * the eraser by eraserMode.
 */
export function toolShortcutBadge(toolId, variant = null) {
  if (!toolId) return '';
  const matches = TOOL_SHORTCUTS.filter((s) => s.tool === toolId);
  if (!matches.length) return '';
  if (variant) {
    const exact = matches.find((s) => s.selectionMode === variant || s.eraserMode === variant);
    if (exact) return exact.badge;
  }
  // No variant asked for: the plain, unmodified binding is the tool's own key.
  return (matches.find((s) => !s.shift && !s.alt) || matches[0]).badge;
}

/**
 * Tooltip text for a tool button: the name, two spaces, the badge.
 *
 * UX: two spaces rather than a bracketed suffix, so the chip reads as a label
 * with a keycap beside it instead of a sentence with an aside. Matches
 * Drawboard's "Rectangle  R".
 */
export function toolTooltip(label, toolId, variant = null) {
  const badge = toolShortcutBadge(toolId, variant);
  return badge ? `${label}  ${badge}` : label;
}

/**
 * Same chip, looked up by the name already on the button.
 *
 * Most toolbars here already compute the exact user-facing label (the Select
 * button renames itself per mode, the Eraser per erase mode). Matching on that
 * label keeps the tooltip honest: the badge shown is the badge for the tool the
 * button is currently offering, not for whatever the button was called in code.
 * A label with no binding comes back untouched, so groups like "Draw" and
 * "Shapes" simply keep their plain name.
 */
export function tooltipForLabel(label) {
  if (!label) return label;
  const match = TOOL_SHORTCUTS.find((s) => (
    s.label === label || (s.altLabels || []).includes(label)
  ));
  return match ? `${label}  ${match.badge}` : label;
}

export default TOOL_SHORTCUTS;
