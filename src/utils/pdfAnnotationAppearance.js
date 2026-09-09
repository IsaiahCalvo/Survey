import { cloudRuns, makeShape } from './revisionCloudGeometry.js';

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export function cloudRadiusForIntensity(intensity = 2, strokeWidth = 1, unitScale = 1) {
  const scale = Math.max(0.01, finite(unitScale, 1));
  const level = Math.max(0.25, finite(intensity, 2));
  const size = Math.min(80 * scale, Math.max(14 * level * scale, 4 * Math.max(1, finite(strokeWidth, 1))));
  return size / 2;
}

// This is the sole app entry point for revision-cloud outlines. The approved
// engine emits separate open crowns so its short rounded tails stay intact.
export function buildCloudPathCommands(
  points,
  intensity = 2,
  strokeWidth = 1,
  unitScale = 1,
  kind = 'polygon',
) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const clean = points.map((point) => ({ x: finite(point?.x), y: finite(point?.y) }));
  if (clean.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const size = cloudRadiusForIntensity(intensity, strokeWidth, unitScale) * 2;
  const shape = makeShape(kind === 'rectangle' ? 'rectangle' : 'polygon', clean, 'survey-cloud', {
    size,
    depth: size * (12 / 28),
    stroke: Math.max(0.1, finite(strokeWidth, 1)),
  });
  const commands = cloudRuns(shape, new Map(), 0, false).flatMap((run) => run.lobes.flatMap((lobe) => {
    const curves = [];
    for (let index = 0; index + 2 < lobe.controls.length; index += 3) {
      curves.push([
        'C',
        lobe.controls[index].x,
        lobe.controls[index].y,
        lobe.controls[index + 1].x,
        lobe.controls[index + 1].y,
        lobe.controls[index + 2].x,
        lobe.controls[index + 2].y,
      ]);
    }
    return [['M', lobe.start.x, lobe.start.y], ...curves];
  }));
  return commands.length > 0 ? commands : null;
}

const cubicAt = (start, c1, c2, end, t) => {
  const mt = 1 - t;
  return mt ** 3 * start + 3 * mt ** 2 * t * c1 + 3 * mt * t ** 2 * c2 + t ** 3 * end;
};

export function getCloudPathBounds(commands) {
  if (!Array.isArray(commands)) return null;
  let cursor = null;
  const points = [];
  for (const command of commands) {
    if (command[0] === 'M') {
      cursor = { x: command[1], y: command[2] };
      points.push(cursor);
    } else if (command[0] === 'C' && cursor) {
      const end = { x: command[5], y: command[6] };
      for (let step = 1; step <= 100; step += 1) {
        const t = step / 100;
        points.push({
          x: cubicAt(cursor.x, command[1], command[3], end.x, t),
          y: cubicAt(cursor.y, command[2], command[4], end.y, t),
        });
      }
      cursor = end;
    }
  }
  if (points.length === 0) return null;
  const round = (value) => {
    const rounded = Math.round(value * 1e6) / 1e6;
    return Object.is(rounded, -0) ? 0 : rounded;
  };
  return {
    minX: round(Math.min(...points.map((point) => point.x))),
    minY: round(Math.min(...points.map((point) => point.y))),
    maxX: round(Math.max(...points.map((point) => point.x))),
    maxY: round(Math.max(...points.map((point) => point.y))),
  };
}

export function buildStickyNoteGlyphSpec({ width, height, left = 0, top = 0 } = {}) {
  const w = Math.max(1, finite(width, 20));
  const h = Math.max(1, finite(height, 20));
  const size = Math.min(w, h);
  const inset = Math.max(0.5, size * 0.04);
  const radius = Math.max(1.5, size * 0.18);
  const bodyBottom = top + h * 0.76;
  const x0 = left + inset;
  const y0 = top + inset;
  const x1 = left + w - inset;
  const tailLeft = left + w * 0.24;
  const tailRight = left + w * 0.46;
  const bubblePath = [
    `M ${x0 + radius} ${y0}`,
    `L ${x1 - radius} ${y0}`,
    `Q ${x1} ${y0} ${x1} ${y0 + radius}`,
    `L ${x1} ${bodyBottom - radius}`,
    `Q ${x1} ${bodyBottom} ${x1 - radius} ${bodyBottom}`,
    `L ${tailRight} ${bodyBottom}`,
    `L ${tailLeft} ${top + h}`,
    `L ${tailLeft} ${bodyBottom}`,
    `L ${x0 + radius} ${bodyBottom}`,
    `Q ${x0} ${bodyBottom} ${x0} ${bodyBottom - radius}`,
    `L ${x0} ${y0 + radius}`,
    `Q ${x0} ${y0} ${x0 + radius} ${y0}`,
    'Z',
  ].join(' ');
  const lineStart = left + w * 0.25;
  return {
    bubblePath,
    textLines: [0.31, 0.46, 0.61].map((ratio, index) => ({
      x1: lineStart,
      y1: top + h * ratio,
      x2: left + w * (index === 2 ? 0.62 : 0.75),
      y2: top + h * ratio,
    })),
  };
}

export function stickyNoteOutlineColor(value) {
  const text = String(value || '').trim();
  const hex = text.match(/^#([0-9a-f]{6})$/i)?.[1];
  const rgbMatch = text.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  const channels = hex
    ? [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((part) => parseInt(part, 16))
    : rgbMatch?.slice(1, 4).map(Number);
  if (!channels?.every(Number.isFinite)) return 'rgba(65, 57, 12, 0.78)';
  const darker = channels.map((channel) => Math.max(0, Math.min(255, Math.round(channel * 0.48))));
  return `rgba(${darker[0]}, ${darker[1]}, ${darker[2]}, 0.78)`;
}

export function isStickyNoteGlyphObject(obj) {
  return obj?.data?.type === 'note'
    && (obj?.data?.pdfNoteGlyph === 'note' || obj?.pdfAnnotationType === 'Text');
}
