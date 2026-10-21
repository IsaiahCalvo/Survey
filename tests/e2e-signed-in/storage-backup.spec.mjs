// The weekly storage backup (scripts/storage-backup.mjs) against the local
// stack: new files are copied, changed ones refreshed, removed ones kept 30
// days under _removed/ and then purged.
import crypto from 'node:crypto';
import { RUN, exists, must } from './accountFixtures.mjs';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, apiClientFor, expect, test } from './helpers.mjs';
import { BACKUP_BUCKET, restoreBackup, runBackup } from '../../scripts/storage-backup.mjs';

const pdf = (text) => new Blob([`%PDF-1.7\n${text}\n%%EOF\n`], { type: 'application/pdf' });
const quiet = () => {};

test('the storage backup copies, refreshes, retires and purges', async () => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const path = `backup-${RUN}/${crypto.randomUUID()}.pdf`;
  const key = `documents/${path}`;
  const read = async (bucket, name) => (await must('download', admin.storage.from(bucket).download(name))).text();

  await must('upload', admin.storage.from('documents').upload(path, pdf('one'), { contentType: 'application/pdf' }));
  await runBackup(admin, { log: quiet });
  expect(await read(BACKUP_BUCKET, key)).toContain('one');

  // Nothing changed: nothing to copy for this file.
  const again = await runBackup(admin, { dryRun: true, log: quiet });
  expect(again.copy.map((c) => c.key)).not.toContain(key);

  await must('replace', admin.storage.from('documents').upload(path, pdf('second version'), { contentType: 'application/pdf', upsert: true }));
  const refreshed = await runBackup(admin, { log: quiet });
  expect(refreshed.failed).toBe(0);
  expect(await read(BACKUP_BUCKET, key)).toContain('second version');
  expect(await exists(admin, BACKUP_BUCKET, `_staging/${key}`), 'staged copy moved into place').toBe(false);

  await must('remove', admin.storage.from('documents').remove([path]));
  const today = new Date();
  const removedKey = `_removed/${today.toISOString().slice(0, 10)}/${key}`;
  await runBackup(admin, { today, log: quiet });
  expect(await exists(admin, BACKUP_BUCKET, key)).toBe(false);
  expect(await read(BACKUP_BUCKET, removedKey)).toContain('second version');

  // A bare or bucket-wide restore would bring back deleted accounts' files.
  for (const prefix of ['', 'documents', 'documents/', '_removed/']) {
    await expect(restoreBackup(admin, prefix, { log: quiet })).rejects.toThrow(/--restore needs/);
  }
  // A removed file can be put back from _removed/.
  expect((await restoreBackup(admin, removedKey, { log: quiet })).restored).toBe(1);
  expect(await read('documents', path)).toContain('second version');
  await must('remove again', admin.storage.from('documents').remove([path]));

  await runBackup(admin, { today: new Date(today.getTime() + 29 * 86_400_000), log: quiet });
  expect(await exists(admin, BACKUP_BUCKET, removedKey), 'kept for 30 days').toBe(true);
  await runBackup(admin, { today: new Date(today.getTime() + 31 * 86_400_000), log: quiet });
  expect(await exists(admin, BACKUP_BUCKET, removedKey), 'purged after 30 days').toBe(false);
});

test('signed-in people cannot read the backup or its inventory', async () => {
  const client = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data } = await client.storage.from(BACKUP_BUCKET).list('documents');
  expect(data ?? []).toEqual([]);
  const { error } = await client.rpc('storage_backup_inventory');
  expect(error).toBeTruthy();
});
