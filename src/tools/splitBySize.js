// Split a PDF into parts that each stay under a size limit, so a drawing set
// fits an email or upload portal. Pure pdf-lib, so it runs in Node too.
//
// Each page's size is estimated from the objects it uses (its content,
// fonts, images), counting an object shared by several pages once per part.
// Pages go into a part while the estimate fits; then the part is saved and
// its real size checked, dropping pages off the end if it is still too big.
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream,
} from 'pdf-lib';
import { loadPdf } from './ops.js';
import { ToolError } from './errors.js';

export const MB = 1000 * 1000;
// Header, catalog, page tree, xref table and trailer of a part.
const PART_OVERHEAD = 2048;
// "12 0 obj ... endobj" plus its xref line.
const PER_OBJECT = 40;

const TYPE = PDFName.of('Type');
const PAGE = PDFName.of('Page');
const PAGES = PDFName.of('Pages');
const PARENT = PDFName.of('Parent');

// The objects a page pulls in, as Map(ref tag -> bytes). Stops at other pages
// and the page tree, which a part never copies whole.
export function pageObjects(doc, page) {
  const ctx = doc.context;
  const found = new Map();
  const stack = [];
  const visit = (obj) => {
    if (obj instanceof PDFRef) {
      const tag = obj.toString();
      if (found.has(tag)) return;
      const target = ctx.lookup(obj);
      if (target === undefined) return;
      if (target instanceof PDFDict && target !== page.node) {
        const type = target.get(TYPE);
        if (type === PAGE || type === PAGES) return;
      }
      found.set(tag, target.sizeInBytes() + PER_OBJECT);
      stack.push(target);
    } else if (obj instanceof PDFDict || obj instanceof PDFArray || obj instanceof PDFStream) {
      stack.push(obj);
    }
  };
  stack.push(page.node);
  while (stack.length) {
    const obj = stack.pop();
    if (obj instanceof PDFStream) {
      visit(obj.dict);
    } else if (obj instanceof PDFDict) {
      for (const [key, value] of obj.entries()) {
        if (obj === page.node && key === PARENT) continue;
        visit(value);
      }
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i += 1) visit(obj.get(i));
    }
  }
  // The page dictionary itself is written too.
  found.set('page', page.node.sizeInBytes() + PER_OBJECT);
  return found;
}

// Groups of 0-based page indexes whose estimated size stays under `limit`.
// `sizes` is one Map per page from pageObjects.
export function planParts(sizes, limit) {
  const groups = [];
  let group = [];
  let seen = new Set();
  let total = PART_OVERHEAD;
  sizes.forEach((objects, i) => {
    let extra = 0;
    for (const [tag, n] of objects) if (tag === 'page' || !seen.has(tag)) extra += n;
    if (group.length && total + extra > limit) {
      groups.push(group);
      group = [];
      seen = new Set();
      total = PART_OVERHEAD;
      extra = 0;
      for (const n of objects.values()) extra += n;
    }
    group.push(i);
    total += extra;
    for (const tag of objects.keys()) seen.add(tag);
  });
  if (group.length) groups.push(group);
  return groups;
}

async function savePart(src, indexes) {
  const out = await PDFDocument.create({ updateMetadata: false });
  const pages = await out.copyPages(src, indexes);
  pages.forEach((p) => out.addPage(p));
  const title = src.getTitle();
  if (title) out.setTitle(title);
  return out.save({ useObjectStreams: true });
}

// -> { parts: [{ pages: [0-based], bytes }], tooBig: [0-based pages that are
// over the limit on their own] }
export async function splitBySize(bytes, limit, progress = () => {}) {
  if (!(limit > 0)) throw new ToolError('Pick a size bigger than 0 MB.');
  const src = await loadPdf(bytes);
  const pages = src.getPages();
  const sizes = pages.map((page, i) => {
    if (i % 20 === 0) progress(`Measuring page ${i + 1} of ${pages.length}`);
    return pageObjects(src, page);
  });
  // Plan from the estimate, then save each part and check its real size.
  const queue = planParts(sizes, limit);
  const parts = [];
  const tooBig = [];
  while (queue.length) {
    let group = queue.shift();
    progress(`Making part ${parts.length + 1}`);
    let out = await savePart(src, group);
    while (out.length > limit && group.length > 1) {
      // Too big after all: move pages to the next part until it fits.
      const cut = Math.max(1, Math.floor(group.length * (1 - limit / out.length)));
      const rest = group.slice(group.length - cut);
      group = group.slice(0, group.length - cut);
      if (queue.length) queue[0] = [...rest, ...queue[0]];
      else queue.push(rest);
      out = await savePart(src, group);
    }
    if (out.length > limit) tooBig.push(group[0]);
    parts.push({ pages: group, bytes: out });
  }
  return { parts, tooBig };
}

// "Plans (part 1 of 3).pdf"
export const partName = (stem, n, total) => `${stem} (part ${n} of ${total}).pdf`;
