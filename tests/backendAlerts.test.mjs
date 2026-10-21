import test from 'node:test';
import assert from 'node:assert/strict';
import { QUERIES, THRESHOLDS, problemsFrom } from '../scripts/backend-alerts.mjs';

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
