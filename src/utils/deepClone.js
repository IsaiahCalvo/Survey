// Canonical deep clone: structuredClone first (preserves Dates/undefined, handles
// cycles), JSON fallback for values it rejects (e.g. functions get stripped), null
// if neither works. For plain (DB-serializable) POJOs structuredClone === the JSON
// round-trip. Standalone + zero-dep on purpose so node-tested pure utils can import
// it without pulling in viewerShared's browser dependency graph.
export const deepClone = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // fall through to JSON clone
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
};
