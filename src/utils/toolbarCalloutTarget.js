// Which callout the tool bar's row 2 reads and writes.
//
// Owner 2026-10-04: "When the callout tool is selected, I see the options in
// the second toolbar: color picker, line weight, line type, arrow type, and the
// AA option. When I click on the canvas to actually draw the callout, all
// those drop-downs disappear and I only have the color picker and the AA."
//
// Drawing a callout opens it for typing and puts the tool down to Select
// (PDFViewer handleRequestCalloutEditMode) with nothing picked, so the bar
// resolved to Select's own row. A callout open for typing is now the callout
// the bar edits whenever nothing else is picked: the row stays the Callout row
// (Width, Style, Arrowhead, colour, Aa) and its changes land on that callout.
//
// Owner 2026-10-04 ("the select tool can select any annotation, and its
// formatting and tool groups come up ... The same thing should happen with the
// pan tool"; a Shapes / Text tool "should also be able to select [marks]
// within its tool group"): a pick made under Pan, or a Shapes / Text tool's
// pick of its own group's mark, is read and edited by the bar exactly as a
// Select pick is (resolvePickBarTool). When the pick goes, the bar is the
// armed tool's own settings again.

import { canToolPickAnyGroup, canToolPickMark } from './selectModes.js';

/**
 * The tool the bar works for while marks are picked: 'select' when the bar
 * shows and changes THE PICKED MARK(S) (Select; Pan with any pick; a Shapes /
 * Text tool whose pick is all of its own group), else the armed tool (its
 * settings for the next mark). The mark just drawn and auto-picked while its
 * tool stays armed (justDrawn) keeps the tool's settings, which restyle it too.
 * @param {{ activeTool: string, pickedGroups?: Iterable<string|null>, justDrawn?: boolean }} input
 */
export function resolvePickBarTool({ activeTool, pickedGroups = [], justDrawn = false } = {}) {
  if (activeTool === 'select') return 'select';
  const groups = Array.from(pickedGroups || []);
  if (groups.length === 0 || justDrawn) return activeTool;
  if (activeTool === 'pan') return 'select';
  // Text Select keeps its own bar (the text-highlight colours); the Draw
  // group never picks.
  if (activeTool === 'text-select' || !canToolPickAnyGroup(activeTool)) return activeTool;
  return groups.every((group) => group != null && canToolPickMark(activeTool, group)) ? 'select' : activeTool;
}

/**
 * @param {{ selectedCalloutIds?: Set<string>|null, callouts?: object[], editingCalloutId?: string|null }} input
 * @returns {{ id: string, pageNumber: number, callout: object, editing: boolean }|null}
 */
export function resolveToolbarCallout({ selectedCalloutIds = null, callouts = [], editingCalloutId = null } = {}) {
  const list = Array.isArray(callouts) ? callouts : [];
  const picked = selectedCalloutIds instanceof Set ? selectedCalloutIds : null;
  if ((!picked || picked.size === 0) && editingCalloutId) {
    const editing = list.find((c) => c && c.id === editingCalloutId);
    return editing ? { id: editing.id, pageNumber: editing.pageNumber, callout: editing, editing: true } : null;
  }
  if (!picked || picked.size !== 1) return null;
  const id = Array.from(picked)[0];
  const callout = list.find((c) => c && c.id === id);
  if (!callout) return null;
  return { id, pageNumber: callout.pageNumber, callout, editing: false };
}

/**
 * The tool whose settings row 2 shows: under Select, the kind of the picked
 * (or typed-in) mark - and under Pan or a Shapes / Text tool holding an
 * own-group pick (resolvePickBarTool); otherwise the armed tool. Mirrors PDFViewer's
 * `contextTool` so a test can pin "armed" and "drawing a new one" together.
 */
export function resolveRowTwoTool({ activeTool, selectionMappedTool = null, pickedGroups = [], justDrawn = false } = {}) {
  const barTool = resolvePickBarTool({ activeTool, pickedGroups, justDrawn });
  return barTool === 'select' && selectionMappedTool ? selectionMappedTool : activeTool;
}
