import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import {
  escapeHtml, textSpans, pageSection, htmlHead, htmlFoot, textSection,
} from '../pdfHtml.js';
import { textLines, textParagraphs, markHeadings } from '../pdfText.js';
import { letterPdf, pagesOf } from './textPdfHelpers.mjs';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} is not near ${b}`);
const spansOf = (html) => [...html.matchAll(/<span style="([^"]*)"(?: data-w="([\d.]+)")?(?: data-r="([-\d.]+)")?>([^<]*)<\/span>/g)]
  .map(([, style, w, rot, text]) => ({
    text,
    w: Number(w),
    rot: rot ? Number(rot) : 0,
    left: Number(/left:([-\d.]+)%/.exec(style)[1]),
    top: Number(/top:([-\d.]+)%/.exec(style)[1]),
    size: Number(/font-size:([\d.]+)cqw/.exec(style)[1]),
  }));

test('HTML: words sit where the PDF put them, as shares of the page', async () => {
  const [p1] = await pagesOf(await letterPdf());
  const spans = spansOf(textSpans(p1.items, p1.styles, p1.viewport));
  const title = spans.find((s) => s.text === 'Site Safety Notice');
  near(title.left, 72 / 612 * 100, 0.01, 'left');
  // Baseline at y 700 from the bottom; the span's top is one ascent above it.
  const ascent = p1.styles[p1.items[0].fontName].ascent;
  near(title.top, (792 - 700 - 24 * ascent) / 792 * 100, 0.01, 'top');
  near(title.size, 24 / 612 * 100, 0.01, 'size');
  assert.ok(title.w > 20 && title.w < 50, `width ${title.w}`);
  assert.equal(title.rot, 0);
});

test('HTML: a turned page keeps its words on the turned picture', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 200]);
  page.drawText('Grid A', { x: 50, y: 100, size: 10, font });
  page.setRotation(degrees(90));
  const [p] = await pagesOf(await doc.save());
  assert.equal(p.viewport.width, 200);
  const [span] = spansOf(textSpans(p.items, p.styles, p.viewport));
  near(span.rot, Math.PI / 2, 0.001, 'angle');
  // Turned clockwise: PDF y 100 (of 200) lands half way across, x 50 near the top.
  near(span.left, (100 + 10 * p.styles[p.items[0].fontName].ascent) / 200 * 100, 0.01, 'left');
  near(span.top, 50 / 400 * 100, 0.01, 'top');
});

test('HTML: the page and its text are escaped and well formed', () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  const item = { str: '<b>&', transform: [12, 0, 0, 12, 10, 20], width: 20, height: 12, fontName: 'f' };
  const spans = textSpans([item, { str: ' ', transform: [12, 0, 0, 12, 0, 0], width: 3, fontName: 'f' }], { f: { fontFamily: 'serif', ascent: 0.75 } }, { width: 100, height: 100, scale: 1, transform: [1, 0, 0, -1, 0, 100] });
  assert.equal(spans, '<span style="left:10%;top:71%;font-size:12cqw;font-family:serif" data-w="20">&lt;b&gt;&amp;</span>');
  // A font name can't break out of the style.
  assert.match(textSpans([item], { f: { fontFamily: 'x;}</style>' } }, { width: 100, height: 100, scale: 1, transform: [1, 0, 0, -1, 0, 100] }), /font-family:sans-serif"/);
  const html = htmlHead('A & B', 'look') + pageSection({
    n: 3, width: 612, height: 792, image: 'data:image/jpeg;base64,AAAA', spans,
  }) + htmlFoot('look');
  assert.match(html, /<title>A &amp; B<\/title>/);
  assert.match(html, /<section class="pg" id="page-3" style="aspect-ratio:612\/792;width:min\(100%,816px\)"><img src="data:image\/jpeg;base64,AAAA" alt="Page 3">/);
  assert.match(html, /<script>[\s\S]*scaleX[\s\S]*<\/script>\n<\/body>\n<\/html>\n$/);
});

test('HTML text only: headings and paragraphs', async () => {
  const [p1] = await pagesOf(await letterPdf());
  const html = htmlHead('Notice', 'text') + textSection(1, markHeadings(textParagraphs(textLines(p1.items)))) + htmlFoot('text');
  assert.match(html, /<section id="page-1">\n<h1>Site Safety Notice<\/h1>\n<p>All visitors must sign in at the gate and wear a hard hat and a high-visibility vest at all times\.<\/p>\n<p>Deliveries arrive before 7 am\.<\/p>\n<\/section>/);
  assert.doesNotMatch(html, /<script>/);
});
