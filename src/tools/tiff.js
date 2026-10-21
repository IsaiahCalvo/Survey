// TIFF decoding for TIFF to PDF (utif2, MIT). Only Safari can open TIFFs
// natively, so every browser goes through this. Pure JS, no DOM.
import UTIF from 'utif2';
import { ToolError } from './errors.js';

export function isTiff(bytes) {
  return (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 42 && bytes[3] === 0)
    || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 42);
}

// Dots per inch from the resolution tags, or null when the file doesn't say.
function tiffDpi(ifd) {
  const r = ifd.t282?.[0];
  const v = Array.isArray(r) ? r[0] / (r[1] || 1) : Number(r);
  if (!(v > 0)) return null;
  const unit = ifd.t296?.[0] ?? 2;
  if (unit === 3) return v * 2.54;
  if (unit === 1) return null;
  return v;
}

// Every page of a TIFF as { width, height, rgba, dpi }. `onPage(i, n)` reports
// progress. Thumbnails and other sub-images are skipped.
export function decodeTiff(bytes, onPage) {
  if (!isTiff(bytes)) throw new ToolError('This file isn\'t a TIFF image.');
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  let ifds;
  try {
    ifds = UTIF.decode(buf);
  } catch {
    throw new ToolError('This TIFF could not be read. It may be damaged.');
  }
  // Bit 0 of NewSubfileType marks a reduced copy (a thumbnail).
  const pages = ifds.filter((ifd) => ifd.t256 && ifd.t257 && !((ifd.t254?.[0] ?? 0) & 1));
  const out = [];
  pages.forEach((ifd, i) => {
    onPage?.(i, pages.length);
    try {
      UTIF.decodeImage(buf, ifd);
      out.push({ width: ifd.width, height: ifd.height, rgba: UTIF.toRGBA8(ifd), dpi: tiffDpi(ifd) });
    } catch {
      throw new ToolError(`Page ${i + 1} of this TIFF uses a kind of compression that can't be opened here.`);
    }
    ifd.data = null;
  });
  if (!out.length) throw new ToolError('This TIFF has no pages in it.');
  return out;
}
