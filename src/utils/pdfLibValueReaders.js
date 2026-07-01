// pdf-lib PDFObject value readers, lifted verbatim out of pdfAnnotationImporter.js
// (de-fragilize campaign). Each safely coerces a pdf-lib value (which exposes
// asNumber()/asArray()/decodeText()) into a plain JS number/array/string, returning
// null when the value is missing or malformed. Pure + self-contained (the readers
// only call each other), so node-testable in isolation.

export function toUint8Array(bytesLike) {
  if (!bytesLike) return null;

  if (bytesLike instanceof Uint8Array) {
    return bytesLike;
  }

  if (bytesLike instanceof ArrayBuffer) {
    return new Uint8Array(bytesLike);
  }

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
    // ignore and fall back
  }

  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function readPdfLibNumberArray(value) {
  if (!value || typeof value.asArray !== 'function') return null;

  const arr = value.asArray();
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const numbers = arr
    .map((item) => readPdfLibNumber(item))
    .filter((item) => Number.isFinite(item));

  return numbers.length === arr.length ? numbers : null;
}

export function readPdfLibText(value) {
  if (!value) return null;

  try {
    if (typeof value.decodeText === 'function') {
      const decoded = value.decodeText();
      return typeof decoded === 'string' && decoded.length > 0 ? decoded : null;
    }
  } catch {
    // ignore and fall back
  }

  const str = String(value || '').trim();
  return str.length > 0 ? str : null;
}

export function normalizePdfNameToken(rawName) {
  if (typeof rawName !== 'string') return null;
  const trimmed = rawName.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
}

export function readPdfLibNameArray(value) {
  if (!value || typeof value.asArray !== 'function') return null;

  const arr = value.asArray();
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const names = arr
    .map((item) => normalizePdfNameToken(readPdfLibText(item)))
    .filter(Boolean);

  return names.length === arr.length ? names : null;
}

export function readPdfLibDashArray(value) {
  if (!value || typeof value.asArray !== 'function') return null;

  const arr = value.asArray();
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const first = arr[0];
  if (first && typeof first.asArray === 'function') {
    return readPdfLibNumberArray(first);
  }

  const numbers = arr
    .map((item) => readPdfLibNumber(item))
    .filter((item) => Number.isFinite(item));

  return numbers.length === arr.length ? numbers : null;
}

export function normalizePdfLineEndings(lineEndings) {
  if (!lineEndings) return null;

  const raw = Array.isArray(lineEndings) ? lineEndings : [lineEndings];
  const normalized = raw
    .map((ending) => normalizePdfNameToken(typeof ending === 'string' ? ending : String(ending || '')))
    .filter(Boolean);

  if (normalized.length === 0) return null;
  if (normalized.length === 1) {
    return [normalized[0], 'None'];
  }

  return [normalized[0], normalized[1]];
}
