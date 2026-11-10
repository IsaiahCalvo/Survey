/**
 * reviewStamps.js — the ready-made review stamps in the Library panel's
 * Stamps tab (beta flag 'review-stamps', Survey Nightly only).
 *
 * Drawboard Projects' Stamp tool offers twelve review stamps (Approved,
 * Rejected, For construction ...). Ours are the same twelve words, each a
 * bordered, bold, centred text box with a second line that fills in the
 * placer's name and today's date when it lands ({{tokens}}, the mark
 * library's own placement rule). A text box draws, prints, exports and syncs
 * like any other text mark, and stays editable after it is placed.
 *
 * Items here look like library items (id, name, kinds, payload) so the panel
 * draws and places them with the same code; they are built in, never saved.
 */
import { buildNewTextCommitJSON } from '../utils/textEditCommit.js';
import { resolveLibraryTokens } from './markLibraryModel.js';

export const REVIEW_STAMP_ID_PREFIX = 'review-stamp:';
export const REVIEW_STAMP_SECOND_LINE = '{{author.name}} · {{date}}';

const GREEN = '#15803d';
const RED = '#dc2626';
const BLUE = '#2563eb';
const AMBER = '#b45309';

export const REVIEW_STAMPS = Object.freeze([
  { key: 'approved', label: 'Approved', color: GREEN },
  { key: 'for-review', label: 'For review', color: BLUE },
  { key: 'revise-resubmit', label: 'Revise and resubmit', color: RED },
  { key: 'rejected', label: 'Rejected', color: RED },
  { key: 'for-construction', label: 'For construction', color: GREEN },
  { key: 'not-for-construction', label: 'Not for construction', color: RED },
  { key: 'as-built', label: 'As-built', color: GREEN },
  { key: 'revised', label: 'Revised', color: AMBER },
  { key: 'draft-issue', label: 'Draft issue', color: AMBER },
  { key: 'preliminary-issue', label: 'Preliminary issue', color: AMBER },
  { key: 'check-print', label: 'Check print', color: BLUE },
  { key: 'for-information', label: 'For information only', color: BLUE },
].map(Object.freeze));

const FONT_SIZE = 14;
// The text box's line step (svgAnnotationRenderers buildPlainTextContentStyle:
// Fabric's 1.16 line height x its 1.13 step).
const LINE_STEP = FONT_SIZE * 1.16 * 1.13;
// Wide enough for the longest word and a usual "Name · Mon D, YYYY" line.
const INNER_WIDTH = 196;

/** The stamp's one text box, its top-left at (0, 0). */
export function reviewStampObject(stamp) {
  const json = buildNewTextCommitJSON({
    text: `${stamp.label.toUpperCase()}\n${REVIEW_STAMP_SECOND_LINE}`,
    left: 0,
    top: 0,
    innerWrapWidth: INNER_WIDTH,
    lineCount: 2,
    naturalInnerHeight: Math.ceil(LINE_STEP * 2),
    fill: stamp.color,
    stroke: stamp.color,
    strokeWidth: 2.5,
    style: { fontSize: FONT_SIZE, fontWeight: 'bold', textAlign: 'center', verticalAlign: 'middle' },
    autoFit: false,
  });
  json.data = { ...(json.data || {}), reviewStamp: stamp.key };
  return json;
}

function payloadFor(object) {
  return {
    version: 1,
    pageWidth: 612,
    pageHeight: 792,
    extent: { left: 0, top: 0, width: object.width, height: object.height },
    items: [{ kind: 'mark', object }],
  };
}

/** The twelve stamps as library-like items: { id, name, kinds, tags, payload, builtIn }. */
export function reviewStampItems() {
  return REVIEW_STAMPS.map((stamp) => ({
    id: `${REVIEW_STAMP_ID_PREFIX}${stamp.key}`,
    name: stamp.label,
    kinds: ['stamp'],
    tags: [],
    builtIn: true,
    color: stamp.color,
    payload: payloadFor(reviewStampObject(stamp)),
  }));
}

export const isReviewStampItem = (item) => typeof item?.id === 'string' && item.id.startsWith(REVIEW_STAMP_ID_PREFIX);

/**
 * The item as its card pictures it: the second line filled with the viewer's
 * own name (or "Your name") and today's date, as it will land.
 */
export function reviewStampPreviewItem(item, { authorName = '', now = new Date() } = {}) {
  const payload = JSON.parse(JSON.stringify(item.payload));
  for (const entry of payload.items) {
    if (typeof entry.object?.text === 'string') {
      entry.object.text = resolveLibraryTokens(entry.object.text, { authorName: authorName || 'Your name', now });
    }
  }
  return { ...item, id: `${item.id}:preview:${authorName}`, payload };
}
