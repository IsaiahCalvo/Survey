// Small readers that turn pdf-lib objects into plain JS values (KAL-393).
// Every reader tolerates a missing or wrong-typed entry and returns null, so a
// quirky annotation dict never stops the whole XFDF export.

import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from 'pdf-lib';

export function lookup(context, dict, key) {
  if (!dict?.get) return null;
  let value = dict.get(PDFName.of(key));
  if (value instanceof PDFRef) value = context.lookup(value);
  return value ?? null;
}

export function toPlain(context, value, depth = 0) {
  if (value == null || depth > 4) return null;
  if (value instanceof PDFRef) return toPlain(context, context.lookup(value), depth + 1);
  if (value instanceof PDFNumber) return value.asNumber();
  if (value instanceof PDFBool) return value.asBoolean();
  if (value instanceof PDFName) return value.decodeText();
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  if (value instanceof PDFArray) return value.asArray().map((item) => toPlain(context, item, depth + 1));
  if (value instanceof PDFDict) return value;
  return null;
}

export function readText(context, dict, key) {
  const value = toPlain(context, lookup(context, dict, key));
  return typeof value === 'string' ? value : null;
}

export function readName(context, dict, key) {
  const value = lookup(context, dict, key);
  return value instanceof PDFName ? value.decodeText() : null;
}

export function readNumber(context, dict, key) {
  const value = toPlain(context, lookup(context, dict, key));
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readNumbers(context, dict, key) {
  const value = toPlain(context, lookup(context, dict, key));
  if (!Array.isArray(value)) return null;
  const numbers = value.filter((n) => typeof n === 'number' && Number.isFinite(n));
  return numbers.length === value.length ? numbers : null;
}

// /InkList is an array of arrays.
export function readNumberLists(context, dict, key) {
  const value = toPlain(context, lookup(context, dict, key));
  if (!Array.isArray(value)) return null;
  return value
    .filter(Array.isArray)
    .map((list) => list.filter((n) => typeof n === 'number' && Number.isFinite(n)))
    .filter((list) => list.length >= 2);
}

export function readNames(context, dict, key) {
  const value = toPlain(context, lookup(context, dict, key));
  if (!Array.isArray(value)) return null;
  return value.map((item) => (typeof item === 'string' ? item : 'None'));
}

export function readDict(context, dict, key) {
  const value = lookup(context, dict, key);
  return value instanceof PDFDict ? value : null;
}

// A stable key for an /Annots entry: the object number for an indirect
// annotation, the serialized dict for a direct one.
export function annotEntryKey(entry) {
  if (entry instanceof PDFRef) return `ref:${entry.objectNumber}:${entry.generationNumber}`;
  return `direct:${entry?.toString?.() ?? ''}`;
}

export function pageAnnotEntries(page) {
  const annots = page?.node?.lookup?.(PDFName.of('Annots'));
  return annots instanceof PDFArray ? annots.asArray() : [];
}
