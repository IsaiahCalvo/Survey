// Remove hidden data: document details, XMP metadata, scripts, attached files
// and (if asked) comments. Anything unlinked is then dropped from the file
// for real, along with leftovers of earlier saves, so it can't be dug out of
// the bytes later. Pure pdf-lib, no DOM.
import {
  PDFArray, PDFDict, PDFName, PDFRef, PDFStream,
} from 'pdf-lib';
import { ToolError } from './errors.js';
import { loadPdf } from './ops.js';

const N = PDFName.of;
// Actions that run code or open other programs.
const RISKY = new Set([N('JavaScript'), N('Launch')]);
const KEEP_ANNOTS = new Set([N('Widget'), N('Link')]);

const dictOf = (o) => (o instanceof PDFDict ? o : o instanceof PDFStream ? o.dict : null);

// Number of entries in a name tree (e.g. /Names /JavaScript).
function countNameTree(ctx, node, depth = 0) {
  const d = ctx.lookup(node);
  if (!(d instanceof PDFDict) || depth > 32) return 0;
  const names = ctx.lookup(d.get(N('Names')));
  let n = names instanceof PDFArray ? Math.floor(names.size() / 2) : 0;
  const kids = ctx.lookup(d.get(N('Kids')));
  if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i += 1) n += countNameTree(ctx, kids.get(i), depth + 1);
  return n;
}

function isRisky(ctx, action) {
  const a = ctx.lookup(action);
  return a instanceof PDFDict && RISKY.has(a.get(N('S')));
}

// Drops every object nothing points to any more.
function dropUnreachable(ctx) {
  const reached = new Set();
  const stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt];
  while (stack.length) {
    const o = stack.pop();
    if (!o) continue;
    if (o instanceof PDFRef) {
      const key = o.toString();
      if (reached.has(key)) continue;
      reached.add(key);
      stack.push(ctx.lookup(o));
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i += 1) stack.push(o.get(i));
    } else if (dictOf(o)) {
      for (const [, v] of dictOf(o).entries()) stack.push(v);
    }
  }
  let dropped = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!reached.has(ref.toString())) {
      ctx.delete(ref);
      dropped += 1;
    }
  }
  return dropped;
}

export async function sanitizePdf(bytes, {
  info = true, metadata = true, scripts = true, files = true, comments = false,
} = {}) {
  const doc = await loadPdf(bytes);
  const ctx = doc.context;
  const cat = doc.catalog;
  const found = { info: 0, metadata: 0, scripts: 0, files: 0, comments: 0 };

  if (info) {
    const dict = ctx.lookup(ctx.trailerInfo.Info);
    if (dict instanceof PDFDict && dict.keys().length) found.info = 1;
    ctx.trailerInfo.Info = undefined;
  }

  const names = ctx.lookup(cat.get(N('Names')));
  if (names instanceof PDFDict) {
    if (scripts && names.has(N('JavaScript'))) {
      found.scripts += Math.max(1, countNameTree(ctx, names.get(N('JavaScript'))));
      names.delete(N('JavaScript'));
    }
    if (files && names.has(N('EmbeddedFiles'))) {
      found.files += Math.max(1, countNameTree(ctx, names.get(N('EmbeddedFiles'))));
      names.delete(N('EmbeddedFiles'));
    }
    if (!names.keys().length) cat.delete(N('Names'));
  }
  if (files && cat.has(N('Collection'))) cat.delete(N('Collection'));

  // Annotations: attached-file pins go with the files, the rest with comments.
  for (const page of doc.getPages()) {
    const annots = ctx.lookup(page.node.get(N('Annots')));
    if (!(annots instanceof PDFArray)) continue;
    const keep = annots.asArray().filter((ref) => {
      const sub = dictOf(ctx.lookup(ref))?.get(N('Subtype'));
      if (sub === N('FileAttachment') && files) { found.files += 1; return false; }
      if (comments && !KEEP_ANNOTS.has(sub)) {
        if (sub !== N('Popup')) found.comments += 1;
        return false;
      }
      return true;
    });
    if (keep.length === annots.size()) continue;
    if (keep.length) page.node.set(N('Annots'), ctx.obj(keep));
    else page.node.delete(N('Annots'));
  }

  // Every dictionary in the file, and the ones nested inside it.
  const seen = new Set();
  const clean = (d, depth) => {
    if (!d || seen.has(d) || depth > 64) return;
    seen.add(d);
    if (metadata) {
      for (const key of ['Metadata', 'PieceInfo']) {
        if (d.has(N(key))) { d.delete(N(key)); found.metadata += 1; }
      }
    }
    if (scripts) {
      if (d.has(N('AA'))) { d.delete(N('AA')); found.scripts += 1; }
      for (const key of ['A', 'OpenAction']) {
        if (isRisky(ctx, d.get(N(key)))) { d.delete(N(key)); found.scripts += 1; }
      }
      const next = ctx.lookup(d.get(N('Next')));
      if (isRisky(ctx, d.get(N('Next')))) {
        d.delete(N('Next'));
        found.scripts += 1;
      } else if (next instanceof PDFArray) {
        const safe = next.asArray().filter((a) => !isRisky(ctx, a));
        found.scripts += next.size() - safe.length;
        if (safe.length !== next.size()) d.set(N('Next'), ctx.obj(safe));
      }
    }
    // /AF lists files already counted above; count it only when it's all there is.
    if (files && d.has(N('AF'))) { d.delete(N('AF')); found.files ||= 1; }
    for (const [, v] of d.entries()) {
      if (v instanceof PDFArray) v.asArray().forEach((x) => clean(dictOf(x), depth + 1));
      else clean(dictOf(v), depth + 1);
    }
  };
  for (const [, obj] of ctx.enumerateIndirectObjects()) clean(dictOf(obj), 0);

  if (!Object.values(found).some(Boolean)) {
    throw new ToolError('We found none of the chosen hidden data in this PDF. It is already clean.');
  }
  dropUnreachable(ctx);
  const out = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  return { bytes: out, found, note: describeRemoved(found) };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function describeRemoved(found) {
  const parts = [];
  if (found.info) parts.push('document details (title, author, dates)');
  if (found.metadata) parts.push('hidden XMP metadata');
  if (found.scripts) parts.push(plural(found.scripts, 'script or auto action', 'scripts or auto actions'));
  if (found.files) parts.push(plural(found.files, 'attached file', 'attached files'));
  if (found.comments) parts.push(plural(found.comments, 'comment', 'comments'));
  if (!parts.length) return '';
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `Removed ${list}.`;
}
