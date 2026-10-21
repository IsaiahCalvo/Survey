// Serve edge functions for the signed-in E2E suite without the Supabase edge
// runtime (some sandboxes cannot start its container). Each function calls
// Deno.serve when imported; this collects those handlers and serves them all
// on one port, at /<name> and /functions/v1/<name>.
//   deno run -A scripts/e2e-serve-functions.ts delete-account export-account
// Needs SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
type Handler = (req: Request) => Response | Promise<Response>;

const handlers = new Map<string, Handler>();
const realServe = Deno.serve.bind(Deno);
const names = Deno.args.length ? Deno.args : ['delete-account', 'export-account'];

for (const name of names) {
  Object.defineProperty(Deno, 'serve', {
    configurable: true,
    value: (handler: Handler) => { handlers.set(name, handler); },
  });
  await import(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url).href);
}
Object.defineProperty(Deno, 'serve', { configurable: true, value: realServe });

const port = Number(Deno.env.get('E2E_FUNCTIONS_PORT') || 8000);
realServe({ port, hostname: '127.0.0.1' }, (req) => {
  const name = new URL(req.url).pathname.replace(/^\/(functions\/v1\/)?/, '').split('/')[0];
  const handler = handlers.get(name);
  return handler ? handler(req) : new Response('No such function', { status: 404 });
});
