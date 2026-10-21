// The Summary sheet in an exported survey workbook: the same numbers the
// Survey agent's end-of-walk summary speaks (surveySummary.js), as a sheet a
// surveyor can hand on. Added last, so the category sheets keep their
// places; its name has no " - Module" part, so Excel import never takes it
// for a category sheet.
import { summarizeSurvey } from './surveySummary.js';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };

/** Adds the sheet to an ExcelJS workbook. Returns the sheet name used. */
export function addSummarySheet(workbook, { template, markers, when = new Date() }) {
  const taken = new Set(workbook.worksheets.map((ws) => ws.name));
  const name = ['Summary', 'Survey summary', 'Survey summary (2)'].find((n) => !taken.has(n)) || `Summary ${taken.size + 1}`;
  const summary = summarizeSurvey({ template, markers });
  const ws = workbook.addWorksheet(name);
  ws.columns = [{ width: 28 }, { width: 24 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 }];

  ws.addRow([`${template?.name || 'Survey'}: summary`]).font = { bold: true, size: 14 };
  ws.addRow([`Exported ${when.toLocaleString()}`]);
  const t = summary.totals;
  ws.addRow([`${t.items} item${t.items === 1 ? '' : 's'}: ${t.done} done, ${t.partly} partly done, ${t.notStarted} not started, ${t.withIssues} with issues.`]);
  ws.addRow([]);

  const head = ws.addRow(['Category', 'Items', 'Done', 'Partly done', 'Not started', 'With issues']);
  head.font = { bold: true };
  head.eachCell((cell) => { cell.fill = HEADER_FILL; });
  for (const c of summary.categories) ws.addRow([c.name, c.items, c.done, c.partly, c.notStarted, c.issues.length]);
  ws.addRow(['Total', t.items, t.done, t.partly, t.notStarted, t.withIssues]).font = { bold: true };

  const issues = summary.categories.flatMap((c) => c.issues.flatMap((i) => i.lines.map((l) => [c.name, i.name, l.text, l.answer])));
  ws.addRow([]);
  if (!issues.length) {
    ws.addRow(['No items with issues.']);
    return name;
  }
  const issueHead = ws.addRow(['Category', 'Item', 'Checklist line', 'Answer']);
  issueHead.font = { bold: true };
  issueHead.eachCell((cell) => { cell.fill = HEADER_FILL; });
  for (const row of issues) ws.addRow(row);
  return name;
}
