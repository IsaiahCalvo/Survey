// supabase/functions/_shared/inputSchema.js
//
// A small schema check for edge-function request bodies, in the spirit of zod
// but with no dependency: plain JS with no Deno APIs, so node tests import it
// and every function can share it without an import map.
//
// Rules: a body must be a JSON object; each listed field must have the right
// type and stay within its size limit; fields not listed are dropped, so a
// handler only ever sees what its schema names. A failed check gives one
// short reason (`<field>: <problem>`) the function returns as a 400.

const fail = (reason) => ({ ok: false, error: reason });

export const s = {
  /** @param {{max?: number, min?: number, pattern?: RegExp | null, optional?: boolean}} [o] */
  string: ({ max = 1000, min = 0, pattern = null, optional = false } = {}) => ({ kind: 'string', max, min, pattern, optional }),
  enum: (values, { optional = false } = {}) => ({ kind: 'enum', values, optional }),
  boolean: ({ optional = false } = {}) => ({ kind: 'boolean', optional }),
  integer: ({ min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) => ({ kind: 'integer', min, max, optional }),
  array: (item, { max = 100, optional = false } = {}) => ({ kind: 'array', item, max, optional }),
  // Any JSON object, checked only for size; the handler validates its inside.
  record: ({ maxBytes = 64 * 1024, optional = false } = {}) => ({ kind: 'record', maxBytes, optional }),
  // Any JSON value, checked only for size.
  any: ({ maxBytes = 64 * 1024, optional = true } = {}) => ({ kind: 'any', maxBytes, optional }),
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const byteSize = (v) => {
  try { return new TextEncoder().encode(JSON.stringify(v) ?? '').length; } catch { return Infinity; }
};

function check(spec, value, path) {
  if (value === undefined || value === null) {
    return spec.optional ? { ok: true, value: undefined } : fail(`${path}: required`);
  }
  switch (spec.kind) {
    case 'string':
      if (typeof value !== 'string') return fail(`${path}: must be a string`);
      if (value.length > spec.max) return fail(`${path}: too long`);
      if (value.length < spec.min) return fail(`${path}: too short`);
      if (spec.pattern && !spec.pattern.test(value)) return fail(`${path}: bad format`);
      return { ok: true, value };
    case 'enum':
      return spec.values.includes(value) ? { ok: true, value } : fail(`${path}: not allowed`);
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true, value } : fail(`${path}: must be true or false`);
    case 'integer':
      if (!Number.isInteger(value)) return fail(`${path}: must be a whole number`);
      if (value < spec.min || value > spec.max) return fail(`${path}: out of range`);
      return { ok: true, value };
    case 'array': {
      if (!Array.isArray(value)) return fail(`${path}: must be a list`);
      if (value.length > spec.max) return fail(`${path}: too many items`);
      const out = [];
      for (let i = 0; i < value.length; i += 1) {
        const r = check(spec.item, value[i], `${path}[${i}]`);
        if (!r.ok) return r;
        out.push(r.value);
      }
      return { ok: true, value: out };
    }
    case 'record':
      if (!isPlainObject(value)) return fail(`${path}: must be an object`);
      if (byteSize(value) > spec.maxBytes) return fail(`${path}: too large`);
      return { ok: true, value };
    case 'any':
      if (byteSize(value) > spec.maxBytes) return fail(`${path}: too large`);
      return { ok: true, value };
    default:
      return fail(`${path}: unknown schema`);
  }
}

/**
 * Check a parsed body against `{ field: spec }`.
 * @returns {{ok: true, value: Record<string, unknown>} | {ok: false, error: string}}
 */
export function parseBody(shape, body) {
  if (!isPlainObject(body)) return fail('body: must be a JSON object');
  const value = {};
  for (const [key, spec] of Object.entries(shape)) {
    const r = check(spec, body[key], key);
    if (!r.ok) return r;
    if (r.value !== undefined) value[key] = r.value;
  }
  return { ok: true, value };
}

/** Read a request's JSON body; a missing or broken body reads as `{}`. */
export async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body ?? {};
  } catch {
    return {};
  }
}
