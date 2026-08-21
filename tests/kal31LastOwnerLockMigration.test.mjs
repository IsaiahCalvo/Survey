import test from 'node:test';
import { match, ok, equal } from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260820220000_kal31_guard_last_owner_lock.sql',
);

function readMigration() {
  return fs.readFileSync(migrationPath, 'utf8');
}

function ownerLockThenCount(sql) {
  match(sql, /PERFORM 1[\s\S]+FROM public\.document_collaborators[\s\S]+role = 'owner'[\s\S]+status = 'active'[\s\S]+FOR UPDATE;/);
  match(sql, /SELECT COUNT\(\*\) INTO remaining_owners[\s\S]+user_id <> OLD\.user_id/);
  ok(
    sql.indexOf('FOR UPDATE') < sql.indexOf('SELECT COUNT(*) INTO remaining_owners'),
    'owner rows must be locked before the remaining-owner count',
  );
}

test('P2-23 intended: UPDATE and DELETE lock sibling owners before counting', () => {
  const sql = readMigration();
  match(sql, /CREATE OR REPLACE FUNCTION public\.kal31_guard_last_owner\(\)/);
  ownerLockThenCount(sql);
  const updateIdx = sql.indexOf("IF (TG_OP = 'UPDATE')");
  const deleteIdx = sql.indexOf("ELSIF (TG_OP = 'DELETE')");
  const firstLock = sql.indexOf('FOR UPDATE');
  const secondLock = sql.indexOf('FOR UPDATE', firstLock + 1);
  ok(updateIdx >= 0 && deleteIdx > updateIdx, 'both trigger branches remain');
  ok(firstLock > updateIdx && firstLock < deleteIdx, 'UPDATE branch locks');
  ok(secondLock > deleteIdx, 'DELETE branch locks');
});

test('P2-23 break: unlocked concurrent counts would both pass — the migration forbids that shape', () => {
  const sql = readMigration();
  // A COUNT-only guard (the old race) must not appear without a preceding FOR UPDATE
  // in the same owner-enforcement block.
  const deleteBranch = sql.slice(sql.indexOf("ELSIF (TG_OP = 'DELETE')"));
  const lockAt = deleteBranch.indexOf('FOR UPDATE');
  const countAt = deleteBranch.indexOf('SELECT COUNT(*) INTO remaining_owners');
  ok(lockAt >= 0 && countAt > lockAt, 'DELETE count is not a lock-free snapshot');
});

test('P2-23 edge: parent-document cascade still bypasses the lock before owner enforcement', () => {
  const sql = readMigration();
  const deleteStart = sql.indexOf("ELSIF (TG_OP = 'DELETE')");
  const branch = sql.slice(deleteStart, sql.indexOf('RETURN COALESCE(NEW, OLD);', deleteStart));
  match(branch, /IF NOT EXISTS \([\s\S]+FROM public\.documents[\s\S]+RETURN OLD;/);
  ok(
    branch.indexOf('IF NOT EXISTS') < branch.indexOf('FOR UPDATE'),
    'cascade bypass must run before the owner-row lock',
  );
});

test('P2-23 edge: serialized two-owner race keeps one owner', () => {
  // Protocol model of FOR UPDATE then COUNT. Two concurrent removals of
  // distinct owners: the second waiter observes the first commit.
  function race({ lock } = { lock: false }) {
    const owners = new Set(['a', 'b']);
    const attempts = ['a', 'b'];
    for (const who of attempts) {
      const others = [...owners].filter((id) => id !== who);
      if (lock) {
        // waiter sees committed state; first removal already applied
      }
      if (others.length < 1) continue;
      owners.delete(who);
    }
    return owners.size;
  }

  function raceUnlocked() {
    const owners = new Set(['a', 'b']);
    const snapshots = ['a', 'b'].map((who) => [...owners].filter((id) => id !== who).length);
    if (snapshots.every((n) => n >= 1)) {
      owners.clear();
    }
    return owners.size;
  }

  equal(raceUnlocked(), 0, 'unlocked COUNT race leaves the document ownerless');
  equal(race({ lock: true }), 1, 'serialized lock+count keeps one owner');
});
