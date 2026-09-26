// Which rows the desktop tool chrome shows, and what goes in them.
//
// RULED 2026-09-26 owner: flip rows (w44). The tool bar (row 1) holds the tool
// groups and, right of them, the TOOLS inside the chosen group (pen /
// highlighter / eraser; rectangle … counter; text box / callout). The
// formatting controls (colours, width, line style, ends, Aa …) moved down to
// row 2, where the group's tools used to be. The Aa text-formatting bar still
// drops as row 3 below that.
//
// In Select mode, whenever a mark is picked, the tool bar shows THAT mark's
// group's tools and row 2 shows that mark's formatting, so a picked pen stroke
// reads pen / highlighter / eraser up top and its colour and width below.
// Pressing one of those tools arms it and leaves Select (owner answered yes).
// RULED 2026-09-26 owner: select modes in top bar (w46). With nothing picked,
// Select's own tools — the Box / Lasso / Text modes — sit in the tool bar right
// of the group icons, exactly where pen / highlighter / eraser sit for Draw; so
// does a picked mark that no drawing group makes (a text highlight, or marks
// of several kinds picked together). Row 2 then shows only settings that
// really apply (Text mode's highlight colours), and is hidden when none do.
//
// Shared by AppShell (which draws Select's modes and the rule before the
// tools) and PDFViewer (which draws the group tools themselves), so the two
// always agree on which group is showing.
import { isSelectFamilyTool } from './selectModes.js';

/** The tool groups whose tools sit in the tool bar. */
export const TOOL_BAR_GROUPS = Object.freeze(['draw', 'shape', 'review', 'forms']);

/** The group each drawing tool (or picked mark's tool) belongs to. */
export const TOOL_GROUP_BY_TOOL = Object.freeze({
  pen: 'draw',
  highlighter: 'draw',
  'text-highlight': 'draw',
  eraser: 'draw',
  rect: 'shape',
  ellipse: 'shape',
  polygon: 'shape',
  polyline: 'shape',
  line: 'shape',
  arrow: 'shape',
  counter: 'shape',
  text: 'review',
  callout: 'review',
});

/**
 * Which group's tools the tool bar shows right of the group icons.
 *   'draw' | 'shape' | 'review' | 'forms' — that group's tool buttons;
 *   'select' — Select's Box / Lasso / Text modes (Select armed, and nothing
 *              picked or a picked mark no drawing group makes, such as a
 *              text highlight);
 *   null      — nothing (Pan, Survey Marker placement).
 * `contextTool` is the picked mark's own tool while Select is armed (see
 * PDFViewer's toolbar publish), else the armed tool.
 */
export function resolveToolBarGroup({ activeTool, activeCategoryDropdown, contextTool } = {}) {
  if (TOOL_BAR_GROUPS.includes(activeCategoryDropdown)) return activeCategoryDropdown;
  if (isSelectFamilyTool(activeTool)) return TOOL_GROUP_BY_TOOL[contextTool] || 'select';
  return TOOL_GROUP_BY_TOOL[activeTool] || null;
}

/** The tools whose settings fill the formatting row (the same list every
 * control in the row keys on — colours, width, line style, blend …). */
export const FORMAT_ROW_TOOLS = Object.freeze([
  'pen', 'highlighter', 'arrow', 'line', 'rect', 'ellipse', 'polygon', 'polyline',
  'text', 'callout', 'counter', 'text-markup', 'text-select',
]);

/**
 * Whether the formatting row (row 2) is on screen: exactly when it has
 * settings to show — a drawing tool is armed, a mark with settings is picked,
 * the eraser is armed (its kind and size), a text box is open for typing, or
 * Select's Text mode is armed (the text-highlight colours and blend).
 * RULED 2026-09-26 owner: select modes in top bar (w46). The Box / Lasso /
 * Text modes left row 2 for the tool bar, so Box or Lasso Select with nothing
 * picked has nothing for row 2 and it is hidden; picking a mark brings it
 * back. The row lies over the page (utils/viewerTopOverlay.js), so the page
 * does not move when it comes and goes.
 * Pan and Survey Marker placement have no settings: no row.
 * w47 (2026-09-26): an ARMED drawing tool always has settings, even for the
 * one render where the viewer has published the new tool but not yet its
 * settings context (Eraser → Pen reported contextTool 'eraser' with
 * activeTool 'pen'); counting only contextTool made row 2 blink out and back.
 */
export function showsFormatRow(api) {
  if (!api) return false;
  if (api.activeTool === 'eraser' || api.richTextEditor) return true;
  return FORMAT_ROW_TOOLS.includes(api.contextTool) || FORMAT_ROW_TOOLS.includes(api.activeTool);
}
