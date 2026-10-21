import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CRASH_SPIKE_SQL, QUERIES, QUOTAS, THRESHOLDS, objectSizesSql, problemsFrom, quotaProblemsFrom, quotaUsageFrom,
} from '../scripts/backend-alerts.mjs';

const quiet = { failedSignIns: 2, edge5xx: [], agentCalls: 10 };

test('a quiet hour raises nothing', () => {
  assert.deepEqual(problemsFrom(quiet), []);
});

test('each spike raises its own line at its threshold', () => {
  assert.equal(problemsFrom({ ...quiet, failedSignIns: THRESHOLDS.failedSignInsPerHour }).length, 1);
  const errors = problemsFrom({ ...quiet, edge5xx: [{ fn: 'survey-agent', n: 3 }, { fn: 'send-email', n: 2 }] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /5 server errors.*survey-agent 3, send-email 2/);
  assert.match(problemsFrom({ ...quiet, agentCalls: 800 })[0], /Groq/);
  assert.equal(problemsFrom({ failedSignIns: 99, edge5xx: [{ fn: 'x', n: 9 }], agentCalls: 999 }).length, 3);
});

test('queries use ClickHouse log fields and never select whole rows', () => {
  for (const sql of Object.values(QUERIES)) {
    assert.match(sql, /from logs where source = '/);
    assert.doesNotMatch(sql, /event_message|select \*|count\(\*\)/);
  }
});

test('crash groups: a new crash 10+ times or any crash 100+ times raises an alert', () => {
  const base = { failedSignIns: 0, edge5xx: [], agentCalls: 0 };
  const problems = problemsFrom({ ...base, crashGroups: [
    { kind: 'error', message: 'x is undefined', times: 12, seen_before: false, platforms: 'web-phone', build: '2.0.1' },
    { kind: 'error', message: 'old one', times: 50, seen_before: true },
    { kind: 'request', message: 'GET /rest/v1/documents -> 503', times: 140, seen_before: true, platforms: 'ios-app' },
    { kind: 'error', message: 'rare', times: 3, seen_before: false },
  ] });
  assert.equal(problems.length, 2);
  assert.match(problems[0], /^- New crash: 12 times .*web-phone; build 2\.0\.1\): x is undefined$/);
  assert.match(problems[1], /^- Crash spike: 140 times .*request; ios-app/);
});

test('crash query applies the thresholds before its row limit', () => {
  // Otherwise 20 busy known crashes could push a new one out of the list.
  const filter = CRASH_SPIKE_SQL.indexOf(`times >= ${THRESHOLDS.anyCrashPerHour}`);
  assert.ok(CRASH_SPIKE_SQL.includes(`having sum(repeats) >= ${THRESHOLDS.newCrashPerHour}`));
  assert.ok(filter > 0 && filter < CRASH_SPIKE_SQL.indexOf('limit 20'));
});

test('quotas: a line at 80% of each limit, with what going past costs', () => {
  const GB = 1024 ** 3;
  const usage = quotaUsageFrom({
    database: { database_bytes: 104_418_451, storage_bytes: 189_407_634, monthly_active_users: 4 },
    storageReads: [{ obj: 'documents/u/a.pdf', full_reads: 2, range_bytes: 1000 }],
    sizes: [{ obj: 'documents/u/a.pdf', size: 500 }],
    functionCalls24h: 1000,
    groqDaily: [{ kind: 'speak', requests: 85, tokens: 400, audio_seconds: 0 }, { kind: 'turn', requests: 10, tokens: 5000 }],
  });
  assert.equal(usage.egressBytesPerMonth, (1000 + 2 * 500) * 30);
  assert.equal(usage.functionCallsPerMonth, 30_000);
  assert.equal(usage.groqSpeakTokens, 100, 'speak counts characters; 4 per token');
  const problems = quotaProblemsFrom(usage);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^- Voice agent spoken replies today \(orpheus\): 85 of 100 \(85%\)\. Past it: .*\$22/);

  const full = quotaProblemsFrom({ databaseBytes: 7 * GB, storageBytes: 79 * GB, egressBytesPerMonth: 0, monthlyActiveUsers: 80_000 });
  assert.equal(full.length, 2);
  assert.match(full[0], /Database size: 7\.00 GB of 8\.00 GB \(88%\)/);
  assert.match(full[1], /Monthly active users: 80,000 of 100,000/);
  for (const quota of Object.values(QUOTAS)) assert.ok(quota.limit > 0 && quota.over, quota.label);
});

test('object sizes query quotes names it got from the logs', () => {
  const sql = objectSizesSql(["documents/u/it's.pdf", 'survey-media/d/m/x.jpg']);
  assert.match(sql, /\('documents', 'u\/it''s\.pdf'\), \('survey-media', 'd\/m\/x\.jpg'\)/);
});
