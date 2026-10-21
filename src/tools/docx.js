// Word (.docx) to PDF in the browser. mammoth (BSD-2) reads the document into
// simple HTML, which docLayout.js parses into blocks and lays out with pdf-lib.
// This suits letters, reports and specs; text boxes, columns, shapes and
// headers don't carry over, so `inspectDocx` lists them for the page to warn
// about. Pure JS, no DOM, so it runs in Node tests too.
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { ToolError } from './errors.js';
import { htmlToBlocks } from './docLayout.js';

export { htmlToBlocks, docxBlocksToPdf } from './docLayout.js';

// ---------------------------------------------------------------- reading

export function isDocx(bytes) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

// What in this document won't look the same in the PDF, in plain words.
export async function inspectDocx(bytes) {
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return [];
  }
  const doc = await zip.file('word/document.xml')?.async('string');
  if (!doc) return [];
  const notes = [];
  if (doc.includes('<w:txbxContent')) notes.push('text boxes');
  if (/<w:cols\b[^>]*w:num="([2-9]|\d\d)"/.test(doc)) notes.push('columns');
  if (doc.includes('<wp:anchor')) notes.push('pictures or shapes placed around the text');
  if (/<c:chart\b|<a:graphicData[^>]*\/chart"/.test(doc)) notes.push('charts');
  if (doc.includes('<m:oMath')) notes.push('equations');
  if (Object.keys(zip.files).some((n) => /^word\/(header|footer)\d*\.xml$/.test(n))) notes.push('headers or footers');
  if (/[֐-ࣿ]/.test(doc)) notes.push('right-to-left text');
  return notes;
}

export async function readDocx(bytes) {
  if (!isDocx(bytes)) {
    throw new ToolError('This isn\'t a .docx file. Older .doc files need to be saved as .docx in Word first.');
  }
  let result;
  try {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    // The browser build reads `arrayBuffer`, the Node build (tests) `buffer`.
    result = await mammoth.convertToHtml({ arrayBuffer: buf, buffer: buf }, { styleMap: ['u => u'], includeDefaultStyleMap: true });
  } catch {
    throw new ToolError('This Word file could not be read. It may be damaged, or locked with a password.');
  }
  const blocks = htmlToBlocks(result.value);
  if (!blocks.length) throw new ToolError('This document looks empty.');
  return blocks;
}
