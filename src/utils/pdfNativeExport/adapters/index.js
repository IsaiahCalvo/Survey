// Adapter registry for the Phase D pdfNativeExport bake pipeline.
// Maps Fabric annotation types to per-subtype adapters. Each adapter
// is registered with the top-level registry in ../index.js when the
// bake function runs, so registration order does not matter and tests
// can swap individual adapters without touching the whole table.

import { adaptSquare } from './square.js';
import { adaptCircle } from './circle.js';
import { adaptLine } from './line.js';
import { adaptFreeText } from './freeText.js';
import { adaptPolygon } from './polygon.js';
import { adaptPolyLine } from './polyLine.js';
import { adaptInk } from './ink.js';
import {
  adaptHighlight,
  adaptUnderline,
  adaptSquiggly,
  adaptStrikeOut,
  adaptLink,
  adaptRedact,
} from './textMarkup.js';

// Lookup is keyed by the Fabric `type` field with a secondary `exportType`
// override for survey-marker / underline / squiggly / strikeout, which all
// arrive as Fabric rects but need different PDF subtypes.
const FABRIC_TYPE_ADAPTERS = {
  path: adaptInk,
  rect: adaptSquare,
  circle: adaptCircle,
  polygon: adaptPolygon,
  polyline: adaptPolyLine,
  line: adaptLine,
  textbox: adaptFreeText,
  text: adaptFreeText,
  'i-text': adaptFreeText,
};

const EXPORT_TYPE_ADAPTERS = {
  highlight: adaptHighlight,
  'survey-marker': adaptHighlight,
  underline: adaptUnderline,
  squiggly: adaptSquiggly,
  strikeout: adaptStrikeOut,
  link: adaptLink,
  redact: adaptRedact,
  freetext: adaptFreeText,
  ink: adaptInk,
  square: adaptSquare,
  circle: adaptCircle,
  line: adaptLine,
  polygon: adaptPolygon,
  polyline: adaptPolyLine,
};

export function resolveAdapter(fabricObj) {
  const exportType = String(fabricObj?.exportType || '').toLowerCase();
  if (exportType && EXPORT_TYPE_ADAPTERS[exportType]) {
    return EXPORT_TYPE_ADAPTERS[exportType];
  }
  const fabricType = String(fabricObj?.type || '').toLowerCase();
  if (fabricType && FABRIC_TYPE_ADAPTERS[fabricType]) {
    return FABRIC_TYPE_ADAPTERS[fabricType];
  }
  return null;
}

export function buildAdapterRegistry() {
  return {
    fabricTypes: { ...FABRIC_TYPE_ADAPTERS },
    exportTypes: { ...EXPORT_TYPE_ADAPTERS },
    resolveAdapter,
  };
}

export {
  adaptSquare,
  adaptCircle,
  adaptLine,
  adaptFreeText,
  adaptPolygon,
  adaptPolyLine,
  adaptInk,
  adaptHighlight,
  adaptUnderline,
  adaptSquiggly,
  adaptStrikeOut,
  adaptLink,
  adaptRedact,
};
