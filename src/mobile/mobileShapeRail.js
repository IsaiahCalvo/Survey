// The phone rail's Shapes strip (TOOL_GROUPS.shape in MobilePdfViewerChrome.jsx):
// the desktop Shape row's Cloud button and Measure menu (PR #1055) on a phone.
// Pure so tests can drive it.
import { isShapeToolButtonActive, resolveShapeToolPick } from '../utils/cloudShapeTool.js';
import { measureBaseTool } from '../utils/measure/measureScale.js';

export const MOBILE_MEASURE_ITEMS = [
  { key: 'length', label: 'Length', icon: 'measureLength' },
  { key: 'area', label: 'Area', icon: 'measureArea' },
  { key: 'perimeter', label: 'Perimeter', icon: 'measurePerimeter' },
  { key: 'scale', label: 'Page scale…', icon: 'measureScale' },
];

// Nightly 'measure-depth': Polylength after Length, Wall area and Volume after
// Perimeter, in the desktop menu's order.
export function mobileMeasureItems(depthToolsOn = false) {
  if (!depthToolsOn) return MOBILE_MEASURE_ITEMS;
  const [length, area, perimeter, scale] = MOBILE_MEASURE_ITEMS;
  return [
    length,
    { key: 'polylength', label: 'Polylength', icon: 'polyline' },
    area,
    perimeter,
    { key: 'wallArea', label: 'Wall area', icon: 'measurePerimeter' },
    { key: 'volume', label: 'Volume', icon: 'measureArea' },
    scale,
  ];
}

/** Whether a Shapes strip button shows pressed. */
export function isMobileShapeToolActive(id, { activeTool, lineBorderStyle, measureMode, measureScaleDialogOpen } = {}) {
  if (id === 'measure') return !!measureMode || !!measureScaleDialogOpen;
  if (measureMode) return false;
  return isShapeToolButtonActive(id, activeTool, lineBorderStyle);
}

/** Apply a Shapes strip tap (not Measure) through the bottom-toolbar API. */
export function applyMobileShapePick(id, api) {
  const pick = resolveShapeToolPick(id, api?.lineBorderStyle, api?.activeTool);
  // The raw tool setter: setLineBorderStyle would also restyle a selected shape.
  if (pick.lineBorderStyle) api?.setToolLineBorderStyle?.(pick.lineBorderStyle);
  api?.setMeasureMode?.(null);
  return pick.tool;
}

/** Apply a Measure menu pick through the bottom-toolbar API. */
export function applyMobileMeasurePick(key, api) {
  if (key === 'scale') {
    api?.openMeasureScaleDialog?.({ pageNumber: api?.pageNum || 1 });
    return null;
  }
  const tool = measureBaseTool(key);
  api?.setActiveTool?.(tool);
  api?.setMeasureMode?.(key);
  return tool;
}
