// What a tool module under defs/ builds on. A def is the same shape as an
// entry in TOOLS in app.js:
//   view: 'files' | 'pages' | 'organize'   how the chosen files are shown
//   options: [{ key, label, type: SEG|'select'|'text'|'number'|'check'|'password'|'pages', def, choices, show, help }]
//   select: 'keep' | 'delete'              pages view: tap pages to pick them
//   prepare(item)                          once per added file (item.bytes, item.name, item.pages, item.pdfjs())
//   notice(files) -> string | null         a note shown above the options
//   run(files, opts, progress) -> [{ name, bytes, type, note? }]   more than one output is zipped
// Throw ToolError with a plain message for anything the person should read.
export const PDF_TYPE = 'application/pdf';
export const SEG = 'seg';
export const base = (name) => name.replace(/\.[a-z0-9]+$/i, '');
export const pdfOut = (name, bytes) => ({ name, bytes, type: PDF_TYPE });
export { ToolError } from './errors.js';
export {
  openPdfjs, renderPage, canvasToBytes, releaseCanvas, prepareImage, runQpdf,
} from './browser.js';
// pdf-lib helpers (ops.js) load on first use.
export const loadOps = () => import('./ops.js');
