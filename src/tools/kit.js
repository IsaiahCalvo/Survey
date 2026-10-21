// What a tool module under defs/ builds on. A def is the same shape as an
// entry in TOOLS in app.js:
//   view: 'files' | 'pages' | 'organize'   how the chosen files are shown
//   options: [{ key, label, type: SEG|'select'|'text'|'number'|'check'|'password'|'pages'|'file', def, choices, show, help, onChange(value, files) }]
//            type 'file' takes a second file (accept, pick: button text); its value is
//            { name, type, bytes, url } or null, and it stays when the main file changes
//   select: 'keep' | 'delete'              pages view: tap pages to pick them
//   keepLock: true                         take password-locked PDFs as they are (item.locked)
//   openAnyway: true                       take PDFs pdf.js can't open (item.broken, item.pages 0)
//   prepare(item, busy)                    once per added file (item.bytes, item.name, item.pages, item.pdfjs());
//                                          busy(text) shows progress while it runs
//   notice(files, opts) -> string | null   a note shown above the options
//   auto: true                             run as soon as a file is added (no options to set first)
//   run(files, opts, progress) -> [{ name, bytes, type, note? }]   more than one output is zipped
//                                          (the first note shows on the ZIP). A single output may
//                                          also carry title (result heading), view(h) -> Node shown
//                                          on the result, and saveLabel (the Download button text)
// Throw ToolError with a plain message for anything the person should read.
export const PDF_TYPE = 'application/pdf';
export const SEG = 'seg';
export const base = (name) => name.replace(/\.[a-z0-9]+$/i, '');
export const pdfOut = (name, bytes) => ({ name, bytes, type: PDF_TYPE });
export { ToolError } from './errors.js';
export {
  openPdfjs, renderPage, canvasToBytes, releaseCanvas, prepareImage, runQpdf, MAX_PIXELS,
} from './browser.js';
// pdf-lib helpers (ops.js) load on first use.
export const loadOps = () => import('./ops.js');
