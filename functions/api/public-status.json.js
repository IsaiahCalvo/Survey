const PUBLIC_STATUS_UPSTREAM =
  'https://cvamwtpsuvxvjdnotbeg.supabase.co/storage/v1/object/public/app-public/status.json';

export async function onRequestGet() {
  const upstream = await fetch(PUBLIC_STATUS_UPSTREAM, {
    headers: { Accept: 'application/json' },
  }).catch(() => null);

  if (!upstream) {
    return new Response(JSON.stringify({ error: 'status_unavailable' }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  const headers = new Headers(upstream.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
