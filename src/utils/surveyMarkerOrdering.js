const finiteNumberOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const compareSurveyMarkersForOrder = (a, b) => {
  const aCustomOrder = finiteNumberOrNull(a?.surveyMarkerOrder);
  const bCustomOrder = finiteNumberOrNull(b?.surveyMarkerOrder);

  if (aCustomOrder != null || bCustomOrder != null) {
    if (aCustomOrder != null && bCustomOrder != null && aCustomOrder !== bCustomOrder) {
      return aCustomOrder - bCustomOrder;
    }
    if (aCustomOrder != null && bCustomOrder == null) return -1;
    if (aCustomOrder == null && bCustomOrder != null) return 1;
  }

  const aExcelOrder = finiteNumberOrNull(a?.excelRowIndex);
  const bExcelOrder = finiteNumberOrNull(b?.excelRowIndex);

  if (aExcelOrder != null || bExcelOrder != null) {
    if (aExcelOrder != null && bExcelOrder != null && aExcelOrder !== bExcelOrder) {
      return aExcelOrder - bExcelOrder;
    }
    if (aExcelOrder != null && bExcelOrder == null) return -1;
    if (aExcelOrder == null && bExcelOrder != null) return 1;
  }

  // No order of their own: by name, numbers counted as numbers, so new
  // markers read Camera 1, Camera 2, ... Camera 10 in the order they were
  // named, not in the order of their random ids.
  const byName = NAME_COLLATOR.compare(String(a?.name || '').trim(), String(b?.name || '').trim());
  if (byName !== 0) return byName;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
};
