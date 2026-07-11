const positiveNumber = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

export function eraserDiameterToPageRadius(
  diameter,
) {
  return positiveNumber(diameter, 1) / 2;
}
