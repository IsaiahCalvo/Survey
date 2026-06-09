const finiteNumberOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

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

  return String(a?.id || '').localeCompare(String(b?.id || ''));
};
