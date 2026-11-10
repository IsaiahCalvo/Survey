/**
 * drawboardStamps.js — Drawboard Projects' twelve preset stamps (Nightly
 * 'stamp-tool'; checked live 2026-11-10, /mnt/project-files/drawboard-trial/
 * deep/stamps-and-captions.md section 1).
 *
 * Every preset looks the same: a 120 x 60 pt box with square corners and no
 * fill, a 2 pt #FF4F68 border, and its words in 11 pt #FF4F68 capitals, one
 * line in the middle or two lines 18 pt apart, centred (properly, not with
 * leading spaces as Drawboard does). Drawboard draws them in Noto Sans; a
 * text mark takes one plain font name (fabric measuring rule), so Helvetica.
 *
 * Each preset is a bordered text box, so it draws, prints, exports and syncs
 * like any other text mark. Items look like library items so the library's
 * own click-then-click placement drops them (markLibraryPlacement.js).
 */
import { buildNewTextCommitJSON } from '../utils/textEditCommit.js';

export const STAMP_PRESET_ID_PREFIX = 'stamp-preset:';
export const STAMP_PRESET_COLOUR = '#FF4F68';
export const STAMP_BOX = Object.freeze({ width: 120, height: 60 });
export const STAMP_FONT_SIZE = 11;
export const STAMP_LINE_GAP = 18;

// In menu order; each entry is its lines.
export const STAMP_PRESETS = Object.freeze([
  ['draft-issue', ['DRAFT ISSUE']],
  ['for-review', ['FOR REVIEW']],
  ['check-print', ['CHECK PRINT']],
  ['preliminary-issue', ['PRELIMINARY', 'ISSUE']],
  ['approved', ['APPROVED']],
  ['for-information-only', ['FOR INFORMATION', 'ONLY']],
  ['revise-and-resubmit', ['REVISE', 'AND RESUBMIT']],
  ['revised', ['REVISED']],
  ['rejected', ['REJECTED']],
  ['not-for-construction', ['NOT FOR', 'CONSTRUCTION']],
  ['for-construction', ['FOR', 'CONSTRUCTION']],
  ['as-built', ['AS-BUILT']],
].map(([key, lines]) => Object.freeze({ key, lines: Object.freeze(lines), label: lines.join(' ') })));

// The text box's line step is fontSize x lineHeight x 1.13
// (svgAnnotationRenderers buildPlainTextContentStyle), so 18 pt apart at 11 pt:
export const STAMP_LINE_HEIGHT = STAMP_LINE_GAP / (STAMP_FONT_SIZE * 1.13);

/** The preset's text box, its outer top-left at (0, 0). */
export function stampPresetObject(preset) {
  const pad = 6; // TEXT_PADDING
  const json = buildNewTextCommitJSON({
    text: preset.lines.join('\n'),
    left: 0,
    top: 0,
    innerWrapWidth: STAMP_BOX.width - 2 * pad,
    lineCount: preset.lines.length,
    naturalInnerHeight: Math.ceil(STAMP_LINE_GAP * preset.lines.length),
    fill: STAMP_PRESET_COLOUR,
    stroke: STAMP_PRESET_COLOUR,
    strokeWidth: 2,
    style: { fontSize: STAMP_FONT_SIZE, fontFamily: 'Helvetica', fontWeight: 'normal', textAlign: 'center', verticalAlign: 'middle' },
    autoFit: false,
    minOuterHeight: STAMP_BOX.height,
  });
  json.width = STAMP_BOX.width;
  json.height = STAMP_BOX.height;
  json.lineHeight = STAMP_LINE_HEIGHT;
  json.strokeLineJoin = 'miter';
  json.data = { ...(json.data || {}), stampPreset: preset.key };
  return json;
}

/** The twelve presets as library-like items: { id, name, kinds, payload, builtIn }. */
export function stampPresetItems() {
  return STAMP_PRESETS.map((preset) => {
    const object = stampPresetObject(preset);
    return {
      id: `${STAMP_PRESET_ID_PREFIX}${preset.key}`,
      name: preset.label,
      lines: preset.lines,
      kinds: ['stamp'],
      tags: [],
      builtIn: true,
      payload: {
        version: 1,
        pageWidth: 612,
        pageHeight: 792,
        extent: { left: 0, top: 0, width: object.width, height: object.height },
        items: [{ kind: 'mark', object }],
      },
    };
  });
}

export const isStampPresetItem = (item) => typeof item?.id === 'string' && item.id.startsWith(STAMP_PRESET_ID_PREFIX);
