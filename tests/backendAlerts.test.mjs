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
