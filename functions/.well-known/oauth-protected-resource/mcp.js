const OAUTH_RESOURCE_UPSTREAM =
  'https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/survey-mcp/.well-known/oauth-protected-resource?via=site';

export async function onRequest(context) {
  const { request } = context;
  const headers = new Headers(request.headers);
  headers.delete('host');
  return fetch(OAUTH_RESOURCE_UPSTREAM, {
    method: request.method,
    headers,
  });
}
