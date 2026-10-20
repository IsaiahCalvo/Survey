// One PDF annotation dict -> one XFDF element (KAL-393).
//
// The dict comes from the app's own PDF export writer (pdfAnnotationsPdfLib),
// so this file only translates; it never decides geometry or colour itself.
// Element and attribute names follow Adobe's XFDF 3.0 spec, which is what
// Acrobat, Bluebeam, PDF-XChange and Foxit read.

import { PDFName } from 'pdf-lib';
import {
  formatNumber,
  formatNumberList,
  formatPointList,
  pdfBorderStyleToXfdf,
  pdfColorToHex,
  pdfFlagsToXfdf,
  xmlElement,
  xmlTextElement,
} from './xfdfXml.js';
import {
  readDict,
  readName,
  readNames,
  readNumber,
  readNumberLists,
  readNumbers,
  readText,
} from './pdfValues.js';

// The app writes Survey Markers with a private /SurveyMarker subtype that
// carries highlight-style /QuadPoints. Other tools have no such element, so
// it goes out as a highlight, the same mapping the native bake pipeline uses
// (pdfNativeExport/adapters: 'survey-marker' -> adaptHighlight).
export const XFDF_ELEMENT_BY_SUBTYPE = {
  Text: 'text',
  FreeText: 'freetext',
  Line: 'line',
  Square: 'square',
  Circle: 'circle',
  Polygon: 'polygon',
  PolyLine: 'polyline',
  Highlight: 'highlight',
  Underline: 'underline',
  Squiggly: 'squiggly',
  StrikeOut: 'strikeout',
  Stamp: 'stamp',
  Caret: 'caret',
  Ink: 'ink',
  Link: 'link',
  Redact: 'redact',
  SurveyMarker: 'highlight',
};

const MARKUP_ELEMENTS = new Set(['highlight', 'underline', 'squiggly', 'strikeout', 'redact']);
const I1 = '    ';
const I2 = '      ';
const I3 = '        ';

function borderAttrs(context, dict) {
  const bs = readDict(context, dict, 'BS');
  const border = readNumbers(context, dict, 'Border');
  const width = bs ? readNumber(context, bs, 'W') : (border && border.length >= 3 ? border[2] : null);
  const style = bs ? pdfBorderStyleToXfdf(readName(context, bs, 'S')) : null;
  const dashes = bs ? readNumbers(context, bs, 'D') : null;
  const be = readDict(context, dict, 'BE');
  const cloudy = be && readName(context, be, 'S') === 'C';
  return {
    width: width == null ? null : formatNumber(width),
    style: cloudy ? 'cloudy' : style,
    intensity: cloudy ? formatNumber(readNumber(context, be, 'I') ?? 1) : null,
    dashes: style === 'dash' && dashes?.length ? formatNumberList(dashes) : null,
  };
}

function commonAttrs(context, dict, pageIndex) {
  const rect = readNumbers(context, dict, 'Rect');
  const opacity = readNumber(context, dict, 'CA');
  return {
    page: String(pageIndex),
    rect: rect && rect.length === 4 ? formatNumberList(rect) : null,
    color: pdfColorToHex(readNumbers(context, dict, 'C')),
    'interior-color': pdfColorToHex(readNumbers(context, dict, 'IC')),
    name: readText(context, dict, 'NM'),
    title: readText(context, dict, 'T'),
    subject: readText(context, dict, 'Subj'),
    date: readText(context, dict, 'M'),
    creationdate: readText(context, dict, 'CreationDate'),
    flags: pdfFlagsToXfdf(readNumber(context, dict, 'F')),
    opacity: opacity == null || opacity >= 1 ? null : formatNumber(opacity),
    rotation: readNumber(context, dict, 'Rotate') ? formatNumber(readNumber(context, dict, 'Rotate')) : null,
    fringe: readNumbers(context, dict, 'RD')?.length === 4 ? formatNumberList(readNumbers(context, dict, 'RD')) : null,
    ...borderAttrs(context, dict),
  };
}

function lineEndings(context, dict) {
  const le = readNames(context, dict, 'LE');
  if (!le) return {};
  return { head: le[0] || 'None', tail: le[1] || 'None' };
}

const STANDARD_STAMP_NAMES = new Set([
  'Approved', 'Experimental', 'NotApproved', 'AsIs', 'Expired', 'NotForPublicRelease',
  'Confidential', 'Final', 'Sold', 'Departmental', 'ForComment', 'TopSecret', 'Draft', 'ForPublicRelease',
]);

function typeSpecific(element, context, dict) {
  const attrs = {};
  const children = [];
  if (element === 'line') {
    const l = readNumbers(context, dict, 'L');
    if (!l || l.length !== 4) return null;
    attrs.start = `${formatNumber(l[0])},${formatNumber(l[1])}`;
    attrs.end = `${formatNumber(l[2])},${formatNumber(l[3])}`;
    Object.assign(attrs, lineEndings(context, dict));
    attrs.leaderLength = readNumber(context, dict, 'LL') == null ? null : formatNumber(readNumber(context, dict, 'LL'));
    attrs.intent = readName(context, dict, 'IT');
  } else if (element === 'polygon' || element === 'polyline') {
    const vertices = readNumbers(context, dict, 'Vertices');
    if (!vertices || vertices.length < 4) return null;
    if (element === 'polyline') Object.assign(attrs, lineEndings(context, dict));
    children.push(xmlTextElement('vertices', formatPointList(vertices), I2));
  } else if (element === 'ink') {
    const lists = readNumberLists(context, dict, 'InkList');
    if (!lists?.length) return null;
    const gestures = lists.map((list) => xmlTextElement('gesture', formatPointList(list), I3));
    children.push(xmlElement('inklist', {}, gestures, I2));
  } else if (MARKUP_ELEMENTS.has(element)) {
    const quads = readNumbers(context, dict, 'QuadPoints');
    if (quads?.length >= 8) attrs.coords = formatNumberList(quads);
    if (element === 'redact') attrs['overlay-text'] = readText(context, dict, 'OverlayText');
  } else if (element === 'freetext') {
    const q = readNumber(context, dict, 'Q');
    attrs.justification = q === 1 ? 'centered' : q === 2 ? 'right' : null;
    const cl = readNumbers(context, dict, 'CL');
    if (cl?.length >= 4) attrs.callout = formatNumberList(cl);
    attrs.head = readName(context, dict, 'LE');
    attrs.intent = readName(context, dict, 'IT');
    const da = readText(context, dict, 'DA');
    const ds = readText(context, dict, 'DS');
    if (da) children.push(xmlTextElement('defaultappearance', da, I2));
    if (ds) children.push(xmlTextElement('defaultstyle', ds, I2));
  } else if (element === 'text') {
    attrs.icon = readName(context, dict, 'Name');
  } else if (element === 'stamp') {
    // XFDF here carries no appearance stream, so only a standard named stamp
    // survives the trip. A custom picture/symbol stamp would come back as a
    // blank default stamp; report it as skipped instead of claiming success.
    const icon = readName(context, dict, 'Name');
    if (!icon || !STANDARD_STAMP_NAMES.has(icon)) return { skipped: 'custom-appearance' };
    attrs.icon = icon;
  } else if (element === 'link') {
    const action = readDict(context, dict, 'A');
    const uri = action && readName(context, action, 'S') === 'URI' ? readText(context, action, 'URI') : null;
    if (uri) {
      const uriEl = xmlElement('URI', { Name: uri }, [], `${I3}  `);
      children.push(xmlElement('OnActivation', {}, [xmlElement('Action', {}, [uriEl], I3)], I2));
    }
  }
  return { attrs, children };
}

/**
 * @returns {{ element: string, subtype: string, xml: string } | { skipped: string, subtype: string }}
 */
export function annotDictToXfdf(context, dict, pageIndex) {
  const subtype = dict?.get?.(PDFName.of('Subtype'))?.decodeText?.() || 'Unknown';
  const element = XFDF_ELEMENT_BY_SUBTYPE[subtype];
  if (!element) return { skipped: 'unsupported-subtype', subtype };
  const extra = typeSpecific(element, context, dict);
  if (!extra) return { skipped: 'missing-geometry', subtype };
  if (extra.skipped) return { skipped: extra.skipped, subtype };
  const attrs = { ...commonAttrs(context, dict, pageIndex), ...extra.attrs };
  if (subtype === 'SurveyMarker' && !attrs.subject) attrs.subject = 'Survey marker';
  const contents = readText(context, dict, 'Contents');
  const children = [
    contents ? xmlTextElement('contents', contents, I2) : null,
    ...extra.children,
  ];
  return { element, subtype, xml: xmlElement(element, attrs, children, I1) };
}
