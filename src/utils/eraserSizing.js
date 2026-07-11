const positiveNumber = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

export function eraserDiameterToScreenRadius(diameter, displayScale = 1) {
  return (positiveNumber(diameter, 1) * positiveNumber(displayScale, 1)) / 2;
}

export function eraserDiameterToPageRadius(
  diameter,
) {
  return positiveNumber(diameter, 1) / 2;
}
