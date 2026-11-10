// Drawboard's Shape > Cloud tool. A cloud here is the Rectangle drawn with the
// Cloud line style (the same model the Style picker uses), so it inherits
// select / move / resize / undo / save / export from the rectangle path. A
// polygon cloud is Polygon + the Cloud style.
export const CLOUD_SHAPE_TOOL_ID = 'cloud';

/** What a Shape-row button arms: { tool, lineBorderStyle } (style null = leave it). */
export function resolveShapeToolPick(id, currentLineBorderStyle, activeTool = 'rect') {
  if (id === CLOUD_SHAPE_TOOL_ID) return { tool: 'rect', lineBorderStyle: 'cloud' };
  // Any other shape after the Cloud tool draws plain lines again (Polygon
  // after Cloud used to draw a cloud). A cloud style picked from the Style
  // menu on another tool (a polygon cloud) is left alone.
  if (currentLineBorderStyle === 'cloud' && activeTool === 'rect') return { tool: id, lineBorderStyle: 'solid' };
  return { tool: id, lineBorderStyle: null };
}

/** Whether a Shape-row button shows pressed. Cloud and Rectangle never both. */
export function isShapeToolButtonActive(id, activeTool, lineBorderStyle) {
  const cloud = activeTool === 'rect' && lineBorderStyle === 'cloud';
  if (id === CLOUD_SHAPE_TOOL_ID) return cloud;
  if (id === 'rect') return activeTool === 'rect' && !cloud;
  return activeTool === id;
}
