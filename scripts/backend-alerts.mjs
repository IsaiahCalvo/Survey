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
//   - plan quotas at 80%: database size, stored files, storage egress
//     (estimated), monthly active users, edge function calls, and Groq's
//     free daily caps per voice-agent model (QUOTAS below)
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
  functionCalls: `select count() as n from logs where source = 'function_edge_logs'`,
  // Downloads of stored files: bytes of each range read, plus whole reads
  // per object (sized from the database afterwards). API answers are small
  // and left out, so this slightly undercounts egress.
  storageReads: `select obj, countIf(status = '200' or (status = '206' and r2 = '')) as full_reads,
      sumIf(toInt64OrZero(r2) - toInt64OrZero(r1) + 1, status = '206' and r2 != '') as range_bytes
    from (select extract(log_attributes['request.path'], '^/storage/v1/object/(?:sign/|authenticated/|public/)?((?:documents|survey-media|brand)/.+)$') as obj,
        log_attributes['response.status_code'] as status,
        splitByChar('-', replaceOne(log_attributes['request.headers.range'], 'bytes=', ''))[1] as r1,
        splitByChar('-', replaceOne(log_attributes['request.headers.range'], 'bytes=', ''))[2] as r2
      from logs where source = 'edge_logs' and log_attributes['request.method'] = 'GET'
        and log_attributes['request.path'] like '/storage/v1/object/%')
    where obj != '' group by obj`,
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

// What the plan includes, and what going past it costs. Supabase: Pro plan
// (supabase.com/pricing, 2026-10-21). Groq: free tier per model per day
// (console.groq.com/docs/rate-limits, 2026-10-21). Alert at QUOTA_ALERT_AT.
export const QUOTA_ALERT_AT = 0.8;
const GB = 1024 ** 3;
export const QUOTAS = Object.freeze({
  databaseBytes: { label: 'Database size', limit: 8 * GB, bytes: true, over: '$0.125 per GB a month past 8 GB' },
  storageBytes: { label: 'Stored files', limit: 100 * GB, bytes: true, over: '$0.021 per GB a month past 100 GB' },
  egressBytesPerMonth: { label: 'File downloads (egress, estimated from the last 24 hours)', limit: 250 * GB, bytes: true, over: '$0.09 per GB past 250 GB a month' },
  monthlyActiveUsers: { label: 'Monthly active users', limit: 100_000, over: '$0.00325 per user past 100,000' },
  functionCallsPerMonth: { label: 'Edge function calls (estimated from the last 24 hours)', limit: 2_000_000, over: '$2 per million past 2 million a month' },
  groqTurnRequests: { label: 'Voice agent replies today (gpt-oss-120b)', limit: 1_000, over: 'Groq Developer plan, $0.15 in / $0.60 out per million tokens' },
  groqTurnTokens: { label: 'Voice agent reply tokens today (gpt-oss-120b)', limit: 200_000, over: 'Groq Developer plan, $0.15 in / $0.60 out per million tokens' },
  groqTranscribeRequests: { label: 'Voice agent listening today (whisper-large-v3-turbo)', limit: 2_000, over: 'Groq Developer plan, about $0.04 per audio hour' },
  groqTranscribeSeconds: { label: 'Voice agent audio seconds today (whisper-large-v3-turbo)', limit: 28_800, over: 'Groq Developer plan, about $0.04 per audio hour' },
  groqSpeakRequests: { label: 'Voice agent spoken replies today (orpheus)', limit: 100, over: 'Groq Developer plan, about $22 per million characters' },
  groqSpeakTokens: { label: 'Voice agent spoken-reply tokens today (orpheus)', limit: 3_600, over: 'Groq Developer plan, about $22 per million characters' },
});

const formatAmount = (value, quota) => (quota.bytes
  ? `${(value / GB).toFixed(value >= 10 * GB ? 0 : 2)} GB`
  : Math.round(value).toLocaleString('en-US'));

/** One line per quota at or past QUOTA_ALERT_AT of its limit. */
export function quotaProblemsFrom(usage, quotas = QUOTAS) {
  const problems = [];
  for (const [key, quota] of Object.entries(quotas)) {
    const value = Number(usage[key]);
    if (!Number.isFinite(value) || value < quota.limit * QUOTA_ALERT_AT) continue;
    const share = Math.round((value / quota.limit) * 100);
    problems.push(`- ${quota.label}: ${formatAmount(value, quota)} of ${formatAmount(quota.limit, quota)} (${share}%). Past it: ${quota.over}.`);
  }
  return problems;
}

// Database side of the quotas. Monthly active users: anyone who signed in or
// refreshed a session this calendar month (Supabase counts per billing cycle).
export const QUOTA_SQL = `select pg_database_size(current_database()) as database_bytes,
  (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects) as storage_bytes,
  (select count(*) from auth.users u where u.last_sign_in_at >= date_trunc('month', now())
     or exists (select 1 from auth.sessions s where s.user_id = u.id
       and coalesce(s.refreshed_at, s.updated_at, s.created_at) >= date_trunc('month', now()))) as monthly_active_users`;

export const GROQ_DAILY_SQL = `select kind, requests, tokens, audio_seconds from public.survey_agent_daily_usage
  where day = (now() at time zone 'utc')::date`;

const sqlText = (value) => `'${String(value).replace(/'/g, "''")}'`;

/** Sizes of the objects read, so whole reads can be counted in bytes. */
export function objectSizesSql(objects) {
  const pairs = objects.map((obj) => {
    const slash = obj.indexOf('/');
    return `(${sqlText(obj.slice(0, slash))}, ${sqlText(obj.slice(slash + 1))})`;
  });
  return `select o.bucket_id || '/' || o.name as obj, (o.metadata->>'size')::bigint as size
    from storage.objects o join (values ${pairs.join(', ')}) as v(bucket_id, name)
      on o.bucket_id = v.bucket_id and o.name = v.name`;
}

/** Quota usage from the raw query answers; per-day counts become a month. */
export function quotaUsageFrom({ database, storageReads = [], sizes = [], functionCalls24h = 0, groqDaily = [] }) {
  const sizeOf = new Map(sizes.map((row) => [row.obj, Number(row.size) || 0]));
  const egress24h = storageReads.reduce((sum, row) => sum + Number(row.range_bytes || 0)
    + Number(row.full_reads || 0) * (sizeOf.get(row.obj) || 0), 0);
  const groq = Object.fromEntries(groqDaily.map((row) => [row.kind, row]));
  return {
    databaseBytes: Number(database?.database_bytes || 0),
    storageBytes: Number(database?.storage_bytes || 0),
    monthlyActiveUsers: Number(database?.monthly_active_users || 0),
    egressBytesPerMonth: egress24h * 30,
    functionCallsPerMonth: Number(functionCalls24h) * 30,
    groqTurnRequests: Number(groq.turn?.requests || 0),
    groqTurnTokens: Number(groq.turn?.tokens || 0),
    groqTranscribeRequests: Number(groq.transcribe?.requests || 0),
    groqTranscribeSeconds: Number(groq.transcribe?.audio_seconds || 0),
    groqSpeakRequests: Number(groq.speak?.requests || 0),
    // speak records characters; about 4 make a token.
    groqSpeakTokens: Number(groq.speak?.tokens || 0) / 4,
  };
}

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

async function readQuotaUsage() {
  const [[database], storageReads, functionCalls, groqDaily] = await Promise.all([
    queryDatabase(QUOTA_SQL),
    queryLogs(QUERIES.storageReads, 24),
    queryLogs(QUERIES.functionCalls, 24),
    // The table arrives with migration 20261022070000; until then, no Groq rows.
    queryDatabase(GROQ_DAILY_SQL).catch(() => []),
  ]);
  const wholeReads = storageReads.filter((row) => Number(row.full_reads) > 0).map((row) => String(row.obj));
  const sizes = [];
  for (let i = 0; i < wholeReads.length; i += 200) {
    sizes.push(...await queryDatabase(objectSizesSql(wholeReads.slice(i, i + 200))));
  }
  return quotaUsageFrom({ database, storageReads, sizes, functionCalls24h: Number(functionCalls[0]?.n || 0), groqDaily });
}

async function main() {
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
  const [signIns, edge5xx, agent, crashes, quotas] = await Promise.all([
    queryLogs(QUERIES.failedSignIns, 1),
    queryLogs(QUERIES.edge5xx, 1),
    queryLogs(QUERIES.agentCalls, 24),
    queryDatabase(CRASH_SPIKE_SQL),
    readQuotaUsage(),
  ]);
  const counts = {
    failedSignIns: Number(signIns[0]?.n || 0),
    edge5xx: edge5xx.map((row) => ({ fn: String(row.fn), n: Number(row.n) })),
    agentCalls: Number(agent[0]?.n || 0),
    crashGroups: (Array.isArray(crashes) ? crashes : []).map((row) => ({ ...row, times: Number(row.times) })),
  };
  console.log(`failed sign-ins/hour ${counts.failedSignIns}, edge 5xx/hour ${counts.edge5xx.reduce((s, r) => s + r.n, 0)}, voice agent calls/24h ${counts.agentCalls}, crash groups over threshold ${counts.crashGroups.length}`);
  console.log(`quotas: ${Object.entries(quotas).map(([key, value]) => `${key} ${Math.round((value / QUOTAS[key].limit) * 100)}%`).join(', ')}`);
  const problems = [...problemsFrom(counts), ...quotaProblemsFrom(quotas)];
  if (out) fs.writeFileSync(out, problems.length ? `${problems.join('\n')}\n` : '');
  if (problems.length) console.log(problems.join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`[backend-alerts] ${error.message}`); process.exitCode = 1; });
}
