// Plan crops beside each issue in the PDF survey report (Nightly). The
// viewport-to-PDF maths must match pdf.js, which is where marker bounds come
// from, on pages turned by /Rotate and with a moved crop box.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import * as PDFLib from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cropAround, drawMiniMap, viewportRectToPdfBox, viewportToPdfPoint, viewportTransform } from '../src/services/surveyReportMiniMaps.js';
import { buildSurveyReportPdf } from '../src/services/surveyReportPdf.js';
import { getReportKit } from '../src/services/reportKits/index.js';

async function planPdf() {
  const doc = await PDFLib.PDFDocument.create();
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  for (const angle of [0, 90, 180, 270]) {
    const page = doc.addPage([800, 500]);
    page.drawText(`Sheet turned ${angle}`, { x: 40, y: 440, size: 24, font });
    page.drawRectangle({ x: 300, y: 200, width: 60, height: 40, color: PDFLib.rgb(0, 0, 1) });
    page.setRotation(PDFLib.degrees(angle));
  }
  // A crop box that does not start at 0, 0.
  const moved = doc.addPage([800, 500]);
  moved.setCropBox(50, 30, 600, 400);
  return doc.save();
}

test('the viewport transform matches pdf.js for every turn and a moved crop box', async () => {
  const bytes = await planPdf();
  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const t = viewportTransform(page.view, page.rotate);
    assert.equal(t.width, vp.width, `page ${n} width`);
    assert.equal(t.height, vp.height, `page ${n} height`);
    t.m.forEach((v, i) => assert.ok(Math.abs(v - vp.transform[i]) < 1e-9, `page ${n} transform[${i}] ${v} vs ${vp.transform[i]}`));
    for (const [vx, vy] of [[0, 0], [123, 45], [vp.width, vp.height]]) {
      const [px, py] = viewportToPdfPoint(t, vx, vy);
      const [ex, ey] = vp.convertToPdfPoint(vx, vy);
      assert.ok(Math.abs(px - ex) < 1e-9 && Math.abs(py - ey) < 1e-9, `page ${n} point ${vx},${vy}`);
    }
  }
  // The blue box (PDF 300..360 x 200..240) on the page turned 90.
  const t90 = viewportTransform([0, 0, 800, 500], 90);
  // Turned 90 clockwise: viewport x = PDF y, viewport y = PDF x.
  assert.deepEqual(viewportRectToPdfBox(t90, { x: 200, y: 300, width: 40, height: 60 }), { left: 300, bottom: 200, right: 360, top: 240 });
});

test('a crop keeps the card shape, stays on the page and gives a small item room', () => {
  const crop = cropAround({ x: 10, y: 10, width: 4, height: 4 }, 800, 500, 1.5);
  assert.equal(crop.x, 0);
  assert.equal(crop.y, 0);
  assert.ok(Math.abs(crop.width / crop.height - 1.5) < 1e-9);
  assert.ok(crop.width >= 220);
  const big = cropAround({ x: 0, y: 0, width: 800, height: 500 }, 800, 500, 1.5);
  assert.ok(big.width <= 800 && big.height <= 500);
});

test('the report adds a "Where the issues are" page with a crop per placed issue', async () => {
  const bytes = await planPdf();
  const template = { name: 'Doors', modules: [{ id: 'm', name: 'M', categories: [{ id: 'c', name: 'Door', checklist: [{ id: 'a', text: 'Lock works' }] }] }] };
  const markers = {};
  for (let i = 0; i < 7; i += 1) {
    markers[`d${i}`] = {
      name: `D-${i + 1}`,
      categoryId: 'c',
      pageNumber: (i % 4) + 1,
      // Over the blue box in viewport space (page 1 unturned: y = 500 - 240).
      bounds: { x: 300, y: 260, width: 60, height: 40 },
      checklistResponses: { a: { selection: 'N' } },
    };
  }
  markers.unplaced = { name: 'D-99', categoryId: 'c', checklistResponses: { a: { selection: 'N' } } };
  const kit = getReportKit('issues-report');
  const without = await PDFLib.PDFDocument.load(await buildSurveyReportPdf(PDFLib, { template, markers, kit }));
  const out = await buildSurveyReportPdf(PDFLib, { template, markers, kit, sourcePdfBytes: bytes });
  if (process.env.SURVEY_REPORT_PDF_OUT) writeFileSync(`${process.env.SURVEY_REPORT_PDF_OUT}/plan-crops.pdf`, out);
  const withMaps = await PDFLib.PDFDocument.load(out);
  // Seven placed issues: six cards on one page, one on the next.
  assert.equal(withMaps.getPageCount(), without.getPageCount() + 2);
  const pdf = await pdfjs.getDocument({ data: out.slice() }).promise;
  const words = async (n) => (await (await pdf.getPage(n)).getTextContent()).items.map((it) => it.str).join(' ');
  const first = await words(without.getPageCount() + 1);
  assert.match(first, /Where the issues are/);
  assert.match(first, /D-1/);
  assert.match(first, /Sheet turned/);
  assert.doesNotMatch(first + await words(without.getPageCount() + 2), /D-99/);
  // An unreadable plan leaves the crops out but still makes the report.
  const broken = await buildSurveyReportPdf(PDFLib, { template, markers, kit, sourcePdfBytes: new Uint8Array([1, 2, 3]) });
  assert.equal((await PDFLib.PDFDocument.load(broken)).getPageCount(), without.getPageCount());
});

test('a blank plan page with no content stream gives "No plan view" and the report still saves', async () => {
  const { PDFDocument, rgb, degrees } = PDFLib;
  const plan = await PDFDocument.create();
  plan.addPage([600, 400]); // pdf-lib leaves a new page with no /Contents
  const drawn = await plan.addPage([600, 400]);
  drawn.drawRectangle({ x: 50, y: 50, width: 100, height: 60, color: rgb(0, 0, 1) });
  const source = await PDFDocument.load(await plan.save());
  const out = await PDFDocument.create();
  const page = out.addPage([600, 800]);
  const card = { page, bounds: { x: 100, y: 100, width: 20, height: 20 }, box: { x: 20, y: 20, width: 180, height: 120 }, rgb, degrees, ink: rgb(0, 0, 0), pin: rgb(1, 0, 0) };
  assert.equal(await drawMiniMap({ doc: out, sourcePage: source.getPage(0), ...card }), false);
  assert.equal(await drawMiniMap({ doc: out, sourcePage: source.getPage(1), ...card }), true);
  const bytes = await out.save();
  assert.ok(bytes.length > 0);
});
