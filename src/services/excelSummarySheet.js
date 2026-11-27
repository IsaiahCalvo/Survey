// The Summary sheet in an exported survey workbook: the same numbers the
// Survey agent's end-of-walk summary speaks (surveySummary.js), as a sheet a
// surveyor can hand on. Added last, so the category sheets keep their
// places; its name has no " - Module" part, so Excel import never takes it
// for a category sheet.
import { summarizeSurvey } from './surveySummary.js';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };

/**
 * Base filename for Export data (.xlsx): prefer the Project name, then the open
 * sheet/document name (sans .pdf), then the template name (#1714).
 */
export function surveyExportBaseName({ projectName, documentName, templateName } = {}) {
  const clean = (value) => String(value || '').trim();
  const docBase = clean(documentName).replace(/\.pdf$/i, '').trim();
  return clean(projectName) || docBase || clean(templateName) || 'survey';
}

/** Adds the sheet to an ExcelJS workbook. Returns the sheet name used. */
export function addSummarySheet(workbook, { template, markers, title = null, when = new Date() }) {
  const taken = new Set(workbook.worksheets.map((ws) => ws.name));
  const name = ['Summary', 'Survey summary', 'Survey summary (2)'].find((n) => !taken.has(n)) || `Summary ${taken.size + 1}`;
  const summary = summarizeSurvey({ template, markers });
  const ws = workbook.addWorksheet(name);
  ws.columns = [{ width: 28 }, { width: 24 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 }];

  ws.addRow([`${String(title || '').trim() || template?.name || 'Survey'}: summary`]).font = { bold: true, size: 14 };
  ws.addRow([`Exported ${when.toLocaleString()}`]);
  const t = summary.totals;
  ws.addRow([`${t.items} item${t.items === 1 ? '' : 's'}: ${t.done} done, ${t.partly} partly done, ${t.notStarted} not started, ${t.withIssues} with issues.`]);
  ws.addRow([]);

  const head = ws.addRow(['Category', 'Items', 'Done', 'Partly done', 'Not started', 'With issues']);
  head.font = { bold: true };
  // Counts are numbers, which Excel right-aligns; their headers follow, so
  // each count sits under its own header.
  head.eachCell((cell, col) => { cell.fill = HEADER_FILL; if (col > 1) cell.alignment = { horizontal: 'right' }; });
  for (const c of summary.categories) ws.addRow([c.name, c.items, c.done, c.partly, c.notStarted, c.issues.length]);
  ws.addRow(['Total', t.items, t.done, t.partly, t.notStarted, t.withIssues]).font = { bold: true };

  const issues = summary.categories.flatMap((c) => c.issues.flatMap((i) => i.lines.map((l) => [c.name, i.name, l.text, l.answer])));
  ws.addRow([]);
  if (!issues.length) {
    ws.addRow(['No items with issues.']);
  } else {
    const issueHead = ws.addRow(['Category', 'Item', 'Checklist line', 'Answer']);
    issueHead.font = { bold: true };
    issueHead.eachCell((cell) => { cell.fill = HEADER_FILL; });
    for (const row of issues) ws.addRow(row);
  }
  fitColumns(ws);
  // One page wide when printed, so "With issues" never spills to its own page.
  ws.pageSetup = { ...ws.pageSetup, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return name;
}

// Each column as wide as its longest cell (within limits). The first three
// rows are one-line notes that run across the sheet, so they don't count.
function fitColumns(ws) {
  ws.columns.forEach((column, index) => {
    let longest = 0;
    column.eachCell({ includeEmpty: false }, (cell) => {
      if (Number(cell.row) <= 3) return;
      longest = Math.max(longest, String(cell.value ?? '').length);
    });
    ws.getColumn(index + 1).width = Math.min(60, Math.max(10, longest + 2));
  });
}
