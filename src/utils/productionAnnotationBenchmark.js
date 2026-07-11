export const MAX_PRODUCTION_BENCHMARK_ANNOTATIONS_PER_PAGE = 2000;

const PALETTE = [
  'rgba(255,45,85,0.82)',
  'rgba(10,132,255,0.82)',
  'rgba(48,209,88,0.82)',
  'rgba(255,214,10,0.76)',
  'rgba(191,90,242,0.82)',
];

const createRandom = (seed) => {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

export function parseProductionBenchmarkConfig(search, pageCount) {
  const pages = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (pages === 0) return null;
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const requested = Math.floor(Number(params.get('annotationBenchmarkPerPage')) || 0);
  if (requested <= 0) return null;
  const perPage = Math.min(MAX_PRODUCTION_BENCHMARK_ANNOTATIONS_PER_PAGE, requested);
  return { perPage, pageCount: pages, total: perPage * pages };
}

export function createProductionBenchmarkPage({ pageNumber, count, width, height }) {
  const safePage = Math.max(1, Math.floor(Number(pageNumber) || 1));
  const safeCount = Math.max(0, Math.min(
    MAX_PRODUCTION_BENCHMARK_ANNOTATIONS_PER_PAGE,
    Math.floor(Number(count) || 0),
  ));
  const pageWidth = Math.max(1, Number(width) || 1);
  const pageHeight = Math.max(1, Number(height) || 1);
  const random = createRandom((0x9e3779b9 ^ (safePage * 2654435761)) >>> 0);
  const objects = new Array(safeCount);

  for (let index = 0; index < safeCount; index += 1) {
    const x = random() * pageWidth;
    const y = random() * pageHeight;
    const color = PALETTE[(index + safePage) % PALETTE.length];
    const data = { productionBenchmark: true };
    if (index % 3 === 0) {
      const size = 6 + random() * 22;
      objects[index] = {
        id: `production-benchmark-${safePage}-${index}`,
        type: 'rect',
        left: x,
        top: y,
        width: size,
        height: size,
        scaleX: 1,
        scaleY: 1,
        angle: 0,
        fill: color.replace('0.82', '0.42').replace('0.76', '0.42'),
        stroke: 'transparent',
        strokeWidth: 0,
        opacity: 1,
        data,
      };
      continue;
    }

    const path = [['M', x, y]];
    let currentX = x;
    let currentY = y;
    const segments = 3 + Math.floor(random() * 4);
    for (let segment = 0; segment < segments; segment += 1) {
      const nextX = Math.max(0, Math.min(pageWidth, currentX + (random() - 0.5) * 140));
      const nextY = Math.max(0, Math.min(pageHeight, currentY + (random() - 0.5) * 140));
      path.push([
        'C',
        currentX + (random() - 0.5) * 90,
        currentY + (random() - 0.5) * 90,
        nextX + (random() - 0.5) * 90,
        nextY + (random() - 0.5) * 90,
        nextX,
        nextY,
      ]);
      currentX = nextX;
      currentY = nextY;
    }
    objects[index] = {
      id: `production-benchmark-${safePage}-${index}`,
      type: 'path',
      path,
      left: 0,
      top: 0,
      width: pageWidth,
      height: pageHeight,
      pathOffset: { x: 0, y: 0 },
      scaleX: 1,
      scaleY: 1,
      angle: 0,
      fill: null,
      stroke: color,
      strokeWidth: 1.2 + random() * 1.6,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      opacity: 1,
      data,
    };
  }

  return objects;
}
