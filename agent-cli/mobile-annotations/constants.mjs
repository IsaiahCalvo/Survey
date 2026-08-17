export const FIXTURE_NAME = 'clickable-link-test.pdf';

export const DEFAULT_ROUTE = `/?testPdf=${FIXTURE_NAME}&mobileNav=tabs&nativeShell=expo&eraserLifecycleE2E=1&surveyTransitionE2E=1`;

export const MOBILE_VIEWPORT = Object.freeze({ width: 390, height: 844 });

// Locked lifecycle rows. Plan 38-02 lands the fast create/reload foundation;
// later plans fill the remaining lifecycle cells without changing these IDs.
export const TOOL_MATRIX = Object.freeze([
  { id: 'pen', label: 'Pen', group: 'Draw', modelType: 'path', implemented: true },
  { id: 'highlighter', label: 'Highlighter', group: 'Draw', modelType: 'path', implemented: true },
  { id: 'line', label: 'Line', group: 'Shapes', modelType: 'line', implemented: true },
  { id: 'arrow', label: 'Arrow', group: 'Shapes', modelType: 'line', implemented: true },
  { id: 'rectangle', label: 'Rectangle', group: 'Shapes', modelType: 'rect', implemented: true },
  { id: 'ellipse', label: 'Ellipse', group: 'Shapes', modelType: 'ellipse', implemented: true },
  { id: 'text', label: 'Text', group: 'Text', modelType: 'textbox', implemented: true },
  { id: 'callout', label: 'Callout', group: 'Text', modelType: 'callout', implemented: true },
  { id: 'counter', label: 'Counter', group: 'Shapes', modelType: 'circle', implemented: true },
  { id: 'survey-marker', label: 'Survey Marker', group: null, modelType: 'survey-marker', implemented: true },
  { id: 'region', label: 'Region', group: null, modelType: 'region', implemented: true },
  { id: 'space', label: 'Space', group: null, modelType: 'space', implemented: true },
  { id: 'eraser', label: 'Eraser', group: 'Draw', modelType: null, implemented: true },
]);

export const IMPLEMENTED_TOOL_IDS = Object.freeze(
  TOOL_MATRIX.filter((row) => row.implemented).map((row) => row.id),
);
