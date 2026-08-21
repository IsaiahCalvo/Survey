/** Shared hex gate for CompactColorPicker (and any future picker). */
export const isValidPickerHex = (value) => /^#?[0-9a-fA-F]{6}$/.test(String(value || '').trim());
