// A made-up shop drawing for Smart fill tests (2026-10-26). The repo is public,
// so tests must not ship a customer's drawings; this sheet copies what makes
// Schneider tags hard instead: divided-circle tags (each circle four curves,
// like a CAD export) that touch a wall, overlap the next tag, or sit flush
// against it, leader lines into the tags, and a grid of the same tag for
// Find more. Writes debug/fixtures/tag-sheet.pdf (one ANSI B sheet, 1224 x
// 792 points). Run: node debug/smart-fill/make-tag-sheet.mjs
import { writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const TAG_SHEET = {
  file: 'debug/fixtures/tag-sheet.pdf',
  width: 1224,
  height: 792,
  diameter: 20.2,
  // Tag boxes in page units (origin top-left, y down).
  tags: {
    'touches a wall': [289.9, 509.9, 310.1, 530.1],
    'overlaps the next tag': [89.9, 549.9, 110.1, 570.1],
    'touches the next tag': [89.9, 496.4, 110.1, 516.6],
  },
  teach: [609.9, 159.9, 630.1, 180.1],
  gridCount: 48,
  // A revision cloud drawn the Schneider way (separate arcs, end to start)
  // round this box, its scallops bulging out by 4; one tag sits inside it.
  cloud: [640, 640, 1000, 740],
  cloudTag: [689.9, 679.9, 710.1, 700.1],
};

const K = 0.5522847498;
const circlePath = (cx, cy, r) => [
  `M ${cx + r} ${cy}`,
  `C ${cx + r} ${cy + K * r} ${cx + K * r} ${cy + r} ${cx} ${cy + r}`,
  `C ${cx - K * r} ${cy + r} ${cx - r} ${cy + K * r} ${cx - r} ${cy}`,
  `C ${cx - r} ${cy - K * r} ${cx - K * r} ${cy - r} ${cx} ${cy - r}`,
  `C ${cx + K * r} ${cy - r} ${cx + r} ${cy - K * r} ${cx + r} ${cy}`,
  'Z',
].join(' ');

async function build() {
  const doc = await PDFDocument.create();
  doc.setTitle('Smart fill tag sheet (made up)');
  doc.setCreator('Survey debug/smart-fill/make-tag-sheet.mjs');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const { width: W, height: H } = TAG_SHEET;
  const page = doc.addPage([W, H]);
  const ink = rgb(0, 0, 0);
  // SVG paths in drawSvgPath are y-down from (x, y): anchor at the top-left
  // corner so every number below is in page units, y down.
  const path = (d, width = 0.6) => page.drawSvgPath(d, { x: 0, y: H, borderColor: ink, borderWidth: width });
  const line = (x0, y0, x1, y1, width = 0.6) => path(`M ${x0} ${y0} L ${x1} ${y1}`, width);
  const text = (s, x, y, size) => page.drawText(s, { x, y: H - y, size, font, color: ink });

  let n = 0;
  const tag = (cx, cy) => {
    n += 1;
    const r = TAG_SHEET.diameter / 2;
    path(circlePath(cx, cy, r));
    line(cx - r, cy, cx + r, cy, 0.4);
    const id = `310H-F03-C${String(n).padStart(2, '0')}`;
    text(id, cx - 7.6, cy - 2.2, 2.2);
    text(`P${n}`, cx - 2.5, cy + 6, 4);
  };
  const centre = ([x0, y0, x1, y1]) => [(x0 + x1) / 2, (y0 + y1) / 2];

  // Sheet frame and a room.
  path(`M 20 20 L ${W - 20} 20 L ${W - 20} ${H - 20} L 20 ${H - 20} Z`, 1.2);
  line(60, 440, 420, 440, 1.5);
  line(60, 620, 420, 620, 1.5);
  line(60, 440, 60, 620, 1.5);
  line(420, 440, 420, 620, 1.5);

  // A tag flush against a wall, with a leader line out of it.
  const [wx, wy] = centre(TAG_SHEET.tags['touches a wall']);
  line(TAG_SHEET.tags['touches a wall'][0], 440, TAG_SHEET.tags['touches a wall'][0], 620, 1.5);
  tag(wx, wy);
  line(wx + 10.1, wy, wx + 60, wy - 30);

  // Two tags that overlap.
  const [ox, oy] = centre(TAG_SHEET.tags['overlaps the next tag']);
  tag(ox, oy);
  tag(ox + 15, oy);

  // Two tags flush against each other.
  const [tx, ty] = centre(TAG_SHEET.tags['touches the next tag']);
  tag(tx, ty);
  tag(tx + TAG_SHEET.diameter, ty);
  line(tx - 10.1, ty, 60, ty);

  // A grid of the same tag (Find more), the first one the teach target.
  const [gx, gy] = centre(TAG_SHEET.teach);
  for (let i = 0; i < TAG_SHEET.gridCount; i += 1) {
    tag(gx + (i % 8) * 60, gy + Math.floor(i / 8) * 80);
  }
  // The revision cloud: one path per scallop, each starting where the last
  // one ended, like the Schneider sets draw them.
  const [c0, c1, c2, c3] = TAG_SHEET.cloud;
  const corners = [[c0, c1], [c2, c1], [c2, c3], [c0, c3]];
  const normals = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (let side = 0; side < 4; side += 1) {
    const [ax, ay] = corners[side];
    const [bx, by] = corners[(side + 1) % 4];
    const [nx, ny] = normals[side];
    const len = Math.hypot(bx - ax, by - ay);
    const count = Math.max(2, Math.round(len / 20));
    for (let i = 0; i < count; i += 1) {
      const px = ax + ((bx - ax) * i) / count; const py = ay + ((by - ay) * i) / count;
      const qx = ax + ((bx - ax) * (i + 1)) / count; const qy = ay + ((by - ay) * (i + 1)) / count;
      path(`M ${px} ${py} C ${px + nx * 5.3} ${py + ny * 5.3} ${qx + nx * 5.3} ${qy + ny * 5.3} ${qx} ${qy}`);
    }
  }
  const [ix, iy] = centre(TAG_SHEET.cloudTag);
  tag(ix, iy);
  return doc.save({ useObjectStreams: false });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bytes = await build();
  writeFileSync(TAG_SHEET.file, bytes);
  console.log(`wrote ${TAG_SHEET.file} (${bytes.length} bytes)`);
}
