/**
 * signaturePicture.js — a drawn or typed signature as a see-through PNG
 * (Nightly 'signature-tool'). The picture is drawn at 2x and trimmed to the
 * ink, so it lands tight around the signature.
 */
export const SIGNATURE_INKS = Object.freeze([
  { id: 'black', label: 'Black', hex: '#111111' },
  { id: 'blue', label: 'Blue', hex: '#1f3fbf' },
  { id: 'red', label: 'Red', hex: '#c62828' },
]);
export const SIGNATURE_WIDTHS = Object.freeze([
  { id: 'thin', label: 'Thin', px: 1.5 },
  { id: 'medium', label: 'Medium', px: 2.5 },
  { id: 'thick', label: 'Thick', px: 4 },
]);
// Typed styles. The picture is drawn once, so a font missing here only
// changes how this one looks when it is made.
export const SIGNATURE_FONTS = Object.freeze([
  { id: 'script', label: 'Script', css: "italic 400 {size}px 'Segoe Script', 'Snell Roundhand', 'Brush Script MT', cursive" },
  { id: 'serif', label: 'Serif', css: "italic 400 {size}px 'Times New Roman', Georgia, serif" },
  { id: 'plain', label: 'Plain', css: "400 {size}px Helvetica, Arial, sans-serif" },
]);
const PAD = 6;

/** The box around every pixel with ink (alpha > 8), or null when there is none. */
export function inkBounds(data, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** A canvas cut down to its ink (plus a little room) as { src, width, height } in CSS px; null when empty. */
export function trimmedPicture(canvas, scale = 2) {
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const b = inkBounds(data, canvas.width, canvas.height);
  if (!b) return null;
  const x = Math.max(0, b.x - PAD);
  const y = Math.max(0, b.y - PAD);
  const w = Math.min(canvas.width - x, b.w + PAD * 2);
  const h = Math.min(canvas.height - y, b.h + PAD * 2);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
  const src = out.toDataURL('image/png');
  out.width = 1;
  out.height = 1;
  return { src, width: Math.max(1, Math.round(w / scale)), height: Math.max(1, Math.round(h / scale)) };
}

/** Strokes ([[{x,y}...]...] in CSS px of a w x h pad) drawn in `ink` at `lineWidth`. */
export function drawnSignature(strokes, { width, height, ink, lineWidth, scale = 2 }) {
  if (!Array.isArray(strokes) || !strokes.some((s) => s?.length)) return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  paintStrokes(ctx, strokes, { ink, lineWidth });
  return trimmedPicture(canvas, scale);
}

/** The pad's own paint (the live pad and the saved picture draw the same way). */
export function paintStrokes(ctx, strokes, { ink, lineWidth }) {
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    if (!stroke?.length) continue;
    if (stroke.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke[0].x, stroke[0].y, lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length - 1; i += 1) {
      const mid = { x: (stroke[i].x + stroke[i + 1].x) / 2, y: (stroke[i].y + stroke[i + 1].y) / 2 };
      ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, mid.x, mid.y);
    }
    const last = stroke[stroke.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
}

export const fontCss = (fontId, size) => (SIGNATURE_FONTS.find((f) => f.id === fontId) || SIGNATURE_FONTS[0]).css.replace('{size}', String(size));

/** Typed text in one of the styles, as a trimmed picture; null for blank text. */
export function typedSignature(text, { fontId, ink, size = 44, scale = 2 }) {
  const value = String(text || '').trim();
  if (!value) return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = fontCss(fontId, size * scale);
  const w = Math.ceil(ctx.measureText(value).width + size * scale);
  canvas.width = Math.min(4000, Math.max(40, w));
  canvas.height = Math.ceil(size * scale * 1.8);
  const draw = canvas.getContext('2d');
  draw.font = fontCss(fontId, size * scale);
  draw.fillStyle = ink;
  draw.textBaseline = 'middle';
  draw.fillText(value, (size * scale) / 2, canvas.height / 2);
  return trimmedPicture(canvas, scale);
}
