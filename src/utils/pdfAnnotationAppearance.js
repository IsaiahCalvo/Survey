const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const pointAt = (point, unit, distance) => ({
  x: point.x + unit.x * distance,
  y: point.y + unit.y * distance,
});

const CLOUD_RADIUS_BY_INTENSITY = [4, 7, 10];

export function cloudRadiusForIntensity(intensity = 2, strokeWidth = 1, unitScale = 1) {
  const level = Math.max(0, Math.min(2, finite(intensity, 2)));
  const low = Math.floor(level);
  const high = Math.ceil(level);
  const base = CLOUD_RADIUS_BY_INTENSITY[low]
    + (CLOUD_RADIUS_BY_INTENSITY[high] - CLOUD_RADIUS_BY_INTENSITY[low]) * (level - low);
  return Math.max(base * Math.max(0.01, finite(unitScale, 1)), 2 * Math.max(1, finite(strokeWidth, 1)));
}

// Build round revision-cloud lobes on the source edges. Each edge keeps its
// own endpoints; only the curve bows out. A separate curve rounds each corner.
export function buildCloudPathCommands(points, intensity = 2, strokeWidth = 1, unitScale = 1) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const clean = points.map((point) => ({ x: finite(point?.x), y: finite(point?.y) }));
  const radius = cloudRadiusForIntensity(intensity, strokeWidth, unitScale);

  let signedArea = 0;
  for (let index = 0; index < clean.length; index += 1) {
    const current = clean[index];
    const next = clean[(index + 1) % clean.length];
    signedArea += current.x * next.y - next.x * current.y;
  }
  const clockwise = signedArea > 0; // screen coordinates use a downward Y axis
  const outwardFor = (unit) => clockwise
    ? { x: unit.y, y: -unit.x }
    : { x: -unit.y, y: unit.x };

  const edges = clean.map((start, index) => {
    const end = clean[(index + 1) % clean.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.1) return null;
    const unit = { x: dx / length, y: dy / length };
    return { start, end, length, unit, outward: outwardFor(unit) };
  });
  if (edges.some((edge) => !edge)) return null;

  const commands = [];
  const firstInset = Math.min(radius, edges[0].length / 3);
  const first = pointAt(edges[0].start, edges[0].unit, firstInset);
  commands.push(['M', first.x, first.y]);

  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    const nextEdge = edges[(index + 1) % edges.length];
    const startInset = Math.min(radius, edge.length / 3);
    const endInset = Math.min(radius, edge.length / 3);
    const edgeStart = pointAt(edge.start, edge.unit, startInset);
    const edgeEnd = pointAt(edge.end, edge.unit, -endInset);
    const usable = Math.max(0, edge.length - startInset - endInset);
    const lobeCount = Math.max(1, Math.ceil(usable / (1.6 * radius)));
    const span = usable / lobeCount;
    const height = radius;
    const control = height * 4 / 3;

    for (let lobe = 0; lobe < lobeCount; lobe += 1) {
      const start = pointAt(edgeStart, edge.unit, span * lobe);
      const end = pointAt(edgeStart, edge.unit, span * (lobe + 1));
      commands.push([
        'C',
        start.x + edge.outward.x * control,
        start.y + edge.outward.y * control,
        end.x + edge.outward.x * control,
        end.y + edge.outward.y * control,
        end.x,
        end.y,
      ]);
    }

    const nextInset = Math.min(radius, nextEdge.length / 3);
    const cornerEnd = pointAt(nextEdge.start, nextEdge.unit, nextInset);
    const bisectorLength = Math.hypot(
      edge.outward.x + nextEdge.outward.x,
      edge.outward.y + nextEdge.outward.y,
    );
    const bisector = bisectorLength > 0.01
      ? {
          x: (edge.outward.x + nextEdge.outward.x) / bisectorLength,
          y: (edge.outward.y + nextEdge.outward.y) / bisectorLength,
        }
      : edge.outward;
    const cornerDistance = radius / Math.max(0.25, Math.abs(
      bisector.x * edge.outward.x + bisector.y * edge.outward.y,
    ));
    const apex = {
      x: edge.end.x + bisector.x * cornerDistance,
      y: edge.end.y + bisector.y * cornerDistance,
    };
    // One cubic makes one corner lobe. Equal control points force its midpoint
    // through the outside offset apex while its ends stay on the two edges.
    const cornerControl = {
      x: (apex.x - 0.125 * (edgeEnd.x + cornerEnd.x)) / 0.75,
      y: (apex.y - 0.125 * (edgeEnd.y + cornerEnd.y)) / 0.75,
    };
    commands.push([
      'C',
      cornerControl.x,
      cornerControl.y,
      cornerControl.x,
      cornerControl.y,
      cornerEnd.x,
      cornerEnd.y,
    ]);
  }
  commands.push(['Z']);
  return commands;
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
