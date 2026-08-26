export function toUint8Array(bytesLike) {
  if (!bytesLike) return null;
  if (bytesLike instanceof Uint8Array) return bytesLike;
  if (bytesLike instanceof ArrayBuffer) return new Uint8Array(bytesLike);
  if (ArrayBuffer.isView(bytesLike)) {
    return new Uint8Array(bytesLike.buffer, bytesLike.byteOffset, bytesLike.byteLength);
  }
  return null;
}

export function readPdfLibNumber(value) {
  if (!value) return null;
  try {
    if (typeof value.asNumber === 'function') {
      const numeric = value.asNumber();
      return Number.isFinite(numeric) ? numeric : null;
    }
  } catch {
    // Fall through to string coercion.
  }
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function readPdfLibNumberArray(value) {
  if (!value || typeof value.asArray !== 'function') return null;
  const values = value.asArray();
  if (!Array.isArray(values) || values.length === 0) return null;
  const numbers = values.map(readPdfLibNumber).filter(Number.isFinite);
  return numbers.length === values.length ? numbers : null;
}

export function readPdfLibText(value) {
  if (!value) return null;
  try {
    if (typeof value.decodeText === 'function') {
      const decoded = value.decodeText();
      return typeof decoded === 'string' && decoded.length > 0 ? decoded : null;
    }
  } catch {
    // Fall through to string coercion.
  }
  const text = String(value || '').trim();
  return text.length > 0 ? text : null;
}

export function normalizePdfNameToken(rawName) {
  if (typeof rawName !== 'string') return null;
  const trimmed = rawName.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
}

export function readPdfLibNameArray(value) {
  if (!value) return null;
  if (typeof value.asArray === 'function') {
    const values = value.asArray();
    if (!Array.isArray(values) || values.length === 0) return null;
    const names = values.map((item) => normalizePdfNameToken(readPdfLibText(item))).filter(Boolean);
    return names.length === values.length ? names : null;
  }
  // se011 4631R writes FreeTextCallout /LE as a single name (/OpenArrow),
  // not an array. Dropping that leftover-defaulted the callout head to
  // solidTriangle until Arrowhead was re-touched.
  const single = normalizePdfNameToken(readPdfLibText(value));
  return single ? [single] : null;
}

export function readPdfLibDashArray(value) {
  if (!value || typeof value.asArray !== 'function') return null;
  const values = value.asArray();
  if (!Array.isArray(values) || values.length === 0) return null;
  const first = values[0];
  if (first && typeof first.asArray === 'function') return readPdfLibNumberArray(first);
  const numbers = values.map(readPdfLibNumber).filter(Number.isFinite);
  return numbers.length === values.length ? numbers : null;
}

export function normalizePdfLineEndings(lineEndings) {
  if (!lineEndings) return null;
  const raw = Array.isArray(lineEndings) ? lineEndings : [lineEndings];
  const normalized = raw
    .map((ending) => normalizePdfNameToken(typeof ending === 'string' ? ending : String(ending || '')))
    .filter(Boolean);
  if (normalized.length === 0) return null;
  if (normalized.length === 1) return [normalized[0], 'None'];
  return [normalized[0], normalized[1]];
}
