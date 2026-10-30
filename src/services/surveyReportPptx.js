// Survey report as a PowerPoint deck (nightly flag 'survey-report'), drawn
// from a report kit (src/services/reportKits): a cover, the totals, a bar
// chart of done / partly done / not started per category (or a pie of the
// whole survey), a table per category and the items with issues. Charts and
// tables are real PowerPoint ones, so the customer can still edit them. The numbers come from
// summarizeSurvey, the same source as the Excel Summary sheet and the agent.
import { summarizeSurvey } from './surveySummary.js';
import { reportKitFor } from './reportKits/index.js';

// Status colors (done / partly / not started); each also has a legend label.
const STATUS = Object.freeze({ done: '0CA30C', partly: 'FAB219', notStarted: 'A6A6A6' });
const INK = '1F2329';
const MUTED = '5B6270';
const RULE = 'D9DCE1';
const FONT = 'Arial';

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
    id: issue.id,
    category: c.name,
    item: issue.name,
    lines: issue.lines.map((l) => `${l.text}: ${l.answer}`).join('; '),
  })));
  return {
    title,
    subtitle: [documentName, when.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })].filter(Boolean).join(' · '),
    totals: t,
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
    issueRows,
  };
}

const text = (slide, value, opts) => slide.addText(String(value), { fontFace: FONT, color: INK, margin: 0, ...opts });

const heading = (slide, value) => text(slide, value, { x: 0.6, y: 0.4, w: 12, h: 0.6, fontSize: 28, bold: true });
const note = (slide, value, y) => text(slide, value, { x: 0.6, y, w: 12, h: 0.5, fontSize: 16, color: MUTED });
const axisFonts = {
  legendFontFace: FONT, legendFontSize: 11, catAxisLabelFontFace: FONT, catAxisLabelFontSize: 11,
  valAxisLabelFontFace: FONT, valAxisLabelFontSize: 10,
};

function progressSlide(pptx, plan) {
  const slide = pptx.addSlide();
  heading(slide, 'Progress');
  text(slide, plan.headline, { x: 0.6, y: 1.0, w: 12, h: 0.4, fontSize: 14, color: MUTED });
  return slide;
}

// Each block draws itself; `shared` is the Progress slide the totals block
// just drew, so a chart right after it sits under the tiles.
const BLOCKS = {
  cover(pptx, plan) {
    const slide = pptx.addSlide();
    text(slide, plan.title, { x: 0.8, y: 2.6, w: 11.7, h: 1, fontSize: 40, bold: true });
    text(slide, plan.subtitle, { x: 0.8, y: 3.7, w: 11.7, h: 0.5, fontSize: 18, color: MUTED });
  },

  totals(pptx, plan) {
    const slide = progressSlide(pptx, plan);
    plan.tiles.forEach((tile, i) => {
      const x = 0.6 + i * 2.45;
      slide.addShape(pptx.ShapeType.rect, { x, y: 1.6, w: 2.25, h: 1.1, fill: { color: 'FFFFFF' }, line: { color: RULE, width: 1 } });
      text(slide, tile.value, { x: x + 0.15, y: 1.7, w: 1.95, h: 0.55, fontSize: 28, bold: true });
      text(slide, tile.label, { x: x + 0.15, y: 2.25, w: 1.95, h: 0.35, fontSize: 12, color: MUTED });
    });
    return slide;
  },

  chart(pptx, plan, block, shared) {
    const slide = shared || progressSlide(pptx, plan);
    const top = shared ? 3.0 : 1.6;
    const box = { x: 0.6, y: top, w: 12.1, h: 7.1 - top };
    if (!plan.chart.categories.length) {
      note(slide, 'No survey items yet.', top + 0.2);
      return;
    }
    if (block.style === 'pie') {
      const t = plan.totals;
      slide.addChart(pptx.ChartType.pie, [{
        name: 'Survey', labels: ['Done', 'Partly done', 'Not started'], values: [t.done, t.partly, t.notStarted],
      }], {
        ...box,
        chartColors: [STATUS.done, STATUS.partly, STATUS.notStarted],
        showLegend: true, legendPos: 'r', legendFontFace: FONT, legendFontSize: 12,
        showPercent: true, showValue: false, dataLabelColor: 'FFFFFF', dataLabelFontFace: FONT, dataLabelFontSize: 12,
      });
      return;
    }
    // A horizontal bar chart draws its first category at the bottom; reverse
    // so it reads top-down like the table.
    const labels = [...plan.chart.categories].reverse();
    // Item counts: whole-number steps (a survey of one item read 0, 0.2, 0.4...).
    const most = Math.max(0, ...plan.chart.categories.map((_, row) => plan.chart.series.reduce((sum, s) => sum + (Number(s.values[row]) || 0), 0)));
    slide.addChart(pptx.ChartType.bar, plan.chart.series.map((s) => ({ name: s.name, labels, values: [...s.values].reverse() })), {
      ...box,
      ...axisFonts,
      barDir: 'bar',
      barGrouping: 'stacked',
      barGapWidthPct: 60,
      chartColors: plan.chart.series.map((s) => s.color),
      showLegend: true,
      legendPos: 't',
      valAxisMinVal: 0,
      valAxisMajorUnit: Math.max(1, Math.ceil(most / 5)),
      valAxisLabelFormatCode: '0',
      valGridLine: { color: 'EEEEEE', size: 0.5 },
      catGridLine: { style: 'none' },
    });
  },

  // The numbers per category as a table (the chart's readable twin).
  table(pptx, plan) {
    if (!plan.categoryRows.length) return;
    const slide = pptx.addSlide();
    heading(slide, 'By category');
    const head = ['Category', 'Items', 'Done', 'Partly done', 'Not started', 'With issues'].map((h) => ({ text: h, options: { bold: true, color: MUTED } }));
    slide.addTable([head, ...plan.categoryRows.map((r) => r.map((v) => ({ text: String(v) })))], {
      x: 0.6, y: 1.2, w: 12.1, colW: [4.6, 1.5, 1.5, 1.5, 1.5, 1.5],
      fontFace: FONT, fontSize: 12, color: INK, border: { type: 'solid', pt: 0.5, color: RULE }, autoPage: true,
    });
  },

  // Items with issues. One cell can hold many problem lines, so the table
  // splits by its drawn height (a tall row can carry on to the next slide)
  // and repeats its header on each continuation slide.
  issues(pptx, plan) {
    const slide = pptx.addSlide();
    heading(slide, 'Issues');
    if (!plan.issueRows.length) {
      note(slide, 'No issues found.', 1.2);
      return;
    }
    const head = ['Category', 'Item', 'Lines with a problem answer'].map((h) => ({ text: h, options: { bold: true, color: MUTED } }));
    slide.addTable([head, ...plan.issueRows.map((r) => [{ text: r.category }, { text: r.item }, { text: r.lines }])], {
      x: 0.6, y: 1.2, w: 12.1, h: 5.9, colW: [2.6, 2.4, 7.1],
      fontFace: FONT, fontSize: 11, color: INK, border: { type: 'solid', pt: 0.5, color: RULE }, valign: 'top',
      autoPage: true, autoPageRepeatHeader: true, autoPageHeaderRows: 1, autoPageSlideStartY: 0.6,
    });
  },
};

/**
 * Build the deck. PptxGenJS is passed in so the app can load it on demand.
 * The blocks come from `input.kit`, else the template's report kit (the full
 * report unless the template picks another).
 */
export function buildSurveyReport(PptxGenJS, input) {
  const plan = surveyReportPlan(input);
  const kit = input?.kit || reportKitFor(input?.template);
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pptx.title = plan.title;
  pptx.company = 'Survey';
  let shared = null;
  for (const block of kit.blocks) {
    const draw = BLOCKS[block.type];
    const previous = shared;
    shared = null;
    if (!draw) continue; // validateReportKit keeps unknown blocks out; never draw half a deck
    const slide = draw(pptx, plan, block, block.type === 'chart' ? previous : null);
    if (block.type === 'totals') shared = slide;
  }
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
