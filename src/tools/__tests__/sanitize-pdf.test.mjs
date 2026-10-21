import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, StandardFonts,
} from 'pdf-lib';
import { sanitizePdf, describeRemoved } from '../sanitize.js';
import { ToolError } from '../errors.js';

const N = PDFName.of;
const SECRET_JS = 'app.alert("secret script")';
const SECRET_FILE = 'secret attachment body';
const SECRET_XMP = '<x:xmpmeta>secret author xmp</x:xmpmeta>';

// A PDF carrying every kind of hidden data the tool removes.
async function loaded() {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 300]);
  page.drawText('Visible text', { x: 20, y: 20, font, size: 12 });
  doc.addPage([300, 300]);
  doc.setTitle('Secret title');
  doc.setAuthor('Secret author');
  doc.setKeywords(['secret']);
  // XMP on the catalog and on the page.
  const xmp = ctx.register(ctx.stream(SECRET_XMP, { Type: 'Metadata', Subtype: 'XML' }));
  doc.catalog.set(N('Metadata'), xmp);
  page.node.set(N('Metadata'), xmp);
  page.node.set(N('PieceInfo'), ctx.obj({ Illustrator: { Private: 'x' } }));
  // Document-level script, open action script, page and catalog AA.
  const js = (code) => ctx.obj({ S: 'JavaScript', JS: PDFString.of(code) });
  doc.catalog.set(N('Names'), ctx.obj({ JavaScript: ctx.register(ctx.obj({ Names: [PDFString.of('init'), ctx.register(js(SECRET_JS))] })) }));
  doc.catalog.set(N('OpenAction'), ctx.register(js(SECRET_JS)));
  doc.catalog.set(N('AA'), ctx.obj({ WC: js(SECRET_JS) }));
  page.node.set(N('AA'), ctx.obj({ O: js(SECRET_JS) }));
  // Annotations: a link running a script, a link that just goes somewhere,
  // a sticky note with its popup, a form field, a file pin.
  const annots = [
    ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: { S: 'JavaScript', JS: PDFString.of(SECRET_JS), Next: [js(SECRET_JS)] } }),
    ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 20, 10, 30], A: { S: 'URI', URI: PDFString.of('https://example.com') } }),
    ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [20, 20, 40, 40], Contents: PDFHexString.fromText('A sticky note') }),
    ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [40, 40, 90, 90] }),
    ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('name'), Rect: [100, 100, 200, 120] }),
    ctx.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: [50, 50, 60, 60], FS: { Type: 'Filespec', F: PDFString.of('pin.txt'), EF: { F: ctx.register(ctx.stream('pinned file body', { Type: 'EmbeddedFile' })) } } }),
  ].map((a) => ctx.register(a));
  page.node.set(N('Annots'), ctx.obj(annots));
  await doc.attach(new TextEncoder().encode(SECRET_FILE), 'notes.txt', { mimeType: 'text/plain' });
  // A launch action on page 2.
  doc.getPages()[1].node.set(N('AA'), ctx.obj({ C: { S: 'Launch', F: PDFString.of('calc.exe') } }));
  return doc.save({ useObjectStreams: false });
}

// Every bit of text in the file, streams inflated, to check nothing secret is left.
async function allText(bytes) {
  const doc = await PDFDocument.load(bytes);
  let s = '';
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    s += obj.toString();
    if (obj instanceof PDFRawStream) {
      const raw = Buffer.from(obj.getContents());
      try { s += inflateSync(raw).toString('latin1'); } catch { s += raw.toString('latin1'); }
    }
  }
  return s;
}

const subtypes = async (bytes, i = 0) => {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.context.lookup(doc.getPages()[i].node.get(N('Annots')));
  return annots instanceof PDFArray ? annots.asArray().map((r) => doc.context.lookup(r).get(N('Subtype')).decodeText()) : [];
};

test('sanitize: the fixture really holds the secrets', async () => {
  const s = await allText(await loaded());
  for (const secret of ['secret script', 'secret author xmp', 'pinned file body', 'calc.exe']) assert.ok(s.includes(secret), secret);
});

test('sanitize: removes details, XMP, scripts and attachments; keeps pages, links and fields', async () => {
  const { bytes, found, note } = await sanitizePdf(await loaded());
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(doc.getPageCount(), 2);
  // Checked first: getTitle() makes an empty Info dict when there is none.
  assert.equal(doc.context.trailerInfo.Info, undefined);
  assert.equal(doc.getTitle(), undefined);
  assert.equal(doc.getAuthor(), undefined);
  assert.equal(doc.catalog.get(N('Metadata')), undefined);
  assert.equal(doc.catalog.get(N('OpenAction')), undefined);
  assert.equal(doc.catalog.get(N('AA')), undefined);
  assert.equal(doc.catalog.get(N('Names')), undefined);
  assert.equal(doc.getPages()[0].node.get(N('AA')), undefined);
  assert.equal(doc.getPages()[1].node.get(N('AA')), undefined);
  // The sticky note stays (comments are off by default); the file pin goes.
  assert.deepEqual(await subtypes(bytes), ['Link', 'Link', 'Text', 'Popup', 'Widget']);
  const s = await allText(bytes);
  for (const secret of ['secret script', 'secret author xmp', SECRET_FILE, 'pinned file body', 'calc.exe', 'Illustrator', '/JavaScript', '/EmbeddedFile']) {
    assert.ok(!s.includes(secret), `still has ${secret}`);
  }
  assert.ok(s.includes('https://example.com'));
  assert.deepEqual(found, { info: 1, metadata: 3, scripts: 6, files: 2, comments: 0 });
  assert.equal(note, 'Removed document details (title, author, dates), hidden XMP metadata, 6 scripts or auto actions and 2 attached files.');
});

test('sanitize: comments come off only when asked, links and fields stay', async () => {
  const { bytes, found } = await sanitizePdf(await loaded(), { comments: true });
  assert.deepEqual(await subtypes(bytes), ['Link', 'Link', 'Widget']);
  assert.equal(found.comments, 1);
  assert.ok(!(await allText(bytes)).includes('A sticky note'));
});

test('sanitize: each part can be kept', async () => {
  const src = await loaded();
  const onlyInfo = await sanitizePdf(src, { info: true, metadata: false, scripts: false, files: false });
  const doc = await PDFDocument.load(onlyInfo.bytes);
  assert.equal(doc.getTitle(), undefined);
  assert.ok(doc.catalog.get(N('Metadata')));
  assert.ok(doc.catalog.get(N('OpenAction')));
  const names = doc.context.lookup(doc.catalog.get(N('Names')));
  assert.ok(names instanceof PDFDict && names.has(N('JavaScript')) && names.has(N('EmbeddedFiles')));
  assert.equal(onlyInfo.note, 'Removed document details (title, author, dates).');

  const onlyScripts = await sanitizePdf(src, { info: false, metadata: false, scripts: true, files: false });
  const d2 = await PDFDocument.load(onlyScripts.bytes);
  assert.equal(d2.getTitle(), 'Secret title');
  assert.ok((await allText(onlyScripts.bytes)).includes(SECRET_XMP));
  assert.ok(!(await allText(onlyScripts.bytes)).includes('secret script'));
  const n2 = d2.context.lookup(d2.catalog.get(N('Names')));
  assert.ok(!n2.has(N('JavaScript')) && n2.has(N('EmbeddedFiles')));

  const onlyFiles = await sanitizePdf(src, { info: false, metadata: false, scripts: false, files: true });
  const s3 = await allText(onlyFiles.bytes);
  assert.ok(!s3.includes(SECRET_FILE) && !s3.includes('pinned file body'));
  assert.ok(s3.includes('secret script'));
});

test('sanitize: a clean file says so in plain words', async () => {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage();
  const bytes = await doc.save();
  await assert.rejects(sanitizePdf(bytes), (e) => e instanceof ToolError && /already clean/.test(e.message));
  assert.equal(describeRemoved({ info: 0, metadata: 0, scripts: 1, files: 0, comments: 3 }), 'Removed 1 script or auto action and 3 comments.');
});
