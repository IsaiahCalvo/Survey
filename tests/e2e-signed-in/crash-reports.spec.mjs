// Crash reports: a signed-in browser can send a failed-request report
// (kind 'request', src/utils/requestErrorLog.js) and it is stored; an unknown
// kind is refused. The table stays closed to the browser itself.
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, apiClientFor, expect, test } from './helpers.mjs';

const report = (kind, id) => ({
  p_kind: kind,
  p_message: 'GET /rest/v1/documents -> 503',
  p_route: '/',
  p_build: 'e2e',
  p_platform: 'web-desktop',
  p_browser: 'Chrome 140',
  p_report_id: id,
});

test('failed-request crash reports are stored; unknown kinds are refused', async () => {
  const admin = adminClient();
  const client = await apiClientFor(E2E_ACCOUNTS.free);
  const id = `e2e-${randomUUID().slice(0, 12)}`;
  try {
    const sent = await client.rpc('report_client_error', report('request', id));
    expect(sent.error).toBeNull();
    expect(sent.data).toBe(true);
    const stored = await admin.from('client_errors').select('kind, message, platform').eq('report_id', id);
    expect(stored.data).toEqual([{ kind: 'request', message: 'GET /rest/v1/documents -> 503', platform: 'web-desktop' }]);

    const odd = await client.rpc('report_client_error', report('made-up', `${id}-x`));
    expect(odd.data).toBe(false);

    const read = await client.from('client_errors').select('id').limit(1);
    expect(read.data?.length || 0).toBe(0);
  } finally {
    await admin.from('client_errors').delete().like('report_id', `${id}%`);
  }
});
