/**
 * markToolGroup — the one answer to "which tool group does this tool, or this
 * mark, belong to?" (owner 2026-10-04).
 *
 * The groups are the tool bar's: 'draw' (pen, highlighter, eraser, text
 * highlight), 'shape' (rectangle, ellipse, polygon, polyline, line, arrow,
 * counter) and 'review' (the Text group: text box, callout). Survey Markers
 * are their own group. A mark belongs to the group of the tool that makes it;
 * a mark no group's tool makes (a text highlight made by Text Select, an
 * image or stamp) has no group (null).
 *
 * Used by the tool bar (utils/toolbarRows.js), the restyle bar
 * (utils/selectionRestyle.js) and the press rules (utils/selectModes.js,
 * utils/toolPressRouting.js) — desktop and phone alike. Keep every
 * tool -> group and mark -> tool answer here.
 */

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

/** Survey Markers: placed by their own tool, picked by it and by Select / Pan. */
export const SURVEY_MARKER_GROUP = 'survey-marker';
/** Callouts live outside the page's objects; they are Text-group marks. */
export const CALLOUT_MARK_GROUP = 'review';

/** The tool group of an armed tool, or null (Select, Pan, Text Select, …). */
export function getToolGroup(tool) {
  if (tool === 'survey-marker') return SURVEY_MARKER_GROUP;
  return TOOL_GROUP_BY_TOOL[tool] || null;
}

const lower = (value) => String(value || '').toLowerCase();

export const isCounterMark = (annotation) => lower(annotation?.type) === 'circle'
  && annotation?.data?.type === 'counter';

export const isArrowLineMark = (annotation) => lower(annotation?.type) === 'line' && (
  annotation?.tool === 'arrow'
  || annotation?.data?.tool === 'arrow'
  || annotation?.data?.arrowheadStyle != null
);

/**
 * The tool a page mark belongs to (the bar's tool for a picked mark):
 * a polygon reads as the rectangle tool's and a polyline as the line tool's
 * (they share those bars). Null for a mark no drawing tool makes.
 */
export function markToolForAnnotation(annotation) {
  if (!annotation) return null;
  const type = lower(annotation.type);
  if (annotation.data?.type === 'text-markup') return 'text-markup';
  if (annotation.data?.type === 'callout') return 'callout';
  if (type === 'rect') return 'rect';
  if (type === 'ellipse' || (type === 'circle' && !isCounterMark(annotation))) return 'ellipse';
  if (type === 'path') return 'pen';
  if (type === 'textbox' || type === 'i-text' || type === 'text') return 'text';
  if (type === 'polygon') return 'rect';
  if (type === 'polyline') return 'line';
  if (isCounterMark(annotation)) return 'counter';
  if (type === 'line') return isArrowLineMark(annotation) ? 'arrow' : 'line';
  // An older arrow saved as a group of a line and its head.
  if (type === 'group' && annotation.objects?.some((child) => (
    ['line', 'polyline', 'path'].includes(lower(child?.type))
  ))) return 'arrow';
  return null;
}

/**
 * The tool group of a mark: a page object (annotations.objects[i]), or
 * { kind: 'callout' } / { kind: 'survey-marker' } for the marks kept outside
 * the page's objects. Null when no group's tool makes it.
 */
export function getMarkGroup(mark) {
  if (!mark) return null;
  if (mark.kind === 'callout') return CALLOUT_MARK_GROUP;
  if (mark.kind === 'survey-marker') return SURVEY_MARKER_GROUP;
  return getToolGroup(markToolForAnnotation(mark));
}
