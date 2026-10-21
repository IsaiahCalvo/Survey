// Tools whose catalog entry lives in its own file (one per tool, same shape
// as the entries in ../free-tools-catalog.mjs). Add new ones here.
import ocrPdf from './ocr-pdf.mjs';
import comparePdf from './compare-pdf.mjs';
import resizePdf from './resize-pdf.mjs';
import nUpPdf from './n-up-pdf.mjs';
import bookletPdf from './booklet-pdf.mjs';
import reversePdf from './reverse-pdf.mjs';
import addBlankPages from './add-blank-pages.mjs';
import repairPdf from './repair-pdf.mjs';
import splitByBookmarks from './split-by-bookmarks.mjs';
import sanitizePdf from './sanitize-pdf.mjs';
import fastWebView from './fast-web-view.mjs';
import extractImages from './extract-images.mjs';
import removeBlankPages from './remove-blank-pages.mjs';
import pdfToTiff from './pdf-to-tiff.mjs';
import pdfToBmp from './pdf-to-bmp.mjs';
import grayscalePdf from './grayscale-pdf.mjs';
import pdfToWord from './pdf-to-word.mjs';
import pdfToMarkdown from './pdf-to-markdown.mjs';
import pdfToDocx from './pdf-to-docx.mjs';
import splitBySize from './split-by-size.mjs';
import pdfPageSizes from './pdf-page-sizes.mjs';
import addImageToPdf from './add-image-to-pdf.mjs';
import rtfToPdf from './rtf-to-pdf.mjs';
import htmlToPdf from './html-to-pdf.mjs';
import docxToPdf from './docx-to-pdf.mjs';
import bmpToPdf from './bmp-to-pdf.mjs';
import gifToPdf from './gif-to-pdf.mjs';
import pdfToGif from './pdf-to-gif.mjs';
import pdfToHtml from './pdf-to-html.mjs';
import pdfToRtf from './pdf-to-rtf.mjs';

export default [
  ocrPdf,
  comparePdf,
  resizePdf,
  nUpPdf,
  bookletPdf,
  reversePdf,
  addBlankPages,
  repairPdf,
  splitByBookmarks,
  sanitizePdf,
  fastWebView,
  extractImages,
  removeBlankPages,
  pdfToTiff,
  pdfToBmp,
  grayscalePdf,
  pdfToWord,
  pdfToMarkdown,
  pdfToDocx,
  splitBySize,
  pdfPageSizes,
  addImageToPdf,
  rtfToPdf,
  htmlToPdf,
  docxToPdf,
  bmpToPdf,
  gifToPdf,
  pdfToGif,
  pdfToHtml,
  pdfToRtf,
];
