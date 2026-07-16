export const escapeCSVValue = (value) => {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (stringValue === '') return '';
  const escaped = stringValue.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
};
