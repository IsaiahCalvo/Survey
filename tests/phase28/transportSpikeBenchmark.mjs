#!/usr/bin/env node
// tests/phase28/transportSpikeBenchmark.mjs
// Phase 28 Wave 0 skeleton — Plan 28-04 fills in the harness body.
// Source: .planning/phases/28-transport-spike-auth-validator/28-CONTEXT.md § Speed bar
//        + 28-RESEARCH.md Pitfall 5 (CDP throttling).
//
// This script drives the bake-off load against the chosen transport prototype:
//   - SupabaseYjsProvider (Plan 28-02)  ← default candidate
//   - HocuspocusYjsProvider (Plan 28-03) ← fallback candidate
//
// Wave 0 contract: the skeleton parses args, validates flag values, prints a JSON
// summary with the FULL set of fields Plan 28-04 asserts on (samples_count
// included), and exits 0. Plan 28-04 replaces the body with the real multi-peer
// load harness while keeping the same output contract.
//
// Usage:
//   node tests/phase28/transportSpikeBenchmark.mjs --transport=supabase --peers=5 --duration=60 --network=throttled
//
// Output contract (locked for Plan 28-04 acceptance criteria):
//   {
//     "status": "skeleton" | "complete" | "error",
//     "transport": "supabase" | "hocuspocus",
//     "peers": <number>,
//     "duration_s": <number>,
//     "network": "fast" | "throttled",
//     "p50_ms": <number|null>,
//     "p95_ms": <number|null>,
//     "p99_ms": <number|null>,
//     "msgs_per_sec": <number>,
//     "errors": <number>,
//     "samples_count": <number>,    // REQUIRED key per Plan 28-04 acceptance criteria
//     "note": <string>
//   }

const VALID_TRANSPORTS = ['supabase', 'hocuspocus'];
const VALID_NETWORKS = ['throttled', 'fast'];

function parseArgs(argv) {
  const args = {
    transport: 'supabase',
    peers: 5,
    duration: 60,
    network: 'throttled',
  };
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z_]+)=(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'peers' || key === 'duration') {
      args[key] = Number(value);
    } else {
      args[key] = value;
    }
  }
  return args;
}

function validateFlags(args) {
  if (!VALID_TRANSPORTS.includes(args.transport)) {
    return `--transport must be one of ${VALID_TRANSPORTS.join('|')}; got "${args.transport}"`;
  }
  if (!VALID_NETWORKS.includes(args.network)) {
    return `--network must be one of ${VALID_NETWORKS.join('|')}; got "${args.network}"`;
  }
  if (!Number.isFinite(args.peers) || args.peers <= 0) {
    return `--peers must be a positive number; got "${args.peers}"`;
  }
  if (!Number.isFinite(args.duration) || args.duration < 0) {
    return `--duration must be a non-negative number; got "${args.duration}"`;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  const error = validateFlags(args);
  if (error) {
    console.error(`transportSpikeBenchmark: invalid arguments — ${error}`);
    process.exit(2);
  }

  // ============================================================================
  // TODO: Plan 28-04 implementation
  //
  // This is where the real harness body lives:
  //   1. Spawn N peer browser contexts via Playwright
  //   2. Attach CDPSession + Network.emulateNetworkConditions for each peer
  //      (5 Mbps / 1 Mbps / 50ms / 5% packet loss when --network=throttled)
  //   3. Sign each peer in as a separate test bot account
  //   4. All peers open the same test document
  //   5. Each peer runs a mixed action (pen scribble / drag / text typing)
  //   6. For every Y.Doc update emitted, sample emit_ts at originator + apply_ts
  //      at each remote peer; compute (apply_ts - emit_ts) latency
  //   7. After --duration seconds, compute p50 / p95 / p99 latency
  //   8. Emit JSON summary on stdout with the same field shape as the skeleton
  //   9. Exit 0 if p95 < 500ms (speed bar pass), exit 1 otherwise
  //
  // The skeleton intentionally accepts both --network=fast (smoke test) and
  // --network=throttled (full speed-bar measurement) so Plan 28-04's verify
  // step can run a quick sanity check before the full benchmark.
  // ============================================================================

  // Wave 0 skeleton output: full JSON shape with placeholder values.
  // Every key Plan 28-04's acceptance criteria assert on is present here.
  const summary = {
    status: 'skeleton',
    transport: args.transport,
    peers: args.peers,
    duration_s: 0,                 // Plan 28-04 fills in actual elapsed seconds
    network: args.network,         // accepted but no-op in skeleton
    p50_ms: null,
    p95_ms: null,
    p99_ms: null,
    msgs_per_sec: 0,
    errors: 0,
    samples_count: 0,              // REQUIRED — Plan 28-04 acceptance asserts on this key
    note: 'Plan 28-04 implements assertions',
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('transportSpikeBenchmark: unexpected error', err);
  process.exit(1);
});
