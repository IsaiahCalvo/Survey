// Nightly 'link-tool': Drawboard Projects' Hyperlink tool
// (/mnt/project-files/drawboard-trial/deep/link-tool.md). The mark, its look,
// the dialog's checks, the picked bar, the PDF /Link export and the wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';

import {
  LINK_COLORS,
  LINK_DEFAULT_COLOR,
  LINK_FILL,
  applyLinkEdit,
  buildLinkMark,
  isLinkMark,
  isLinkToolKey,
  linkExportSpec,
  linkGoToLabel,
  linkMarkForPrint,
  linkMarkPaint,
  normalizeLink,
  resolveLinkInput,
  selectedLinkOf,
} from '../src/utils/linkTool.js';
import { planSelectionQuickBar } from '../src/utils/selectionQuickBar.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const box = { x: 100, y: 120, width: 80, height: 40 };
const urlMark = (extra = {}) => buildLinkMark({ id: 'l1', box, link: { kind: 'url', href: 'example.com' }, ...extra });

test("Drawboard's look: blue #0066D4, 3 pt, box, see-through fill; seven swatches", () => {
  const mark = urlMark();
  assert.equal(mark.type.toLowerCase(), 'rect');
  assert.equal(mark.stroke.toLowerCase(), '#0066d4');
  assert.equal(mark.strokeWidth, 3);
  assert.equal(mark.fill, LINK_FILL);
  assert.equal(mark.data.linkStyle, 'box');
  assert.equal(mark.data.subject, 'Hyperlink');
  assert.ok(isLinkMark(mark));
  assert.equal(LINK_DEFAULT_COLOR, '#0066D4');
  assert.deepEqual(LINK_COLORS.slice(0, 3).map((c) => c.color), ['#0066D4', '#118A4E', '#1A1A1A']);
  assert.equal(LINK_COLORS.length, 7);
});

test('a web address is checked and gets https:// (Drawboard takes any text)', () => {
  assert.deepEqual(urlMark().data.link, { kind: 'url', href: 'https://example.com/' });
  assert.deepEqual(resolveLinkInput('url', 'example.com/a b', 3).link?.kind, 'url');
  assert.ok(resolveLinkInput('url', 'not a site', 3).error);
  assert.ok(resolveLinkInput('url', 'javascript:alert(1)', 3).error);
  assert.deepEqual(resolveLinkInput('page', '2', 3), { link: { kind: 'page', page: 2 } });
  assert.ok(resolveLinkInput('page', '9', 3).error, 'page 9 of 3 is refused (Drawboard allowed it)');
  assert.ok(resolveLinkInput('page', '1.5', 3).error);
  assert.deepEqual(resolveLinkInput('area', '', 3), { pendingArea: true });
});

test('a box too small, or a link to nowhere, makes no mark', () => {
  assert.equal(buildLinkMark({ id: 'x', box: { ...box, width: 2 }, link: { kind: 'page', page: 1 } }), null);
  assert.equal(buildLinkMark({ id: 'x', box, link: { kind: 'url', href: '' } }), null);
  assert.equal(normalizeLink({ kind: 'area', page: 1, rect: { x: 0, y: 0, width: 1, height: 1 } }), null);
  assert.deepEqual(
    normalizeLink({ kind: 'area', page: 2, rect: { x: 1, y: 2, width: 30, height: 40 } }),
    { kind: 'area', page: 2, rect: { x: 1, y: 2, width: 30, height: 40 } },
  );
});

test('styles: dashed is 4w, 2w; underline is the bottom edge; none draws only the fill', () => {
  const dashed = linkMarkPaint(urlMark({ style: 'dashed' }), 80, 40);
  assert.deepEqual(dashed.dash, [12, 6]);
  assert.equal(dashed.box, true);
  const under = linkMarkPaint(urlMark({ style: 'underline' }), 80, 40);
  assert.deepEqual(under.underline, { x1: 0, y1: 40, x2: 80, y2: 40 });
  assert.equal(under.box, false);
  const none = linkMarkPaint(urlMark({ style: 'none' }), 80, 40);
  assert.equal(none.strokeWidth, 0);
  assert.equal(none.fill, LINK_FILL);
  // The dash follows a new width; no stale dash is kept.
  assert.deepEqual(linkMarkPaint({ ...urlMark({ style: 'dashed' }), strokeWidth: 5 }, 80, 40).dash, [20, 10]);
});

test('switching style keeps the width the user set (Drawboard reset it to 1 pt)', () => {
  const wide = { ...urlMark({ style: 'none' }), strokeWidth: 5 };
  const back = applyLinkEdit(wide, { style: 'box' });
  assert.equal(back.strokeWidth, 5);
  assert.equal(back.data.linkStyle, 'box');
  const moved = applyLinkEdit(back, { link: { kind: 'page', page: 3 }, color: '#118A4E' });
  assert.deepEqual(moved.data.link, { kind: 'page', page: 3 });
  assert.equal(moved.stroke, '#118A4E');
  assert.equal(applyLinkEdit(back, { link: { kind: 'url', href: '' } }), back, 'a bad target changes nothing');
});

test('the print draws the border only; underline prints a strip on the bottom edge, turned with the mark', () => {
  const printed = linkMarkForPrint(urlMark());
  assert.equal(printed.fill, 'transparent');
  assert.equal(isLinkMark(printed), false);
  assert.equal(linkMarkForPrint(urlMark({ style: 'none' })), null);
  const strip = linkMarkForPrint(urlMark({ style: 'underline' }));
  assert.equal(strip.height, 3);
  assert.equal(strip.top, 120 + 40 - 1.5);
  assert.equal(strip.left, 100);
  const turned = linkMarkForPrint({ ...urlMark({ style: 'underline' }), angle: 90 });
  // Centre (140, 140); a quarter turn puts the bottom edge on the left.
  assert.ok(Math.abs(turned.left + 40 - (140 - 20)) < 1e-9);
  assert.ok(Math.abs(turned.top + 1.5 - 140) < 1e-9);
});

test('"Go to ..." words and Shift+H', () => {
  assert.equal(linkGoToLabel({ kind: 'page', page: 4 }), 'Go to page 4');
  assert.equal(linkGoToLabel({ kind: 'area', page: 1, rect: {} }), 'Go to area');
  assert.equal(linkGoToLabel({ kind: 'url', href: 'https://example.com/' }), 'Go to example.com');
  assert.ok(isLinkToolKey({ key: 'H', code: 'KeyH', shiftKey: true }));
  assert.ok(!isLinkToolKey({ key: 'h', code: 'KeyH' }), 'plain H stays the Highlighter');
  assert.ok(!isLinkToolKey({ key: 'H', code: 'KeyH', shiftKey: true, metaKey: true }));
});

test('picked bar: one link shows Go to and Link, and drops Line style; locked keeps Go to only', () => {
  const mark = urlMark();
  const selectedLink = selectedLinkOf(mark, 'l1');
  const api = { selectedLink, followLink() {}, editSelectedLink() {}, setLineBorderStyle() {}, handleStrokeWidthInputChange() {} };
  const plan = planSelectionQuickBar({ items: [{ id: 'l1', typeKey: 'rect' }], api });
  assert.equal(plan.link, true);
  assert.equal(plan.linkEdit, true);
  assert.equal(plan.style, false);
  assert.equal(plan.width, true);
  const locked = planSelectionQuickBar({ items: [{ id: 'l1', typeKey: 'rect' }], api, locked: true });
  assert.equal(locked.link, true);
  assert.equal(locked.linkEdit, false);
  const plain = planSelectionQuickBar({ items: [{ id: 'r9', typeKey: 'rect' }], api: { ...api, selectedLink: null } });
  assert.equal(plain.link, undefined, 'a plain box plans exactly as before');
  assert.equal(plain.style, true);
  const two = planSelectionQuickBar({ items: [{ id: 'l1', typeKey: 'rect' }, { id: 'r9', typeKey: 'rect' }], api });
  assert.equal(two.link, undefined);
});

test('export spec: /Rect, /QuadPoints, border style and the action', () => {
  const spec = linkExportSpec(urlMark({ style: 'dashed' }), 320);
  assert.deepEqual(spec.rect, [100, 160, 180, 200]);
  assert.deepEqual(spec.quadPoints, [100, 200, 180, 200, 100, 160, 180, 160]);
  assert.equal(spec.borderStyle, 'D');
  assert.deepEqual(spec.dash, [12, 6]);
  assert.deepEqual(spec.action, { uri: 'https://example.com/' });
  const area = buildLinkMark({ id: 'a', box, link: { kind: 'area', page: 1, rect: { x: 10, y: 20, width: 50, height: 60 } } });
  assert.deepEqual(linkExportSpec(area, 320).action, { page: 1, fitR: { x: 10, y: 20, width: 50, height: 60 } });
  assert.equal(linkExportSpec(urlMark({ style: 'underline' }), 320).borderStyle, 'U');
});

const quiet = async (fn) => {
  const { log, warn, error } = console;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; console.error = error; }
};

const exportMarks = async (objects) => {
  const source = await PDFDocument.create();
  source.addPage([420, 320]);
  source.addPage([420, 320]);
  const bytes = await source.save();
  const file = {
    name: 'links.pdf',
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
  const original = globalThis.window;
  globalThis.window = {};
  try {
    const out = await quiet(() => savePDFWithAnnotationsPdfLib(
      file,
      { 1: { objects } },
      { 1: { width: 420, height: 320 }, 2: { width: 420, height: 320 } },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'link-tool' },
    ));
    return PDFDocument.load(out);
  } finally {
    globalThis.window = original;
  }
};

test('the PDF export writes real /Link annotations: URI, GoTo a page, GoTo /FitR an area; no fill', async () => {
  const doc = await exportMarks([
    urlMark(),
    buildLinkMark({ id: 'p', box: { x: 10, y: 10, width: 50, height: 20 }, link: { kind: 'page', page: 2 } }),
    buildLinkMark({ id: 'a', box: { x: 10, y: 200, width: 50, height: 20 }, link: { kind: 'area', page: 2, rect: { x: 40, y: 60, width: 100, height: 80 } }, style: 'dashed' }),
  ]);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.ok(annots instanceof PDFArray);
  const links = annots.asArray().map((ref) => doc.context.lookup(ref)).filter((d) => d instanceof PDFDict && d.get(PDFName.of('Subtype'))?.toString() === '/Link');
  assert.equal(links.length, 3, 'three /Link annotations');
  for (const link of links) {
    assert.equal(link.get(PDFName.of('IC')), undefined, 'no interior fill');
    assert.equal(link.lookup(PDFName.of('BS'), PDFDict).get(PDFName.of('W')).asNumber(), 3);
    assert.ok(link.get(PDFName.of('QuadPoints')));
  }
  const actions = links.map((d) => d.lookup(PDFName.of('A'), PDFDict));
  const uri = actions.find((a) => a.get(PDFName.of('S')).toString() === '/URI');
  assert.match(uri.get(PDFName.of('URI')).decodeText?.() ?? uri.get(PDFName.of('URI')).toString(), /https:\/\/example\.com/);
  const gotos = actions.filter((a) => a.get(PDFName.of('S')).toString() === '/GoTo').map((a) => a.lookup(PDFName.of('D'), PDFArray).asArray());
  const page2 = doc.getPage(1).ref;
  assert.ok(gotos.every((d) => d[0] === page2), 'both go to page 2');
  const fitR = gotos.find((d) => d[1].toString() === '/FitR');
  assert.deepEqual(fitR.slice(2).map((n) => n.asNumber()), [40, 180, 140, 260]);
  assert.ok(gotos.some((d) => d[1].toString() === '/Fit'));
  const dashed = links.find((d) => d.lookup(PDFName.of('BS'), PDFDict).get(PDFName.of('S')).toString() === '/D');
  assert.ok(dashed, 'the dashed one says so in /BS');
});

test('wiring: tool, layer event, host, renderers, bar, phone strip, flag and migration', () => {
  const svg = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(svg, /const SHAPE_CREATION_TOOLS = \[[^\]]*'hyperlink'\]/);
  assert.match(svg, /new CustomEvent\(LINK_BOX_DRAWN_EVENT, \{ detail: \{ pageNumber, box, id, commit \} \}\)/);
  assert.match(svg, /data-link-preview="true"/, 'the drag shows the link as it will land');
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /linkToolOn \? \[\{ id: 'hyperlink', label: 'Hyperlink', iconName: 'hyperlink' \}\]/);
  assert.match(viewer, /<LinkToolHost/);
  assert.match(viewer, /selectedLink: linkToolOn && !groupSummary \? selectedLinkForHost : null/);
  assert.match(read('src/utils/svgAnnotationRenderers.jsx'), /if \(isLinkMark\(obj\)\) \{/);
  assert.match(read('src/utils/annotationCanvasPainter.js'), /if \(type === 'rect' && isLinkMark\(object\)\) \{/);
  assert.match(read('src/components/SelectionQuickBar.jsx'), /api\.followLink\(api\.selectedLink\.link\)/);
  assert.match(read('src/mobile/MobilePdfViewerChrome.jsx'), /\{ id: 'hyperlink', label: 'Hyperlink', icon: 'hyperlink', flag: 'link-tool' \}/);
  assert.match(read('src/featureFlags.js'), /'link-tool': Object\.freeze\(\{[\s\S]{0,200}stage: 'beta'/);
  assert.match(read('supabase/migrations/20261110155000_link_tool_flag.sql'), /'link-tool', 'off'/);
  // The painter runs in a worker: its link helper module imports nothing.
  assert.doesNotMatch(read('src/utils/linkMarkPaint.js'), /^import /m);
});
