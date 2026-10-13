// Real supabase-js, from Node, against a FakeBackend (tp-fake-backend.mjs).
//
// The fake answers Playwright routes; this hands it each request supabase-js
// makes as a route-shaped object instead, so a plain `node --test` file can run
// the app's own Supabase code (PostgREST filters, RPC, Storage uploads and
// downloads) with no browser and no network:
//
//   const backend = new FakeBackend({ documentId, ownerId, storage: true });
//   const client = createNodeClient(backend);            // acts as ownerId
//   const other = createNodeClient(backend, { userId }); // acts as someone else

import { createClient } from '@supabase/supabase-js';

export const TP_SUPABASE_URL = 'https://tp-fake.supabase.co';

export function createNodeClient(backend, { userId = null } = {}) {
  const caller = userId || backend.ownerId;
  const fetchThroughBackend = async (input, init) => {
    const request = new Request(input, init);
    const body = ['GET', 'HEAD'].includes(request.method)
      ? null
      : Buffer.from(await request.arrayBuffer());
    const headers = Object.fromEntries(request.headers);
    return new Promise((resolve, reject) => {
      const route = {
        request: () => ({
          url: () => request.url,
          method: () => request.method,
          headers: () => headers,
          postData: () => (body ? body.toString('utf8') : null),
          postDataBuffer: () => body,
        }),
        fulfill: async ({ status = 200, headers: replyHeaders = {}, contentType, body: replyBody }) => {
          const out = new Headers(replyHeaders);
          if (contentType && !out.has('content-type')) out.set('content-type', contentType);
          const empty = status === 204 || request.method === 'HEAD';
          resolve(new Response(empty ? null : (replyBody ?? ''), { status, headers: out }));
        },
        abort: async () => reject(new TypeError('fetch failed (aborted by the fake backend)')),
      };
      backend.handleRest(route, caller).catch(reject);
    });
  };
  return createClient(TP_SUPABASE_URL, 'tp-fake-anon-key', {
    global: { fetch: fetchThroughBackend },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: -1 } },
  });
}
