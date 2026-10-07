import { PDFDocument, degrees } from 'pdf-lib';
import { blankPageReferencePage, blankPageSize } from './blankPageSize.js';

const pageNumber = (value, count, label) => {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1 || page > count) {
    throw new RangeError(`${label} must be between 1 and ${count}`);
  }
  return page;
};

// An insertion slot: 0 = before page 1, n = after page n.
const slotNumber = (value, count, label) => {
  const slot = Number(value);
  if (!Number.isInteger(slot) || slot < 0 || slot > count) {
    throw new RangeError(`${label} must be between 0 and ${count}`);
  }
  return slot;
};

function reorderPages(pdf, from, to) {
  if (from === to) return;
  // Move the existing page-tree leaf instead of copying every page into a new
  // tree. The page's indirect reference is the identity used by AcroForm
  // widgets, named destinations, outlines, and internal GoTo annotations.
  // Reusing that same PDFPage keeps every inbound reference valid.
  const moved = pdf.getPage(from - 1);
  pdf.removePage(from - 1);
  pdf.insertPage(to - 1, moved);
}

async function applyOperation(pdf, operation) {
  const count = pdf.getPageCount();
  const type = operation?.type;

  if (type === 'delete') {
    if (count <= 1) throw new Error('A PDF must keep at least one page.');
    pdf.removePage(pageNumber(operation.page, count, 'page') - 1);
  } else if (type === 'insert') {
    // Sized like the page above it as shown (utils/blankPageSize.js).
    const afterPage = slotNumber(operation.afterPage, count, 'afterPage');
    const reference = pdf.getPage(blankPageReferencePage(afterPage, count) - 1);
    const { width, height } = blankPageSize({ ...reference.getSize(), rotation: reference.getRotation().angle });
    pdf.insertPage(afterPage, [width, height]);
  } else if (type === 'restore') {
    // Undo of a delete (utils/pageOperationHistory.js): the removed page goes
    // back as it was shown. `entry` is its page-view entry
    // (pageViewEntry): a blank page, or page `entry.src` of the document as
    // first opened (`baseBytes`) turned a further `entry.rot` degrees.
    const afterPage = slotNumber(operation.afterPage, count, 'afterPage');
    const entry = operation.entry || {};
    const extra = Number(entry.rot || 0);
    if (entry.blank) {
      const page = pdf.insertPage(afterPage, [entry.blank.width, entry.blank.height]);
      page.setRotation(degrees(((extra % 360) + 360) % 360));
    } else {
      if (!operation.baseBytes) throw new Error('restore needs the document as first opened');
      const base = await PDFDocument.load(operation.baseBytes);
      const [copied] = await pdf.copyPages(base, [Number(entry.src) - 1]);
      copied.setRotation(degrees((((copied.getRotation().angle + extra) % 360) + 360) % 360));
      pdf.insertPage(afterPage, copied);
    }
  } else if (type === 'duplicate' || type === 'copy') {
    const source = pageNumber(operation.page ?? operation.source, count, 'source');
    const afterPage = slotNumber(operation.afterPage ?? operation.page ?? operation.target, count, 'afterPage');
    const [copied] = await pdf.copyPages(pdf, [source - 1]);
    pdf.insertPage(afterPage, copied);
  } else if (type === 'move' || type === 'reorder') {
    const from = pageNumber(operation.from, count, 'from');
    const to = pageNumber(operation.to, count, 'to');
    reorderPages(pdf, from, to);
  } else if (type === 'rotate') {
    const page = pdf.getPage(pageNumber(operation.page, count, 'page') - 1);
    const delta = Number(operation.delta ?? 90);
    if (!Number.isFinite(delta) || delta % 90 !== 0) throw new Error('rotation delta must be a multiple of 90');
    page.setRotation(degrees((page.getRotation().angle + delta + 360) % 360));
  } else {
    throw new Error(`Unsupported PDF page mutation: ${type}`);
  }
}

async function mutateOnce(inputBytes, operation) {
  const pdf = await PDFDocument.load(inputBytes);
  await applyOperation(pdf, operation);
  return pdf.save();
}

export async function mutatePdfPages(inputBytes, operation) {
  return mutateOnce(inputBytes, operation);
}

// Several page operations, in order, for ONE upload (usePageOperations
// coalesces quick successive taps). Each operation still gets its own
// load + save: pdf-lib mis-orders pages when several removePage/insertPage
// calls run on one loaded document (tests/pageViewDocument.test.mjs, seed 18:
// delete, move, rotate, delete, copy, move put page 3 where page 4 belonged).
export async function mutatePdfPagesBatch(inputBytes, operations) {
  let bytes = inputBytes;
  for (const operation of operations || []) {
    bytes = await mutateOnce(bytes, operation);
  }
  return bytes;
}
