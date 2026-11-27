import { fileFromHandlerItems } from '../../api/onedrive-open.mjs';

async function readItemsFromRequest(request) {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    return url.searchParams.get('items');
  }
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    try {
      const parsed = await request.json();
      return parsed?.items ?? null;
    } catch {
      return null;
    }
  }
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    try {
      const form = await request.formData();
      return form.get('items');
    } catch {
      // Fall through to raw text parse.
    }
  }
  try {
    const raw = await request.text();
    if (!raw) return url.searchParams.get('items');
    try {
      return JSON.parse(raw)?.items ?? null;
    } catch {
      return new URLSearchParams(raw).get('items');
    }
  } catch {
    return url.searchParams.get('items');
  }
}

export async function onRequest(context) {
  const { request } = context;
  const baseHeaders = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  };

  if (request.method !== 'POST' && request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  const file = fileFromHandlerItems(await readItemsFromRequest(request));
  const to = file
    ? `/?open-onedrive=${encodeURIComponent(file.driveId)}&item=${encodeURIComponent(file.itemId)}`
    : '/?open-onedrive-error=1';

  return new Response(null, {
    status: 303,
    headers: {
      ...baseHeaders,
      Location: to,
    },
  });
}
