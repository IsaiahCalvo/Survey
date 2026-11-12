// A page pick (Export PDF → current / marked / custom pages) must not carry
// the cut pages along. pdf-lib's removePage only unhooks a page, so before
// this fix a 2-of-4 export still held both cut pages' drawing and text, and
// their bookmarks, links, named destinations and form fields still pointed
// at them (Linear KAL-537 study, "Survey page-subset bytes").
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFString, PDFNumber } from 'pdf-lib';
import { keepOnlyPages } from '../src/utils/exportPdfBytes.js';

const marker = (n) => `SECRET-PAGE-${n}`;

async function richPdf() {
  const doc = await PDFDocument.create();
  const { context } = doc;
  const pages = [1, 2, 3, 4].map((n) => {
    const page = doc.addPage([200, 200]);
    const content = context.register(context.stream(`BT /F1 12 Tf 20 100 Td (${marker(n)}) Tj ET`));
    page.node.set(PDFName.of('Contents'), content);
    page.node.set(PDFName.of('StructParents'), PDFNumber.of(n - 1));
    return page;
  });
  const xyz = (page) => context.obj([page.ref, PDFName.of('XYZ'), null, null, null]);
  const link = (from, to, viaAction = false) => {
    const dict = context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10] });
    if (viaAction) dict.set(PDFName.of('A'), context.obj({ S: 'GoTo', D: xyz(pages[to - 1]) }));
    else dict.set(PDFName.of('Dest'), xyz(pages[to - 1]));
    return context.register(dict);
  };
  const widget = (page, name) => {
    const ref = context.register(context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of(name), V: PDFString.of(`${name}-value`), Rect: [0, 0, 50, 20], P: page.ref }));
    return ref;
  };
  const w1 = widget(pages[0], 'kept-field');
  const w2 = widget(pages[1], 'cut-field');
  pages[0].node.set(PDFName.of('Annots'), context.obj([link(1, 4), link(1, 3, true), w1]));
  pages[1].node.set(PDFName.of('Annots'), context.obj([w2]));
  pages[2].node.set(PDFName.of('Annots'), context.obj([link(3, 2)]));
  doc.catalog.set(PDFName.of('AcroForm'), context.obj({ Fields: [w1, w2] }));

  // Bookmarks: one per page, plus "Section" (→ page 2) holding a child → page 3.
  const outlinesRef = context.nextRef();
  const items = [1, 2, 3, 4].map((n) => ({ n, ref: context.nextRef() }));
  const sectionRef = context.nextRef();
  const childRef = context.nextRef();
  const all = [...items.map((i) => i.ref), sectionRef];
  items.forEach(({ n, ref }, i) => {
    context.assign(ref, context.obj({
      Title: PDFHexString.fromText(`Bookmark ${marker(n)}`), Parent: outlinesRef, Dest: xyz(pages[n - 1]),
      ...(i > 0 ? { Prev: all[i - 1] } : {}), Next: all[i + 1],
    }));
  });
  context.assign(sectionRef, context.obj({ Title: PDFHexString.fromText('Section'), Parent: outlinesRef, Prev: items[3].ref, Dest: xyz(pages[1]), First: childRef, Last: childRef, Count: 1 }));
  context.assign(childRef, context.obj({ Title: PDFHexString.fromText('Child on page 3'), Parent: sectionRef, Dest: xyz(pages[2]) }));
  context.assign(outlinesRef, context.obj({ Type: 'Outlines', First: items[0].ref, Last: sectionRef, Count: 6 }));
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);

  // Named destinations, an open action to a cut page and a tag tree.
  doc.catalog.set(PDFName.of('Names'), context.obj({ Dests: context.obj({ Names: [PDFHexString.fromText('p1'), xyz(pages[0]), PDFHexString.fromText('p2'), xyz(pages[1])] }) }));
  doc.catalog.set(PDFName.of('OpenAction'), xyz(pages[3]));
  doc.catalog.set(PDFName.of('StructTreeRoot'), context.obj({ Type: 'StructTreeRoot', K: [context.obj({ S: 'P', Pg: pages[1].ref, ActualText: PDFString.of(`tag ${marker(2)}`) })] }));
  return doc.save({ useObjectStreams: false });
}

// Every string or stream in the saved file, as text.
function allText(doc) {
  const out = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) out.push(Buffer.from(obj.contents).toString('latin1'));
    const walk = (v, depth = 0) => {
      if (depth > 20 || v == null) return;
      if (v instanceof PDFString || v instanceof PDFHexString) out.push(v.decodeText());
      else if (v instanceof PDFDict) for (const [, x] of v.entries()) walk(x, depth + 1);
      else if (v instanceof PDFArray) for (const x of v.asArray()) walk(x, depth + 1);
    };
    walk(obj instanceof PDFRawStream ? obj.dict : obj);
  }
  return out.join('\n');
}

const outlineTitles = (doc) => {
  const titles = [];
  const walk = (dict, depth = 0) => {
    let ref = dict.get(PDFName.of('First'));
    while (ref instanceof PDFRef && depth < 10) {
      const item = doc.context.lookup(ref);
      titles.push('  '.repeat(depth) + item.lookup(PDFName.of('Title')).decodeText());
      walk(item, depth + 1);
      ref = item.get(PDFName.of('Next'));
    }
  };
  const outlines = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  if (outlines) walk(outlines);
  return titles;
};

test('the source fixture really carries every page marker', async () => {
  const src = await PDFDocument.load(await richPdf());
  const text = allText(src);
  for (const n of [1, 2, 3, 4]) assert.match(text, new RegExp(marker(n)));
});

test('a page pick leaves no drawing, text or bookmark of a cut page in the file', async () => {
  const out = await PDFDocument.load(await keepOnlyPages(await richPdf(), [1, 3]));
  assert.equal(out.getPageCount(), 2);
  const text = allText(out);
  assert.match(text, new RegExp(marker(1)));
  assert.match(text, new RegExp(marker(3)));
  assert.doesNotMatch(text, new RegExp(marker(2)));
  assert.doesNotMatch(text, new RegExp(marker(4)));
  assert.doesNotMatch(text, /cut-field/);
});

test('bookmarks to kept pages stay; a cut heading with a kept child stays as a plain heading', async () => {
  const out = await PDFDocument.load(await keepOnlyPages(await richPdf(), [1, 3]));
  assert.deepEqual(outlineTitles(out), [`Bookmark ${marker(1)}`, `Bookmark ${marker(3)}`, 'Section', '  Child on page 3']);
  const outlines = out.catalog.lookup(PDFName.of('Outlines'));
  assert.equal(outlines.lookup(PDFName.of('Count')).asNumber(), 4);
  // The heading no longer jumps anywhere.
  const section = out.context.lookup(outlines.get(PDFName.of('Last')));
  assert.equal(section.lookup(PDFName.of('Title')).decodeText(), 'Section');
  assert.equal(section.has(PDFName.of('Dest')), false);
  // Kept bookmarks still land on the right new page.
  const first = out.context.lookup(outlines.get(PDFName.of('First')));
  assert.equal(first.lookup(PDFName.of('Dest')).get(0).toString(), out.getPage(0).ref.toString());
});

test('links into cut pages go, links between kept pages stay and still work', async () => {
  const out = await PDFDocument.load(await keepOnlyPages(await richPdf(), [1, 3]));
  const subtypes = (page) => (page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.asArray() || [])
    .map((ref) => out.context.lookup(ref).get(PDFName.of('Subtype')).toString());
  assert.deepEqual(subtypes(out.getPage(0)), ['/Link', '/Widget']); // 1→4 gone, 1→3 kept
  assert.deepEqual(subtypes(out.getPage(1)), []); // 3→2 gone
  const kept = out.context.lookup(out.getPage(0).node.lookup(PDFName.of('Annots')).get(0));
  const target = kept.lookup(PDFName.of('A')).lookup(PDFName.of('D')).get(0);
  assert.equal(target.toString(), out.getPage(1).ref.toString());
});

test('named destinations, form fields, the open action and tags follow the cut', async () => {
  const out = await PDFDocument.load(await keepOnlyPages(await richPdf(), [1, 3]));
  const names = out.catalog.lookup(PDFName.of('Names')).lookup(PDFName.of('Dests')).lookup(PDFName.of('Names'));
  assert.deepEqual(names.asArray().filter((_, i) => i % 2 === 0).map((n) => out.context.lookup(n).decodeText()), ['p1']);
  const fields = out.catalog.lookup(PDFName.of('AcroForm')).lookup(PDFName.of('Fields'));
  assert.deepEqual(fields.asArray().map((ref) => out.context.lookup(ref).lookup(PDFName.of('T')).decodeText()), ['kept-field']);
  assert.equal(out.catalog.has(PDFName.of('OpenAction')), false);
  assert.equal(out.catalog.has(PDFName.of('StructTreeRoot')), false);
  assert.equal(out.getForm().getFields().length, 1);
});

test('keeping every page changes nothing structural', async () => {
  const out = await PDFDocument.load(await keepOnlyPages(await richPdf(), [1, 2, 3, 4]));
  assert.equal(out.getPageCount(), 4);
  assert.equal(outlineTitles(out).length, 6);
  assert.equal(out.catalog.has(PDFName.of('StructTreeRoot')), true);
  assert.equal(out.catalog.has(PDFName.of('OpenAction')), true);
});
