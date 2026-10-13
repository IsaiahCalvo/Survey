// A real supabase-js client whose every request is answered by a FakeBackend
// (tp-fake-backend.mjs) in this same Node process — no browser, no network,
// no real database. Lets unit tests drive app service code (which takes a
// Supabase client) against the same in-memory stand-in and row-level rules the
// Playwright test-plan specs use.
//
//   const backend = new FakeBackend({ documentId, ownerId: 'owner-a', storage: true });
//   const asEditor = createFakeSupabaseClient(backend, { userId: 'editor-b' });
//   await asEditor.from('document_annotations').delete().eq(...)
//
// The FakeBackend answers Playwright `route` objects; this file builds the same
// small route shape around a fetch Request.

import { createClient } from '@supabase/supabase-js';

export function createFakeSupabaseClient(backend, { userId = null } = {}) {
  const caller = userId || backend.ownerId;
  const fakeFetch = async (input, init = {}) => {
    const request = new Request(input, init);
    const hasBody = !['GET', 'HEAD'].includes(request.method);
    const body = hasBody ? Buffer.from(await request.arrayBuffer()) : null;
    const headers = Object.fromEntries(request.headers.entries());
    let response = null;
    const route = {
      request: () => ({
        url: () => request.url,
        method: () => request.method,
        headers: () => headers,
        postData: () => (body ? body.toString('utf8') : null),
        postDataBuffer: () => body,
      }),
      fulfill: async ({ status = 200, headers: replyHeaders = {}, contentType, body: replyBody }) => {
        const nullBody = status === 204 || status === 304;
        response = new Response(nullBody ? null : (replyBody ?? ''), {
          status,
          headers: { ...replyHeaders, ...(contentType ? { 'content-type': contentType } : {}) },
        });
      },
      abort: async () => { response = Response.error(); },
    };
    await backend.handleRest(route, caller);
    if (!response) throw new Error(`fake backend did not answer ${request.method} ${request.url}`);
    return response;
  };
  return createClient('https://fake-test-plan.supabase.co', 'fake-anon-key', {
    global: { fetch: fakeFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
