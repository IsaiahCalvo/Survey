const MCP_UPSTREAM_BASE = 'https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/survey-mcp';

async function proxyMcp(request, suffix = '') {
  const incomingUrl = new URL(request.url);
  const target = new URL(`${MCP_UPSTREAM_BASE}${suffix}`);
  for (const [k, v] of incomingUrl.searchParams.entries()) {
    target.searchParams.append(k, v);
  }
  if (!target.searchParams.has('via')) {
    target.searchParams.set('via', 'site');
  }

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ipcountry');
  headers.delete('cf-ray');
  headers.delete('cf-visitor');

  const init = {
    method: request.method,
    headers,
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  return fetch(target.toString(), init);
}

export async function onRequest(context) {
  const rawPath = context.params?.path;
  const suffix = Array.isArray(rawPath) && rawPath.length > 0
    ? `/${rawPath.join('/')}`
    : (typeof rawPath === 'string' && rawPath ? `/${rawPath}` : '');
  return proxyMcp(context.request, suffix);
}
