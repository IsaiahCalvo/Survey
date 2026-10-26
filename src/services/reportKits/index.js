/**
 * reportKits — the survey report layouts ("report kits", nightly flag
 * 'survey-report'). A report kit is plain data: the blocks the report draws,
 * in order (validateReportKit in kitShape.js). A template picks one with
 * `template.reportKitId`; unset means the full report.
 *
 *   { id: 'progress-report', kind: 'reportKit', version: '1.0.0', minEngine: 1,
 *     label: 'Progress', blocks: [{ type: 'cover' }, { type: 'chart', style: 'pie' }, ...] }
 *
 * Blocks: cover (title, document, date), totals (the five tiles), chart
 * (stacked bar per category, or a pie of the whole survey), table (numbers
 * per category), issues (the items with an issue, paged by height).
 */
import { validateReportKit } from '../../../supabase/functions/_shared/kitShape.js';

export { REPORT_BLOCK_TYPES, REPORT_CHART_STYLES, validateReportKit } from '../../../supabase/functions/_shared/kitShape.js';

export const REPORT_ENGINE_VERSION = 1;
export const DEFAULT_REPORT_KIT_ID = 'full-report';

const kit = (id, label, description, blocks) => Object.freeze({
  id, kind: 'reportKit', version: '1.0.0', minEngine: 1, label, description,
  blocks: Object.freeze(blocks.map((b) => Object.freeze(b))),
});

export const BUILT_IN_REPORT_KITS = Object.freeze([
  kit(DEFAULT_REPORT_KIT_ID, 'Full report', 'Totals, a bar chart and a table per category, then the items with issues',
    [{ type: 'cover' }, { type: 'totals' }, { type: 'chart', style: 'stacked' }, { type: 'table' }, { type: 'issues' }]),
  kit('progress-report', 'Progress', 'Totals, a pie of the whole survey and a table per category; no issue list',
    [{ type: 'cover' }, { type: 'totals' }, { type: 'chart', style: 'pie' }, { type: 'table' }]),
  kit('issues-report', 'Issues list', 'Only the items with issues, for the crew fixing them',
    [{ type: 'cover' }, { type: 'issues' }]),
]);

BUILT_IN_REPORT_KITS.forEach((k) => {
  const errors = validateReportKit(k);
  if (errors.length) throw new TypeError(`report kit ${k.id}: ${errors.join('; ')}`);
});

/** Every report kit the app can draw, the full report first. */
export const listReportKits = () => BUILT_IN_REPORT_KITS.filter((k) => k.minEngine <= REPORT_ENGINE_VERSION);

export const getReportKit = (id) => listReportKits().find((k) => k.id === id) || null;

/** The template's report kit, else the full report. */
export const reportKitFor = (template) => getReportKit(template?.reportKitId) || getReportKit(DEFAULT_REPORT_KIT_ID);
