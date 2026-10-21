// Put a PNG or JPG (a logo, stamp, signature or north arrow) on chosen pages.
// Pure pdf-lib, so it runs in Node too.
import { degrees } from 'pdf-lib';
import { loadPdf, visualFrame } from './ops.js';
import { ToolError } from './errors.js';

// Gap between the image and the page edge, in points (a quarter inch).
export const EDGE = 18;
export const POSITIONS = ['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right'];

export function imageKind(bytes) {
  if (bytes?.[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes?.[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}

// Where the image's lower-left corner goes on a page `pw` x `ph` (as seen),
// and its drawn size. widthPct is the share of the page width, 1 to 100.
export function placeBox(pw, ph, iw, ih, { position = 'bottom-right', widthPct = 20 } = {}) {
  const pct = Math.min(100, Math.max(1, Number(widthPct) || 20)) / 100;
  let w = pw * pct;
  let h = (w * ih) / iw;
  // Too tall for the page: shrink to fit between the edges.
  const maxH = Math.max(1, ph - 2 * EDGE);
  if (h > maxH) {
    w *= maxH / h;
    h = maxH;
  }
  const edgeX = Math.min(EDGE, Math.max(0, (pw - w) / 2));
  const edgeY = Math.min(EDGE, Math.max(0, (ph - h) / 2));
  const [row, col] = position === 'center' ? ['middle', 'center'] : position.split('-');
  const x = col === 'left' ? edgeX : col === 'right' ? pw - w - edgeX : (pw - w) / 2;
  const y = row === 'top' ? ph - h - edgeY : row === 'bottom' ? edgeY : (ph - h) / 2;
  return { x, y, w, h };
}

// pages: 0-based indexes to stamp. opacity 0 to 1.
export async function addImageToPdf(bytes, image, {
  pages, position = 'bottom-right', widthPct = 20, opacity = 1,
} = {}) {
  const kind = imageKind(image);
  if (!kind) throw new ToolError('Choose a PNG or JPG image.');
  const doc = await loadPdf(bytes);
  let embedded;
  try {
    embedded = kind === 'png' ? await doc.embedPng(image) : await doc.embedJpg(image);
  } catch {
    throw new ToolError('That image could not be read. Try saving it again as a PNG or JPG.');
  }
  const all = doc.getPages();
  const pick = pages ?? all.map((_, i) => i);
  if (!pick.length) throw new ToolError('Pick at least one page.');
  for (const i of pick) {
    const page = all[i];
    if (!page) continue;
    const f = visualFrame(page);
    const box = placeBox(f.width, f.height, embedded.width, embedded.height, { position, widthPct });
    const at = f.toPage(box.x, box.y);
    page.drawImage(embedded, {
      x: at.x, y: at.y, width: box.w, height: box.h, opacity: Math.min(1, Math.max(0, opacity)), rotate: degrees(f.rotation),
    });
  }
  return doc.save({ useObjectStreams: true });
}
