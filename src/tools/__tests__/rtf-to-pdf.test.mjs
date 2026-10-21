import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readRtf, inspectRtf, isRtf } from '../rtf.js';
import { docxBlocksToPdf } from '../docLayout.js';
import { ToolError } from '../errors.js';

// @u stands for \u, so no editor or tool reads it as a JS escape.
const rtf = (s) => new TextEncoder().encode(s.replaceAll('@u', '\\u'));
const text = (b) => b.runs.map((r) => (r.br ? '\n' : r.text)).join('');
// 1x1 red PNG, as RTF writes it: hex.
const PNG_HEX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64').toString('hex');

// Close to what Word and WordPad write: a font table, a style sheet with a
// heading, list numbers in \listtext, a table, a link field and pictures.
const WORDISH = String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fswiss\fcharset0 Calibri;}{\f1\froman\fcharset204 Times New Roman Cyr;}{\f2\fnil\fcharset2 Symbol;}}
{\colortbl;\red0\green0\blue0;}{\stylesheet{\s0 Normal;}{\s1\b\fs32 heading 1;}}
{\*\generator Riched20 10.0.19041}{\info{\title Not body text}}
{\header \pard Header text\par}
\pard\s1\b\fs32 Site report\b0\par
\pard\s0\fs22 Plain with \b bold\b0 , \i italic\i0 , \ul under\ulnone  and \strike gone\strike0 .\par
Caf\'e9 @u8212? dash and {\f1 \'cf\'f0\'e8\'e2\'e5\'f2}\par
{\v hidden words}Seen\line next line\par
{\listtext\pard\plain\f2 \'b7\tab}\pard\ls1\ilvl0 Bullet one\par
{\listtext\pard\plain\f2 \'b7\tab}\pard\ls1\ilvl1 Bullet inner\par
{\listtext\pard\plain 3.\tab}\pard\ls2\ilvl0 Third step\par
\pard\par
\trowd\cellx3000\cellx6000\pard\intbl\b Item\b0\cell\pard\intbl Status\cell\row
\trowd\cellx3000\cellx6000\pard\intbl Firestop\cell\pard\intbl\cell\row
\pard See {\field{\*\fldinst{HYPERLINK "https://surveytool.app/a?b=1"}}{\fldrslt{\ul the site}}}.\par
{\*\shppict{\pict{\*\picprop{\sp{\sn shapeType}{\sv 75}}}\pngblip\picw1\pich1 ${PNG_HEX}}}{\nonshppict{\pict\wmetafile8 0102}}
{\pict\wmetafile8\picw10 0102030405}\par
{\*\unknowndest secret}Last line\par
}`;

test('rtf: Word-style file becomes headings, styled text, lists, a table, a link and pictures', () => {
  const { blocks, skippedImages } = readRtf(rtf(WORDISH));
  const paras = blocks.filter((b) => b.kind === 'para');
  assert.equal(blocks[0].style, 'h1');
  assert.equal(text(blocks[0]), 'Site report');
  const styled = paras[1].runs;
  assert.ok(styled.find((r) => r.text === 'bold').b);
  assert.ok(styled.find((r) => r.text === 'italic').i);
  assert.ok(styled.find((r) => r.text === 'under').u);
  assert.ok(styled.find((r) => r.text === 'gone').s);
  assert.equal(text(paras[2]), 'Café — dash and Привет');
  assert.equal(text(paras[3]), 'Seen\nnext line');
  const lists = paras.filter((b) => b.list);
  assert.deepEqual(lists.map((b) => [text(b), b.list.depth, b.list.ordered, b.list.n]), [
    ['Bullet one', 0, false, 1], ['Bullet inner', 1, false, 1], ['Third step', 0, true, 3],
  ]);
  const table = blocks.find((b) => b.kind === 'table');
  assert.deepEqual(table.rows.map((r) => r.map((c) => c.blocks.map(text).join(''))), [['Item', 'Status'], ['Firestop', '']]);
  assert.ok(table.rows[0][0].blocks[0].runs[0].b);
  const link = paras.flatMap((b) => b.runs).find((r) => r.href);
  assert.deepEqual([link.text, link.href], ['the site', 'https://surveytool.app/a?b=1']);
  const images = blocks.filter((b) => b.kind === 'image');
  assert.equal(images.length, 1, 'the PNG once, not its WMF stand-in');
  assert.match(images[0].src, /^data:image\/png;base64,iVBOR/);
  assert.equal(skippedImages, 1, 'the lone WMF picture is counted');
  const all = JSON.stringify(blocks);
  for (const gone of ['Header text', 'Not body text', 'hidden words', 'secret', 'Riched20', 'Calibri', 'heading 1']) assert.ok(!all.includes(gone), gone);
  assert.equal(text(paras[paras.length - 1]), 'Last line');
});

test('rtf to PDF: lays out over pages with the Unicode font only when needed', async () => {
  const fontsDir = new URL('../../assets/fonts/', import.meta.url);
  let loads = 0;
  const loadFont = async (kind) => { loads += 1; return readFileSync(new URL(kind === 'cjk' ? 'DroidSansFallback.ttf' : 'NotoSans-Regular.ttf', fontsDir)); };
  const { blocks } = readRtf(rtf(WORDISH));
  const { bytes, skippedImages } = await docxBlocksToPdf(blocks, { loadFont, loadFontkit: async () => fontkit });
  assert.equal(loads, 1, 'Cyrillic needs the Unicode font');
  assert.equal(skippedImages, 0);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);

  const long = `{\\rtf1\\ansi ${'\\pard Lorem ipsum dolor sit amet, consectetur adipiscing elit.\\par '.repeat(300)}}`;
  const pdf = await PDFDocument.load((await docxBlocksToPdf(readRtf(rtf(long)).blocks, { pageSize: 'a4' })).bytes);
  assert.ok(pdf.getPageCount() >= 5, `pages ${pdf.getPageCount()}`);
});

test('rtf: TextEdit-style file, \\uc0 and \\bin pictures', () => {
  const mac = String.raw`{\rtf1\ansi\ansicpg1252\cocoartf2761
{\fonttbl\f0\fswiss\fcharset0 Helvetica;\f1\fnil\fcharset0 Menlo-Regular;}
{\colortbl;\red255\green255\blue255;}
\pard\tx720\pardirnatural\partightenfactor0
\f0\fs24 \cf0 Line one\
\uc0@u8220 Quoted@u8221  and @u-10179 @u-8704 \
}`;
  const { blocks } = readRtf(rtf(mac));
  assert.deepEqual(blocks.map(text), ['Line one', '“Quoted” and 😀']);
  const png = Buffer.from(PNG_HEX, 'hex');
  const bin = new Uint8Array([...rtf('{\\rtf1 {\\pict\\pngblip\\bin'), ...rtf(String(png.length)), 0x20, ...png, ...rtf('}\\par After\\par}')]);
  const out = readRtf(bin).blocks;
  assert.equal(out[0].kind, 'image');
  assert.equal(Buffer.from(out[0].src.split(',')[1], 'base64').toString('hex'), PNG_HEX);
  assert.equal(text(out[1]), 'After');
});

test('rtf: parts that won\'t carry over are listed; other files are refused', () => {
  assert.deepEqual(inspectRtf(rtf(WORDISH)), ['headers or footers']);
  assert.deepEqual(inspectRtf(rtf('{\\rtf1\\sectd\\cols2 {\\shp{\\*\\shpinst{\\shptxt Box}}} x}')), ['columns', 'text boxes or shapes']);
  assert.ok(isRtf(rtf('{\\rtf1 x}')));
  assert.throws(() => readRtf(rtf('<html>no</html>')), (e) => e instanceof ToolError && /RTF/.test(e.message));
  assert.throws(() => readRtf(rtf('{\\rtf1\\ansi {\\fonttbl{\\f0 Arial;}}}')), (e) => e instanceof ToolError && /empty/.test(e.message));
});
