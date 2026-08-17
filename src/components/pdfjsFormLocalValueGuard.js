export function shouldApplyPersistedFormValue(localDirtyValues, fieldId, persistedValue) {
  if (!(localDirtyValues instanceof Map) || fieldId == null) return true;
  const key = String(fieldId);
  if (!localDirtyValues.has(key)) return true;
  if (!Object.is(localDirtyValues.get(key), persistedValue)) return false;
  localDirtyValues.delete(key);
  return true;
}
