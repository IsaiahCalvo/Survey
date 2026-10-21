// Tools whose catalog entry lives in its own file (one per tool, same shape
// as the entries in ../free-tools-catalog.mjs). Add new ones here.
import ocrPdf from './ocr-pdf.mjs';
import resizePdf from './resize-pdf.mjs';
import nUpPdf from './n-up-pdf.mjs';
import bookletPdf from './booklet-pdf.mjs';
import reversePdf from './reverse-pdf.mjs';
import addBlankPages from './add-blank-pages.mjs';
import repairPdf from './repair-pdf.mjs';
import splitByBookmarks from './split-by-bookmarks.mjs';
import sanitizePdf from './sanitize-pdf.mjs';
import fastWebView from './fast-web-view.mjs';

export default [
  ocrPdf,
  resizePdf,
  nUpPdf,
  bookletPdf,
  reversePdf,
  addBlankPages,
  repairPdf,
  splitByBookmarks,
  sanitizePdf,
  fastWebView,
];
