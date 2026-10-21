// Backend security and cost pass: every edge function checks its request body
// (types, sizes, allowed values) before it does any work.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

import { parseBody, s } from '../supabase/functions/_shared/inputSchema.js';

describe('parseBody', () => {
  it('keeps listed fields and drops the rest', () => {
    const out = parseBody({ a: s.string(), b: s.boolean({ optional: true }) }, { a: 'x', extra: 1 });
    assert.deepEqual(out, { ok: true, value: { a: 'x' } });
  });

  it('refuses a body that is not an object', () => {
    for (const body of [null, 'x', 3, []]) assert.equal(parseBody({}, body).ok, false);
  });

  it('checks types, lengths, patterns, enums and ranges', () => {
    const shape = {
      name: s.string({ max: 3, pattern: /^[a-z]+$/ }),
      tier: s.enum(['pro']),
      n: s.integer({ min: 1, max: 5 }),
      list: s.array(s.string({ max: 2 }), { max: 2 }),
    };
    const good = { name: 'abc', tier: 'pro', n: 2, list: ['a'] };
    assert.equal(parseBody(shape, good).ok, true);
    assert.match(parseBody(shape, { ...good, name: 'abcd' }).error, /^name: too long/);
    assert.match(parseBody(shape, { ...good, name: 'AB' }).error, /^name: bad format/);
    assert.match(parseBody(shape, { ...good, name: 5 }).error, /^name: must be a string/);
    assert.match(parseBody(shape, { ...good, tier: 'free' }).error, /^tier: not allowed/);
    assert.match(parseBody(shape, { ...good, n: 1.5 }).error, /^n: must be a whole number/);
    assert.match(parseBody(shape, { ...good, n: 9 }).error, /^n: out of range/);
    assert.match(parseBody(shape, { ...good, list: ['a', 'b', 'c'] }).error, /^list: too many items/);
    assert.match(parseBody(shape, { ...good, list: ['abc'] }).error, /^list\[0\]: too long/);
    assert.match(parseBody(shape, { tier: 'pro', n: 2, list: [] }).error, /^name: required/);
  });

  it('a string "true" is not a boolean', () => {
    assert.equal(parseBody({ dry_run: s.boolean({ optional: true }) }, { dry_run: 'true' }).ok, false);
  });

  it('caps the size of free-form objects', () => {
    const shape = { data: s.record({ maxBytes: 20 }) };
    assert.equal(parseBody(shape, { data: { a: 1 } }).ok, true);
    assert.match(parseBody(shape, { data: { a: 'x'.repeat(50) } }).error, /^data: too large/);
    assert.match(parseBody(shape, { data: [1] }).error, /^data: must be an object/);
  });
});

describe('wiring', () => {
  const dir = new URL('../supabase/functions/', import.meta.url);
  // stripe-webhook bodies are signature-checked by Stripe's SDK instead.
  const SKIP = new Set(['_shared', 'stripe-webhook']);
  const fns = readdirSync(dir).filter((d) => !SKIP.has(d) && existsSync(new URL(`${d}/index.ts`, dir)));

  it('every function that reads a body runs it through parseBody', () => {
    assert.ok(fns.length >= 11, fns.join(','));
    for (const fn of fns) {
      const src = readFileSync(new URL(`${fn}/index.ts`, dir), 'utf8');
      assert.match(src, /from '\.\.\/_shared\/inputSchema\.js'/, fn);
      assert.match(src, /parseBody\(/, fn);
    }
  });

  it('survey-mcp refuses oversized batches', () => {
    const src = readFileSync(new URL('survey-mcp/index.ts', dir), 'utf8');
    assert.match(src, /body\.length > MAX_BATCH/);
  });

  it('survey-mcp keeps a null JSON-RPC id (a request, not a notification)', () => {
    const src = readFileSync(new URL('survey-mcp/index.ts', dir), 'utf8');
    assert.match(src, /const id = raw\.id;/);
  });
});
