// Survey report as a PDF (nightly flag 'survey-report'): the same report
// kit blocks and numbers as the PowerPoint (surveyReportPlan), drawn with
// pdf-lib on landscape Letter pages. A table too long for a page carries on
// to the next with its header repeated.
import { surveyReportPlan } from './surveyReportPptx.js';
import { reportKitFor } from './reportKits/index.js';

const PAGE = [792, 612]; // Letter, landscape
const M = 48; // page margin
const STATUS_HEX = { Done: '0CA30C', 'Partly done': 'FAB219', 'Not started': 'A6A6A6' };

export async function buildSurveyReportPdf(PDFLib, input) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const plan = surveyReportPlan(input);
  const kit = input?.kit || reportKitFor(input?.template);
  const doc = await PDFDocument.create();
  doc.setTitle(plan.title);
  doc.setProducer('Survey');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const hex = (h) => rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
  const INK = hex('1F2329');
  const MUTED = hex('5B6270');
  const RULE = hex('D9DCE1');

  // The standard fonts only draw Latin text; anything else prints as "?".
  const okChar = new Map();
  const safe = (value) => [...String(value ?? '')].map((ch) => {
    if (!okChar.has(ch)) {
      try { font.encodeText(ch); bold.encodeText(ch); okChar.set(ch, true); } catch { okChar.set(ch, false); }
    }
    return okChar.get(ch) ? ch : '?';
  }).join('');
  const width = (s, size, f = font) => f.widthOfTextAtSize(s, size);
  const wrap = (value, size, maxWidth, f = font) => {
    const lines = [];
    for (const para of safe(value).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (width(next, size, f) <= maxWidth) { line = next; continue; }
        if (line) lines.push(line);
        // A word wider than the cell is cut to fit.
        let rest = word;
        while (width(rest, size, f) > maxWidth && rest.length > 1) {
          let n = rest.length - 1;
          while (n > 1 && width(rest.slice(0, n), size, f) > maxWidth) n -= 1;
          lines.push(rest.slice(0, n));
          rest = rest.slice(n);
        }
        line = rest;
      }
      lines.push(line);
    }
    return lines;
  };
  const text = (page, value, x, y, { size = 12, f = font, color = INK } = {}) => page.drawText(safe(value), { x, y, size, font: f, color });

  const newPage = (title) => {
    const page = doc.addPage(PAGE);
    if (title) text(page, title, M, PAGE[1] - M - 22, { size: 22, f: bold });
    return page;
  };
  const progressPage = () => {
    const page = newPage('Progress');
    text(page, plan.headline, M, PAGE[1] - M - 46, { size: 12, color: MUTED });
    return page;
  };

  // A table that pages: columns as fractions of the width; wrapped cells.
  const table = (title, head, rows, fractions, size = 10) => {
    const w = PAGE[0] - 2 * M;
    const cols = fractions.map((f) => f * w);
    const pad = 5;
    const lineH = size * 1.25;
    const top = PAGE[1] - M - 44;
    let page = newPage(title);
    let y = top;
    const continuePage = () => {
      page = newPage(`${title} (continued)`);
      y = top;
      drawRow(head, { header: true });
    };
    // A row taller than what is left goes to the next page; a row taller
    // than a whole page is split across pages, line by line.
    const drawRow = (cells, { header = false } = {}) => {
      const f = header ? bold : font;
      let wrapped = cells.map((c, i) => wrap(c, size, cols[i] - 2 * pad, f));
      let fresh = header;
      for (;;) {
        const tall = Math.max(...wrapped.map((l) => l.length));
        const room = Math.floor((y - M - 2 * pad) / lineH);
        if (!fresh && tall > room) { continuePage(); fresh = true; continue; }
        const n = Math.min(tall, Math.max(1, room));
        let x = M;
        wrapped.forEach((lines, i) => {
          lines.slice(0, n).forEach((l, j) => text(page, l, x + pad, y - pad - size - j * lineH + 2, { size, f, color: header ? MUTED : INK }));
          x += cols[i];
        });
        y -= n * lineH + 2 * pad;
        page.drawLine({ start: { x: M, y }, end: { x: M + w, y }, thickness: 0.5, color: RULE });
        if (n >= tall) return;
        wrapped = wrapped.map((lines) => lines.slice(n));
        continuePage();
        fresh = true;
      }
    };
    drawRow(head, { header: true });
    rows.forEach((r) => drawRow(r));
  };

  const BLOCKS = {
    cover() {
      const page = newPage();
      const lines = wrap(plan.title, 34, PAGE[0] - 2 * M - 20, bold);
      lines.forEach((l, i) => text(page, l, M + 10, 360 - i * 40, { size: 34, f: bold }));
      text(page, plan.subtitle, M + 10, 360 - lines.length * 40 - 6, { size: 15, color: MUTED });
    },
    totals() {
      const page = progressPage();
      const tileW = (PAGE[0] - 2 * M - 4 * 12) / 5;
      plan.tiles.forEach((tile, i) => {
        const x = M + i * (tileW + 12);
        const y = PAGE[1] - M - 130;
        page.drawRectangle({ x, y, width: tileW, height: 64, borderColor: RULE, borderWidth: 1, color: rgb(1, 1, 1) });
        text(page, tile.value, x + 12, y + 30, { size: 24, f: bold });
        text(page, tile.label, x + 12, y + 12, { size: 10, color: MUTED });
      });
      return page;
    },
    chart(block, shared) {
      const page = shared || progressPage();
      const top = shared ? PAGE[1] - M - 160 : PAGE[1] - M - 70;
      const bottom = M;
      if (!plan.chart.categories.length) {
        text(page, 'No survey items yet.', M, top - 20, { size: 13, color: MUTED });
        return;
      }
      const series = plan.chart.series;
      if (block.style === 'pie') {
        const t = plan.totals;
        const parts = [['Done', t.done], ['Partly done', t.partly], ['Not started', t.notStarted]].filter(([, v]) => v > 0);
        const total = parts.reduce((n, [, v]) => n + v, 0);
        const r = Math.min(150, (top - 30 - bottom) / 2);
        const cx = M + r + 20;
        const cy = bottom + (top - 30 - bottom) / 2;
        if (parts.length === 1) page.drawCircle({ x: cx, y: cy, size: r, color: hex(STATUS_HEX[parts[0][0]]) });
        else {
          let a0 = -Math.PI / 2;
          for (const [name, v] of parts) {
            const a1 = a0 + (v / total) * Math.PI * 2;
            // drawSvgPath measures y downwards from (x, y).
            const p = (a) => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
            page.drawSvgPath(`M 0 0 L ${p(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)} Z`, {
              x: cx, y: cy, color: hex(STATUS_HEX[name]), borderColor: rgb(1, 1, 1), borderWidth: 1.5,
            });
            a0 = a1;
          }
        }
        parts.forEach(([name, v], i) => {
          const y = cy + 30 - i * 26;
          text(page, `${name}: ${v} (${Math.round((v / total) * 100)}%)`, cx + r + 40, y, { size: 13 });
        });
        return;
      }
      // Stacked horizontal bars, one per category, top-down like the table,
      // under a legend.
      let lx = M;
      for (const s of series) {
        page.drawRectangle({ x: lx, y: top - 10, width: 10, height: 10, color: hex(s.color) });
        text(page, s.name, lx + 14, top - 9, { size: 10, color: MUTED });
        lx += 26 + width(s.name, 10);
      }
      const labelW = 170;
      const n = plan.chart.categories.length;
      const rowH = Math.min(30, (top - 24 - bottom) / n);
      const max = Math.max(1, ...plan.chart.categories.map((_, i) => series.reduce((sum, s) => sum + s.values[i], 0)));
      const barW = PAGE[0] - 2 * M - labelW - 40;
      plan.chart.categories.forEach((name, i) => {
        const y = top - 24 - (i + 1) * rowH;
        const label = wrap(name, 10, labelW - 8)[0] || '';
        text(page, label, M, y + rowH / 2 - 4, { size: 10 });
        let x = M + labelW;
        let sum = 0;
        for (const s of series) {
          const v = s.values[i];
          if (!v) continue;
          const w = (v / max) * barW;
          page.drawRectangle({ x, y: y + rowH * 0.2, width: w, height: rowH * 0.6, color: hex(s.color) });
          x += w;
          sum += v;
        }
        text(page, String(sum), x + 6, y + rowH / 2 - 4, { size: 10, color: MUTED });
      });
    },
    table() {
      if (!plan.categoryRows.length) return;
      table('By category', ['Category', 'Items', 'Done', 'Partly done', 'Not started', 'With issues'], plan.categoryRows, [0.38, 0.124, 0.124, 0.124, 0.124, 0.124], 11);
    },
    issues() {
      if (!plan.issueRows.length) {
        const page = newPage('Issues');
        text(page, 'No issues found.', M, PAGE[1] - M - 60, { size: 13, color: MUTED });
        return;
      }
      table('Issues', ['Category', 'Item', 'Lines with a problem answer'], plan.issueRows.map((r) => [r.category, r.item, r.lines]), [0.22, 0.2, 0.58], 10);
    },
  };

  let shared = null;
  for (const block of kit.blocks) {
    const draw = BLOCKS[block.type];
    const previous = shared;
    shared = null;
    if (!draw) continue;
    const page = draw(block, block.type === 'chart' ? previous : null);
    if (block.type === 'totals') shared = page;
  }
  if (!doc.getPageCount()) newPage(plan.title);
  return doc.save();
}

/** "<template> report.pdf" without unsafe characters. */
export function surveyReportPdfFileName(template) {
  const base = String(template?.name || 'Survey').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Survey';
  return `${base} report.pdf`;
}

export async function downloadSurveyReportPdf(input) {
  const PDFLib = await import('pdf-lib');
  const bytes = await buildSurveyReportPdf(PDFLib, input);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = surveyReportPdfFileName(input?.template);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
