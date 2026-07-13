// Pure serialization helpers for the top-level ErrorBoundary.
//
// A value thrown into React's render/effect tree is not guaranteed to be an
// Error. A non-Error (e.g. a Supabase-style `{ message, code, details }`, a bare
// object, an array, a string) would otherwise log as "[object Object]" and land
// in the fallback UI just as opaquely. These helpers make any thrown value
// diagnosable. Kept in a plain .js module (no JSX) so they are unit-testable
// under `node --test`.
//
// CRITICAL: these run INSIDE the boundary's own componentDidCatch AND its
// fallback render. They must NEVER throw — a hostile thrown value (a
// null-prototype object, a getter that throws, a `toString`/`Symbol.toPrimitive`
// that throws) would otherwise make the boundary's own render throw and blank
// the entire app, which is the exact failure the boundary exists to prevent.
// Every property read and coercion below is therefore defensive.

// Coerce anything to a string without ever throwing (String() throws for a
// null-prototype object or a throwing toString/Symbol.toPrimitive).
const safeString = (value) => {
  try {
    return String(value);
  } catch {
    try {
      return Object.prototype.toString.call(value); // e.g. "[object Object]" — never throws
    } catch {
      return '<unserializable value>';
    }
  }
};

// Read one property without ever throwing (defends against throwing getters).
const safeGet = (obj, key) => {
  try {
    return obj[key];
  } catch {
    return undefined;
  }
};

// Best-effort JSON of a thrown value's own enumerable fields.
export const enumerableFieldsOf = (value) => {
  try {
    const json = JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? String(v) : v));
    return json && json !== '{}' ? json : null;
  } catch {
    return null; // circular, throwing getter, or otherwise unstringifiable
  }
};

// Structured form for `console.error` logging. Never throws.
export const serializeErrorForLog = (error) => {
  try {
    if (!error || typeof error !== 'object') {
      return { message: safeString(error) };
    }
    if (error instanceof Error) {
      const cause = safeGet(error, 'cause');
      return {
        name: safeGet(error, 'name') || null,
        message: safeGet(error, 'message') || safeString(error),
        stack: safeGet(error, 'stack') || null,
        cause: cause
          ? {
              name: safeGet(cause, 'name') || null,
              message: safeGet(cause, 'message') || safeString(cause),
              stack: safeGet(cause, 'stack') || null,
            }
          : null,
      };
    }
    // A non-Error object (or array): report its constructor + enumerable fields
    // instead of the useless "[object Object]".
    const ctor = safeGet(error, 'constructor');
    const msg = safeGet(error, 'message');
    return {
      name: (ctor && safeGet(ctor, 'name')) || (Array.isArray(error) ? 'Array' : 'Object'),
      message: typeof msg === 'string' ? msg : null,
      thrownValue: enumerableFieldsOf(error) || safeString(error),
      stack: typeof safeGet(error, 'stack') === 'string' ? error.stack : null,
    };
  } catch {
    // Last-resort: even the defensive reads above should not throw, but never
    // let this function bring down the boundary.
    return { message: safeString(error) };
  }
};

// Human-readable one-liner for the fallback UI's <pre>. Never throws.
export const formatErrorForDisplay = (error) => {
  try {
    if (error instanceof Error) return error.toString();
  } catch {
    /* throwing toString → fall through to the serialized form */
  }
  const s = serializeErrorForLog(error);
  return [s.name, s.message, s.thrownValue].filter(Boolean).join(': ') || safeString(error);
};
