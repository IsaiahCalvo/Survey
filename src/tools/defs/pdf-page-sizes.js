// PDF page sizes and info: a table of every page's size, named (ARCH D,
// Tabloid, A1...), plus facts about the file. Saves as CSV; no PDF out.
import { ToolError, base } from '../kit.js';
import { looksEncrypted } from '../qpdf.js';
import {
  pageRow, docFacts, summarize, describeRow, inches, mm, toCsv,
} from '../pageSizes.js';

async function hasText(page) {
  try {
    const content = await page.getTextContent();
    return content.items.some((it) => (it.str || '').trim());
  } catch {
    return null;
  }
}

// pdf.js lists a parent like "job" as well as its field "job.number"; count
// only the fields people fill in.
function countFields(fields) {
  const names = Object.keys(fields || {});
  return names.filter((n) => !names.some((o) => o.startsWith(`${n}.`))).length;
}

function factsView(h, facts) {
  return h('dl', { class: 'rfacts' }, facts.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

function tableView(h, rows) {
  // A size that differs from the most common one is shown in red.
  const counts = new Map();
  rows.forEach((r) => counts.set(describeRow(r), (counts.get(describeRow(r)) || 0) + 1));
  const main = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const head = h('tr', {}, ['Page', 'Size', 'Inches', 'mm', 'Text'].map((t) => h('th', { scope: 'col' }, t)));
  const body = rows.map((r) => h('tr', {},
    h('td', {}, String(r.page)),
    h('td', { class: counts.size > 1 && describeRow(r) !== main ? 'off' : null }, describeRow(r)),
    h('td', {}, `${inches(r.width)} x ${inches(r.height)}`),
    h('td', {}, `${mm(r.width)} x ${mm(r.height)}`),
    h('td', {}, r.hasText == null ? '?' : r.hasText ? 'Yes' : 'No')));
  return h('div', { class: 'rtable', tabindex: '0', role: 'region', 'aria-label': 'Page sizes' },
    h('table', {}, h('thead', {}, head), h('tbody', {}, body)));
}

export default {
  view: 'files',
  auto: true,
  keepLock: true,
  async run([file], opts, progress) {
    if (file.locked) throw new ToolError('This PDF is locked with a password. Unlock it first, then try again.');
    const pdf = await file.pdfjs();
    const rows = [];
    for (let i = 0; i < pdf.numPages; i += 1) {
      progress(`Page ${i + 1} of ${pdf.numPages}`);
      const page = await pdf.getPage(i + 1);
      rows.push(pageRow(i, page.view, page.rotate, await hasText(page), page.userUnit || 1));
      page.cleanup();
    }
    const meta = await pdf.getMetadata().catch(() => ({}));
    const fields = await pdf.getFieldObjects().catch(() => null);
    const facts = docFacts({
      pages: pdf.numPages,
      fileSize: file.size,
      info: meta.info || {},
      encrypted: !!meta.info?.EncryptFilterName || looksEncrypted(file.bytes),
      fields: countFields(fields),
      scanned: rows.filter((r) => r.hasText === false).length,
    });
    const summary = summarize(rows);
    return [{
      name: `${base(file.name)}-page-sizes.csv`,
      bytes: new TextEncoder().encode(toCsv(facts, rows)),
      type: 'text/csv;charset=utf-8',
      title: 'Page sizes',
      saveLabel: 'Download as CSV',
      view: (h) => h('div', {}, h('p', { class: 'rsum' }, summary), factsView(h, facts), tableView(h, rows)),
    }];
  },
};
