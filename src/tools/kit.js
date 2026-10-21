// What a tool module under defs/ builds on. A def is the same shape as an
// entry in TOOLS in app.js:
//   view: 'files' | 'pages' | 'organize'   how the chosen files are shown
//   options: [{ key, label, type: SEG|'select'|'text'|'number'|'check'|'password'|'pages'|'color'|'file'|'insert', def, choices, show(opts, files), help, onChange(value, files) }]
//     more: true      tucked under "More options"      grid: true   a SEG laid out three across
//     'file'          a second file (accept, pick: button text); its value is { name, type, mime, bytes, url }
//                     or null, and it stays when the main file changes
//     'insert'        choices of [token, label] typed into the text box last used (or `target`)
//     The last settings used are kept in this browser; forget: true leaves one out
//     (passwords, files and per-file defaults are never kept).
//   select: 'keep' | 'delete'              pages view: tap pages to pick them
//   keepLock: true                         take password-locked PDFs as they are (item.locked)
//   openAnyway: true                       take PDFs pdf.js can't open (item.broken, item.pages 0)
//   prepare(item, busy)                    once per added file (item.bytes, item.name, item.pages, item.pdfjs());
//                                          busy(text) shows progress while it runs
//   notice(files, opts) -> string | null   a note shown above the options
//   auto: true                             run as soon as a file is added (no options to set first)
//   run(files, opts, progress, { batch }) -> [{ name, bytes, type, note? }]   more than one output is zipped
//                                          (the first note shows on the ZIP). A single output may
//                                          also carry title (result heading), view(h) -> Node shown
//                                          on the result, and saveLabel (the Download button text)
//                                          batch is true when several files run one at a time
// Throw ToolError with a plain message for anything the person should read.
export const PDF_TYPE = 'application/pdf';
export const SEG = 'seg';
export const base = (name) => name.replace(/\.[a-z0-9]+$/i, '');
export const pdfOut = (name, bytes) => ({ name, bytes, type: PDF_TYPE });
export { ToolError } from './errors.js';
export {
  openPdfjs, renderPage, canvasToBytes, releaseCanvas, prepareImage, runQpdf, MAX_PIXELS,
} from './browser.js';
import { loadDocFont } from './browser.js';
// pdf-lib helpers (ops.js) load on first use.
export const loadOps = () => import('./ops.js');

// Word, RTF and HTML to PDF: the same page options and layout (docLayout.js).
export const DOC_OPTIONS = [
  { key: 'pageSize', label: 'Page size', type: SEG, def: 'letter', choices: [['letter', 'Letter'], ['a4', 'A4']] },
  { key: 'font', label: 'Font', type: SEG, def: 'sans', choices: [['sans', 'Clean (Helvetica)'], ['serif', 'Classic (Times)']] },
];
// The heads-up for parts of a document that won't look the same, from the
// list each file's prepare() put in item.notes.
export function docNotice(files) {
  const notes = [...new Set(files.flatMap((f) => f.notes || []))];
  if (!notes.length) return null;
  const list = notes.length > 1 ? `${notes.slice(0, -1).join(', ')} and ${notes[notes.length - 1]}` : notes[0];
  return `Heads up: this document has ${list}, which won't look the same in the PDF. This tool is best for simple documents like letters, reports and specs.`;
}
// `left` is how many pictures were already left out, and `why(one)` says why.
const CANT_DRAW = (one) => `${one ? 'it uses' : 'they use'} a type a browser can't draw (like WMF or EMF)`;
export async function blocksToPdf(blocks, name, opts, { left = 0, why = CANT_DRAW } = {}) {
  const { docxBlocksToPdf } = await import('./docLayout.js');
  const { bytes, skippedImages } = await docxBlocksToPdf(blocks, {
    pageSize: opts.pageSize, font: opts.font, loadFont: loadDocFont, loadFontkit: async () => (await import('@pdf-lib/fontkit')).default,
  });
  const out = pdfOut(`${base(name)}.pdf`, bytes);
  const n = skippedImages + left;
  if (n) out.note = `${n} picture${n === 1 ? ' was' : 's were'} left out because ${why(n === 1)}.`;
  return out;
}
