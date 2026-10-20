// Builds debug/fixtures/kal402-schematic-pages.pdf for Schematic Mode (KAL-402):
//   1  letter page of body text            -> not a schematic
//   2  scanned-style P&ID, one picture      -> schematic (raster)
//   3  CAD-style one-line, lines + labels   -> schematic (vector)
//   4  picture with lines drawn over it     -> schematic (mixed)
//   5  blank sheet with a border and title  -> not a schematic
//   node debug/fixtures/make-schematic-pages.mjs
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('./kal402-schematic-pages.pdf', import.meta.url));

// A tiny grayscale PNG encoder, so the fixture needs no image library.
function png(width, height, gray) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    gray.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Draws a P&ID-like picture: pipes, valves (bow ties), tanks and instrument bubbles.
function pidPicture(width, height) {
  const g = Buffer.alloc(width * height, 250);
  const dot = (x, y, r = 1) => {
    for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      const px = Math.round(x + dx); const py = Math.round(y + dy);
      if (px >= 0 && py >= 0 && px < width && py < height) g[py * width + px] = 20;
    }
  };
  const line = (x1, y1, x2, y2) => {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let i = 0; i <= steps; i += 1) dot(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps);
  };
  const circle = (cx, cy, r) => { for (let a = 0; a < 360; a += 1) dot(cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)); };
  line(20, 20, width - 20, 20); line(width - 20, 20, width - 20, height - 20);
  line(width - 20, height - 20, 20, height - 20); line(20, height - 20, 20, 20);
  for (let row = 0; row < 5; row += 1) {
    const y = 120 + row * 130;
    line(80, y, width - 80, y);
    for (let k = 0; k < 6; k += 1) {
      const x = 160 + k * 170;
      line(x - 14, y - 10, x + 14, y + 10); line(x - 14, y + 10, x + 14, y - 10);
      line(x - 14, y - 10, x - 14, y + 10); line(x + 14, y - 10, x + 14, y + 10);
      circle(x + 60, y - 45, 22); line(x + 60, y - 23, x + 60, y);
    }
  }
  for (let t = 0; t < 3; t += 1) { circle(200 + t * 380, height - 110, 50); }
  return png(width, height, g);
}

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const ink = rgb(0.1, 0.1, 0.1);

// 1. Body text.
{
  const page = doc.addPage([612, 792]);
  const words = 'The contractor shall verify all field conditions before starting work and report any conflict to the engineer in writing within two days'.split(' ');
  for (let line = 0; line < 52; line += 1) {
    const text = Array.from({ length: 14 }, (_, i) => words[(line * 5 + i) % words.length]).join(' ');
    page.drawText(text, { x: 54, y: 740 - line * 13, size: 10, font, color: ink });
  }
}

const picture = await doc.embedPng(pidPicture(1224, 792));

// 2. Raster P&ID: one picture, no text.
doc.addPage([1224, 792]).drawImage(picture, { x: 0, y: 0, width: 1224, height: 792 });

// 3. Vector one-line: many separate strokes and a few labels.
function drawOneLine(page, labels = true) {
  for (let bus = 0; bus < 5; bus += 1) {
    const y = 680 - bus * 135;
    page.drawLine({ start: { x: 80, y }, end: { x: 1140, y }, thickness: 2, color: ink });
    for (let k = 0; k < 14; k += 1) {
      const x = 120 + k * 72;
      page.drawLine({ start: { x, y }, end: { x, y: y - 60 }, thickness: 1, color: ink });
      page.drawCircle({ x, y: y - 72, size: 10, borderColor: ink, borderWidth: 1 });
      page.drawRectangle({ x: x - 8, y: y - 110, width: 16, height: 18, borderColor: ink, borderWidth: 1 });
      if (labels && k % 3 === 0) page.drawText(`CB-${bus + 1}${k}`, { x: x - 12, y: y - 128, size: 6, font, color: ink });
    }
  }
}
drawOneLine(doc.addPage([1224, 792]));

// 4. Mixed: the picture with lines drawn over it.
{
  const page = doc.addPage([1224, 792]);
  page.drawImage(picture, { x: 0, y: 0, width: 1224, height: 792 });
  drawOneLine(page, false);
}

// 5. Blank sheet: border and a title only.
{
  const page = doc.addPage([1224, 792]);
  page.drawRectangle({ x: 12, y: 12, width: 1200, height: 768, borderColor: ink, borderWidth: 2 });
  page.drawText('SHEET E-000 (INTENTIONALLY BLANK)', { x: 40, y: 40, size: 14, font, color: ink });
}

writeFileSync(out, await doc.save());
console.log('wrote', out);
