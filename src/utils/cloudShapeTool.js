// Drawboard's Shape > Cloud tool. A cloud here is the Rectangle drawn with the
// Cloud line style (the same model the Style picker and the Schematic badge
// use), so it inherits select / move / resize / undo / save / export from the
// rectangle path. A polygon cloud is Polygon + the Cloud style.
export const CLOUD_SHAPE_TOOL_ID = 'cloud';

/** What a Shape-row button arms: { tool, lineBorderStyle } (style null = leave it). */
export function resolveShapeToolPick(id, currentLineBorderStyle) {
  if (id === CLOUD_SHAPE_TOOL_ID) return { tool: 'rect', lineBorderStyle: 'cloud' };
  // Rectangle after Cloud means a plain rectangle again.
  if (id === 'rect' && currentLineBorderStyle === 'cloud') return { tool: 'rect', lineBorderStyle: 'solid' };
  return { tool: id, lineBorderStyle: null };
}

/** Whether a Shape-row button shows pressed. Cloud and Rectangle never both. */
export function isShapeToolButtonActive(id, activeTool, lineBorderStyle) {
  const cloud = activeTool === 'rect' && lineBorderStyle === 'cloud';
  if (id === CLOUD_SHAPE_TOOL_ID) return cloud;
  if (id === 'rect') return activeTool === 'rect' && !cloud;
  return activeTool === id;
}
