// Survey export as plain text, for the outside AI connector (survey-mcp's
// export_survey tool). An AI chat app cannot download the Excel file the
// app's Export data button makes, so the connector hands back the same facts
// as text it can read, sum up or turn into its own spreadsheet: a counts
// summary, or one CSV row per item.
//
// Pure (no Deno or browser APIs), so node tests load it directly.

export const EXPORT_CSV_MAX_ROWS = 2000;

// A cell that starts with = + - @ (or a tab / return) would run as a formula
// when the CSV is opened in Excel; a leading quote keeps it text.
export function csvCell(value) {
  const textValue = value == null ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(textValue) ? `'${textValue}` : textValue;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * @param {Array<{ name: string, category: string|null, entity: string|null, page: number|null,
 *   answers: Array<{ item: string, answer: string|null }>, note: string, files: number }>} items
 * @param {{ title?: string }} [opts]
 */
export function surveySummaryText(items, { title = 'Survey' } = {}) {
  const list = Array.isArray(items) ? items : [];
  const byCategory = new Map();
  const byStatus = new Map();
  let answered = 0;
  let total = 0;
  let noCount = 0;
  for (const item of list) {
    const cat = item.category || '(no category)';
    byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
    const status = item.entity || '(no status)';
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
    for (const a of item.answers || []) {
      total += 1;
      if (a.answer) answered += 1;
      if (a.answer === 'N') noCount += 1;
    }
  }
  const sortCounts = (map) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const lines = [`${title}: ${list.length} item${list.length === 1 ? '' : 's'}`];
  if (total) lines.push(`Checklist: ${answered} of ${total} answered${noCount ? `, ${noCount} answered No` : ''}`);
  lines.push('', 'By category:');
  for (const [name, n] of sortCounts(byCategory)) lines.push(`- ${name}: ${n}`);
  if (byStatus.size > 1 || !byStatus.has('(no status)')) {
    lines.push('', 'By status:');
    for (const [name, n] of sortCounts(byStatus)) lines.push(`- ${name}: ${n}`);
  }
  return lines.join('\n');
}

export function surveyItemsCsv(items, { maxRows = EXPORT_CSV_MAX_ROWS } = {}) {
  const list = (Array.isArray(items) ? items : []).slice(0, maxRows);
  const head = ['Item', 'Category', 'Status', 'Page', 'Answered', 'Of', 'Answers', 'Note', 'Photos and files'];
  const rows = [head.map(csvCell).join(',')];
  for (const item of list) {
    const answers = item.answers || [];
    const said = answers.filter((a) => a.answer).map((a) => `${a.item}: ${a.answer}`).join('; ');
    rows.push([
      item.name, item.category || '', item.entity || '', item.page ?? '',
      answers.filter((a) => a.answer).length, answers.length, said, item.note || '', item.files || 0,
    ].map(csvCell).join(','));
  }
  return `${rows.join('\r\n')}\r\n`;
}
