// SQL bigint values cross JSON as decimal strings. Keep ordinary values as
// numbers for existing callers, but never round a database frontier or epoch.
const MAX = 9223372036854775807n;
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const invalid = () => Object.assign(new Error('Annotation sequence is outside its exact integer range'), {
  code: 'ANNOTATION_SEQUENCE_RANGE',
});
function integer(value) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) throw invalid();
  if (typeof value === 'string' && !/^(0|[1-9][0-9]*)$/.test(value)) throw invalid();
  if (!['number', 'string', 'bigint'].includes(typeof value)) throw invalid();
  const result = BigInt(value);
  if (result < 0n || result > MAX) throw invalid();
  return result;
}
export function normalizeAnnotationSequence(value, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  const result = integer(value);
  return result <= SAFE ? Number(result) : result.toString();
}
export function compareAnnotationSequences(left, right) {
  const a = integer(left), b = integer(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
export function nextAnnotationSequence(value) {
  return normalizeAnnotationSequence(integer(value) + 1n);
}
export function maxAnnotationSequence(...values) {
  if (!values.length) throw invalid();
  return normalizeAnnotationSequence(values.reduce((a, value) => {
    const b = integer(value);
    return a > b ? a : b;
  }, 0n));
}
export function annotationSequenceToSafeInteger(value) {
  const result = integer(value);
  if (result > SAFE) throw invalid();
  return Number(result);
}
