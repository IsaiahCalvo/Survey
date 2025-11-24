export const polygonContainsPoint = (x, y, coords, scaleFactor = 1) => {
  if (!Array.isArray(coords) || coords.length < 6) {
    return false;
  }

  let inside = false;
  for (let i = 0, j = coords.length - 2; i < coords.length; i += 2) {
    const xi = coords[i] * scaleFactor;
    const yi = coords[i + 1] * scaleFactor;
    const xj = coords[j] * scaleFactor;
    const yj = coords[j + 1] * scaleFactor;

    const denominator = (yj - yi) || 1e-6;
    const intersects =
      ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / denominator + xi);

    if (intersects) {
      inside = !inside;
    }

    j = i;
  }

  return inside;
};

export const rectangleContainsPoint = (x, y, coords, scaleFactor = 1) => {
  if (!Array.isArray(coords) || coords.length < 8) {
    return false;
  }

  const xs = [coords[0], coords[2], coords[4], coords[6]].map(val => val * scaleFactor);
  const ys = [coords[1], coords[3], coords[5], coords[7]].map(val => val * scaleFactor);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return x >= minX && x <= maxX && y >= minY && y <= maxY;
};

export const regionContainsPoint = (x, y, region, scaleFactor = 1) => {
  if (!region || !Array.isArray(region.coordinates)) {
    return false;
  }

  if (region.shapeType === 'rectangular') {
    return rectangleContainsPoint(x, y, region.coordinates, scaleFactor);
  }

  return polygonContainsPoint(x, y, region.coordinates, scaleFactor);
};

