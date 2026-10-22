// Survey report as a PowerPoint deck (nightly flag 'survey-report'): a cover,
// the totals with a bar chart of done / partly done / not started per
// category, and the items with issues. Charts and tables are real PowerPoint
// ones, so the customer can still edit them. The numbers come from
// summarizeSurvey, the same source as the Excel Summary sheet and the agent.
import { summarizeSurvey } from './surveySummary.js';

// Status colors (done / partly / not started); each also has a legend label.
const STATUS = Object.freeze({ done: '0CA30C', partly: 'FAB219', notStarted: 'A6A6A6' });
const INK = '1F2329';
const MUTED = '5B6270';
const RULE = 'D9DCE1';
const FONT = 'Arial';
export const ISSUE_ROWS_PER_SLIDE = 12;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * What goes on each slide, as plain data (no PowerPoint yet), so it can be
 * tested and reused by other report formats later.
 */
export function surveyReportPlan({ template, markers, documentName = '', when = new Date() } = {}) {
  const summary = summarizeSurvey({ template, markers });
  const title = `${template?.name || 'Survey'} report`;
  const t = summary.totals;
  const issueRows = summary.categories.flatMap((c) => c.issues.map((issue) => ({
    category: c.name,
    item: issue.name,
    lines: issue.lines.map((l) => `${l.text}: ${l.answer}`).join('; '),
  })));
  const issuePages = [];
  for (let i = 0; i < issueRows.length; i += ISSUE_ROWS_PER_SLIDE) issuePages.push(issueRows.slice(i, i + ISSUE_ROWS_PER_SLIDE));
  return {
    title,
    subtitle: [documentName, when.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })].filter(Boolean).join(' · '),
    tiles: [
      { label: 'Items', value: t.items },
      { label: 'Done', value: t.done },
      { label: 'Partly done', value: t.partly },
      { label: 'Not started', value: t.notStarted },
      { label: 'With issues', value: t.withIssues },
    ],
    headline: `${plural(t.items, 'item')}: ${t.done} done, ${t.partly} partly done, ${t.notStarted} not started, ${t.withIssues} with issues.`,
    chart: {
      categories: summary.categories.map((c) => c.name),
      series: [
        { name: 'Done', color: STATUS.done, values: summary.categories.map((c) => c.done) },
        { name: 'Partly done', color: STATUS.partly, values: summary.categories.map((c) => c.partly) },
        { name: 'Not started', color: STATUS.notStarted, values: summary.categories.map((c) => c.notStarted) },
      ],
    },
    categoryRows: summary.categories.map((c) => [c.name, c.items, c.done, c.partly, c.notStarted, c.issues.length]),
    issuePages,
  };
}

const text = (slide, value, opts) => slide.addText(String(value), { fontFace: FONT, color: INK, margin: 0, ...opts });

/** Build the deck. PptxGenJS is passed in so the app can load it on demand. */
export function buildSurveyReport(PptxGenJS, input) {
  const plan = surveyReportPlan(input);
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pptx.title = plan.title;
  pptx.company = 'Survey';

  // Cover.
  const cover = pptx.addSlide();
  text(cover, plan.title, { x: 0.8, y: 2.6, w: 11.7, h: 1, fontSize: 40, bold: true });
  text(cover, plan.subtitle, { x: 0.8, y: 3.7, w: 11.7, h: 0.5, fontSize: 18, color: MUTED });

  // Totals and progress per category.
  const totals = pptx.addSlide();
  text(totals, 'Progress', { x: 0.6, y: 0.4, w: 12, h: 0.6, fontSize: 28, bold: true });
  text(totals, plan.headline, { x: 0.6, y: 1.0, w: 12, h: 0.4, fontSize: 14, color: MUTED });
  plan.tiles.forEach((tile, i) => {
    const x = 0.6 + i * 2.45;
    totals.addShape(pptx.ShapeType.rect, { x, y: 1.6, w: 2.25, h: 1.1, fill: { color: 'FFFFFF' }, line: { color: RULE, width: 1 } });
    text(totals, tile.value, { x: x + 0.15, y: 1.7, w: 1.95, h: 0.55, fontSize: 28, bold: true });
    text(totals, tile.label, { x: x + 0.15, y: 2.25, w: 1.95, h: 0.35, fontSize: 12, color: MUTED });
  });
  if (plan.chart.categories.length) {
    // A horizontal bar chart draws its first category at the bottom; reverse
    // so it reads top-down like the table.
    const labels = [...plan.chart.categories].reverse();
    totals.addChart(pptx.ChartType.bar, plan.chart.series.map((s) => ({ name: s.name, labels, values: [...s.values].reverse() })), {
      x: 0.6, y: 3.0, w: 12.1, h: 4.1,
      barDir: 'bar',
      barGrouping: 'stacked',
      barGapWidthPct: 60,
      chartColors: plan.chart.series.map((s) => s.color),
      showLegend: true,
      legendPos: 't',
      legendFontFace: FONT,
      legendFontSize: 11,
      catAxisLabelFontFace: FONT,
      catAxisLabelFontSize: 11,
      valAxisLabelFontFace: FONT,
      valAxisLabelFontSize: 10,
      valAxisMinVal: 0,
      valGridLine: { color: 'EEEEEE', size: 0.5 },
      catGridLine: { style: 'none' },
    });
  } else {
    text(totals, 'No survey items yet.', { x: 0.6, y: 3.2, w: 12, h: 0.5, fontSize: 16, color: MUTED });
  }

  // The same numbers as a table (the chart's readable twin).
  if (plan.categoryRows.length) {
    const table = pptx.addSlide();
    text(table, 'By category', { x: 0.6, y: 0.4, w: 12, h: 0.6, fontSize: 28, bold: true });
    const head = ['Category', 'Items', 'Done', 'Partly done', 'Not started', 'With issues'].map((h) => ({ text: h, options: { bold: true, color: MUTED } }));
    table.addTable([head, ...plan.categoryRows.map((r) => r.map((v) => ({ text: String(v) })))], {
      x: 0.6, y: 1.2, w: 12.1, colW: [4.6, 1.5, 1.5, 1.5, 1.5, 1.5],
      fontFace: FONT, fontSize: 12, color: INK, border: { type: 'solid', pt: 0.5, color: RULE }, autoPage: true,
    });
  }

  // Items with issues.
  if (!plan.issuePages.length) {
    const none = pptx.addSlide();
    text(none, 'Issues', { x: 0.6, y: 0.4, w: 12, h: 0.6, fontSize: 28, bold: true });
    text(none, 'No issues found.', { x: 0.6, y: 1.2, w: 12, h: 0.5, fontSize: 16, color: MUTED });
  }
  plan.issuePages.forEach((rows, page) => {
    const slide = pptx.addSlide();
    const suffix = plan.issuePages.length > 1 ? ` (${page + 1} of ${plan.issuePages.length})` : '';
    text(slide, `Issues${suffix}`, { x: 0.6, y: 0.4, w: 12, h: 0.6, fontSize: 28, bold: true });
    const head = ['Category', 'Item', 'Lines with a problem answer'].map((h) => ({ text: h, options: { bold: true, color: MUTED } }));
    slide.addTable([head, ...rows.map((r) => [{ text: r.category }, { text: r.item }, { text: r.lines }])], {
      x: 0.6, y: 1.2, w: 12.1, colW: [2.6, 2.4, 7.1],
      fontFace: FONT, fontSize: 11, color: INK, border: { type: 'solid', pt: 0.5, color: RULE }, valign: 'top',
    });
  });

  return pptx;
}

/** The file name for a report: "<template> report.pptx" without unsafe characters. */
export function surveyReportFileName(template) {
  const base = String(template?.name || 'Survey').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Survey';
  return `${base} report.pptx`;
}

/** Make the deck and hand it to the browser (or the app's share sheet). */
export async function downloadSurveyReport(input) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const blob = await buildSurveyReport(PptxGenJS, input).write({ outputType: 'blob' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = surveyReportFileName(input?.template);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
