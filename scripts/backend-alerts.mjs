#!/usr/bin/env node
// scripts/backend-alerts.mjs — hourly backend abuse and error check
// (.github/workflows/backend-alerts.yml). Reads production's logs through the
// Supabase Management API and prints a Markdown list of problems, or nothing:
//   - failed sign-ins (password / refresh token refused) in the last hour
//   - 5xx answers from edge functions in the last hour
//   - voice agent calls in the last 24 hours, against the Groq free tier's
//     1,000 requests a day for openai/gpt-oss-120b
//   - crash spikes from the client_errors table (web and both apps): a crash
//     not seen in the 7 days before that happened 10+ times in the last hour,
//     or any crash 100+ times in the last hour
// Prints counts and function names only, plus crash messages, which the
// browser already scrubbed (crashReporter.js): CI logs on this repo are public.
//
//   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_ID=… node scripts/backend-alerts.mjs [--out problems.md]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const THRESHOLDS = Object.freeze({
  failedSignInsPerHour: 30,
  edge5xxPerHour: 5,
  groqRequestsPerDay: 800, // 80% of Groq's free 1,000 a day
  newCrashPerHour: 10,
  anyCrashPerHour: 100,
});

export const QUERIES = Object.freeze({
  failedSignIns: `select count() as n from logs where source = 'edge_logs'
    and log_attributes['request.method'] = 'POST'
    and log_attributes['request.path'] like '/auth/v1/token%'
    and toInt32OrZero(log_attributes['response.status_code']) in (400, 401, 422, 429)`,
  edge5xx: `select splitByChar('/', log_attributes['request.pathname'])[4] as fn, count() as n
    from logs where source = 'function_edge_logs'
    and toInt32OrZero(log_attributes['response.status_code']) >= 500
    group by fn order by n desc limit 10`,
  agentCalls: `select count() as n from logs where source = 'function_edge_logs'
    and log_attributes['request.pathname'] like '/functions/v1/survey-agent%'
    and log_attributes['request.method'] = 'POST'
    and toInt32OrZero(log_attributes['response.status_code']) = 200`,
});

// Database query (not logs): crash groups from the last hour, with whether
// the same kind + message showed up in the 7 days before it.
export const CRASH_SPIKE_SQL = `with recent as (
    select kind, left(message, 160) as message, sum(repeats)::int as times,
      string_agg(distinct coalesce(platform, '?'), ', ') as platforms,
      max(build) as build
    from public.client_errors where received_at > now() - interval '1 hour'
    group by 1, 2
    having sum(repeats) >= ${THRESHOLDS.newCrashPerHour}),
  marked as (
    select r.*, exists (
        select 1 from public.client_errors o
        where o.kind = r.kind and left(o.message, 160) = r.message
          and o.received_at <= now() - interval '1 hour'
          and o.received_at > now() - interval '7 days') as seen_before
    from recent r)
  -- Keep only groups that pass a threshold before the limit, so busy known
  -- crashes can't push a new one out of the list.
  select * from marked
  where not seen_before or times >= ${THRESHOLDS.anyCrashPerHour}
  order by times desc limit 20`;

/** Problems as Markdown bullet lines, given the counts the queries returned. */
export function problemsFrom({ failedSignIns, edge5xx, agentCalls, crashGroups = [] }, limits = THRESHOLDS) {
  const problems = [];
  if (failedSignIns >= limits.failedSignInsPerHour) {
    problems.push(`- ${failedSignIns} failed sign-ins in the last hour (alert at ${limits.failedSignInsPerHour}). Someone may be guessing passwords.`);
  }
  const total5xx = edge5xx.reduce((sum, row) => sum + row.n, 0);
  if (total5xx >= limits.edge5xxPerHour) {
    const by = edge5xx.map((row) => `${row.fn} ${row.n}`).join(', ');
    problems.push(`- ${total5xx} server errors from edge functions in the last hour (${by}).`);
  }
  if (agentCalls >= limits.groqRequestsPerDay) {
    problems.push(`- ${agentCalls} voice agent calls in the last 24 hours; Groq's free tier stops at 1,000 a day.`);
  }
  for (const group of crashGroups) {
    const isNew = !group.seen_before && group.times >= limits.newCrashPerHour;
    if (!isNew && group.times < limits.anyCrashPerHour) continue;
    const what = String(group.message || '').replace(/[\r\n|`]+/g, ' ').slice(0, 160);
    problems.push(`- ${isNew ? 'New crash' : 'Crash spike'}: ${group.times} times in the last hour (${group.kind}; ${group.platforms || '?'}; build ${group.build || '?'}): ${what}`);
  }
  return problems;
}

async function queryLogs(sql, hours) {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600_000);
  const url = new URL(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_ID}/analytics/endpoints/logs`);
  url.searchParams.set('sql', sql);
  url.searchParams.set('iso_timestamp_start', start.toISOString());
  url.searchParams.set('iso_timestamp_end', end.toISOString());
  const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` } });
  if (!response.ok) throw new Error(`logs query answered ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`logs query failed: ${JSON.stringify(body.error).slice(0, 200)}`);
  return body.result || [];
}

async function queryDatabase(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_ID}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) throw new Error(`database query answered ${response.status}`);
  return response.json();
}

async function main() {
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
  const [signIns, edge5xx, agent, crashes] = await Promise.all([
    queryLogs(QUERIES.failedSignIns, 1),
    queryLogs(QUERIES.edge5xx, 1),
    queryLogs(QUERIES.agentCalls, 24),
    queryDatabase(CRASH_SPIKE_SQL),
  ]);
  const counts = {
    failedSignIns: Number(signIns[0]?.n || 0),
    edge5xx: edge5xx.map((row) => ({ fn: String(row.fn), n: Number(row.n) })),
    agentCalls: Number(agent[0]?.n || 0),
    crashGroups: (Array.isArray(crashes) ? crashes : []).map((row) => ({ ...row, times: Number(row.times) })),
  };
  console.log(`failed sign-ins/hour ${counts.failedSignIns}, edge 5xx/hour ${counts.edge5xx.reduce((s, r) => s + r.n, 0)}, voice agent calls/24h ${counts.agentCalls}, crash groups over threshold ${counts.crashGroups.length}`);
  const problems = problemsFrom(counts);
  if (out) fs.writeFileSync(out, problems.length ? `${problems.join('\n')}\n` : '');
  if (problems.length) console.log(problems.join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`[backend-alerts] ${error.message}`); process.exitCode = 1; });
}
