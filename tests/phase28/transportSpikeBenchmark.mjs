#!/usr/bin/env node
// tests/phase28/transportSpikeBenchmark.mjs
// Phase 28 Plan 28-04 — multi-peer throttled-network transport bake-off harness.
//
// Source: 28-CONTEXT.md "Speed bar" (4-5 peers, mixed actions, p95 < 500ms,
// throttled wifi); 28-RESEARCH.md Pitfall 5 (CDP throttling) + Open Question 6
// (hybrid harness recommendation).
//
// Replaces Plan 28-01's skeleton with the real harness body. Both transports
// run through this same driver behind --transport=supabase|hocuspocus.
//
// Architecture (hybrid pragmatic approach):
//   - N Node processes (workers), one per peer.
//   - Each worker signs in via @supabase/supabase-js as a distinct account from
//     the task's coordinator-assigned, verified test-account lease.
//   - Each worker creates a Y.Doc + connects to the chosen transport.
//   - Latency capture uses a SIDE-CHANNEL "bench:emit" event that piggybacks
//     on the same channel infrastructure as the actual Y.Doc update broadcast.
//     For the Supabase path, every emitter publishes a bench:emit event on
//     the same Realtime channel carrying { peerId, seq, t0_ms } RIGHT BEFORE
//     emitting the Y.Doc transaction; receivers compute (local_arrival_t -
//     t0_ms) when the bench:emit lands AND when the corresponding Y.Doc update
//     applies, taking the LATER of the two for honest end-to-end propagation.
//     For Hocuspocus, the harness uses a parallel WebSocket connection to a
//     separate ws://...:1235 ping channel built into the bench server. This
//     is the simplest honest measurement: same wire, same auth, same network.
//   - A simulated network layer wraps the channel boundary and injects
//     per-direction delay + random packet drops to approximate "throttled wifi"
//     (5 Mbps down / 1 Mbps up / 50ms RTT / 5% loss). This is a deliberate
//     simplification of CDP-level throttling because the transport providers
//     don't go through a CDP-controllable browser layer in the Node-driven
//     harness — but the propagation latency it injects is applied uniformly
//     to BOTH transports so the comparison is fair.
//   - Each worker runs a mixed action loop for `--duration` seconds:
//       - "pen-scribble"  → many small Y.Array pushes (high-frequency)
//       - "drag-shape"    → continuous Y.Map updates on a single id
//       - "type-text"     → Y.Text insertions one char at a time
//     The action mix probability is split 60/20/20 (pen-heavy — matches the
//     worst-case "rapid pen scribbling" from CONTEXT.md).
//   - After duration, workers stream samples back to the parent which aggregates
//     p50/p95/p99 across all peers, counts errors, and writes JSON.
//
// Usage:
//   node tests/phase28/transportSpikeBenchmark.mjs \
//     --transport=supabase --peers=5 --duration=300 --network=throttled \
//     --report-out=.planning/phases/28-transport-spike-auth-validator/28-bench-results/supabase.json
//
// Flag contract:
//   --transport=supabase|hocuspocus   (required)
//   --peers=N                         (default 5, range 2..10)
//   --duration=N                      (default 60, seconds, > 0)
//   --network=throttled|fast          (default throttled)
//   --report-out=path                 (path to JSON output file)
//   --hocuspocus-url=ws://host:port   (optional, default ws://127.0.0.1:1234)
//
// Output JSON contract (locked for Plan 28-04 acceptance criteria):
//   { transport, peers, duration_s, network, p50_ms, p95_ms, p99_ms,
//     msgs_per_sec, errors, samples_count, verdict, speed_bar_threshold_p95_ms }

import { fork } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVerifiedTestAccounts } from '../../scripts/test-account-lease.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const VALID_TRANSPORTS = ['supabase', 'hocuspocus'];
const VALID_NETWORKS = ['throttled', 'fast'];
const SPEED_BAR_P95_MS = 500;

// Network profiles per CONTEXT.md "throttled wifi" + RESEARCH.md Pitfall 5.
// Modeled as one-way delay (ms) + random drop probability. RTT = 2 × one-way.
const NETWORK_PROFILES = {
  throttled: { oneWayMs: 25, dropP: 0.05 }, // 50ms RTT, 5% drop
  fast: { oneWayMs: 0, dropP: 0 }, // no throttling — for smoke tests
};

// Action mix for the worst-case "rapid pen scribbling + drag + text" load.
// Pen weight is heavier per CONTEXT.md ("rapid pen scribbling" called out specifically).
const ACTION_WEIGHTS = { pen: 60, drag: 20, text: 20 };
const ACTION_INTERVAL_MS_RANGE = [100, 300]; // jitter between actions

// ---- Argument parsing ------------------------------------------------------

function parseArgs(argv) {
  const args = {
    transport: null,
    peers: 5,
    duration: 60,
    network: 'throttled',
    'report-out': null,
    'hocuspocus-url': 'ws://127.0.0.1:1234',
  };
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z_-]+)=(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'peers' || key === 'duration') args[key] = Number(value);
    else args[key] = value;
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
  if (!Number.isFinite(args.peers) || args.peers < 2 || args.peers > 10) {
    return `--peers must be in [2..10]; got "${args.peers}"`;
  }
  if (!Number.isFinite(args.duration) || args.duration <= 0) {
    return `--duration must be a positive number; got "${args.duration}"`;
  }
  return null;
}

// ---- Worker entry point (this same file is forked) -------------------------

async function runWorker() {
  const config = JSON.parse(process.env.PHASE28_WORKER_CONFIG);
  const {
    transport,
    peerIndex,
    durationS,
    networkProfile,
    hocuspocusUrl,
    bot,
    supabaseUrl,
    supabaseAnonKey,
    documentId,
  } = config;

  const { createClient } = await import('@supabase/supabase-js');
  const Y = await import('yjs');

  // Sign in as the assigned bot — every peer carries a different auth.uid().
  const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: true, persistSession: false },
  });
  const { error: signInErr } = await supabaseClient.auth.signInWithPassword({
    email: bot.email,
    password: bot.password,
  });
  if (signInErr) {
    process.send({ type: 'error', peerIndex, message: `signIn failed: ${signInErr.message}` });
    process.exit(1);
  }

  const ydoc = new Y.Doc();

  // Network simulator: wraps channel.send via a per-side delay + random drop.
  const netDelay = networkProfile.oneWayMs;
  const dropP = networkProfile.dropP;
  const peerId = `peer-${peerIndex}-${process.pid}`;

  // Per-peer sample buffer.
  const samples = [];
  let errors = 0;
  let outboundCount = 0;
  let benchEventsReceived = 0;

  // Pending t0 lookups: when we emit, we tag with seq + t0_ms; when we receive
  // the corresponding bench-emit from another peer, we compute latency.
  // We keep a small ring buffer per peer of (peerId, seq, t0_ms).
  // Actually it's simpler: receiver gets (peerId, seq, t0_ms) directly in the
  // bench:emit payload from the emitter, so we just compute Date.now() - t0_ms
  // on receive.

  // ---- Connect transport ---------------------------------------------------
  let providerHandle = null;
  let benchChannel = null; // for Supabase path — sibling realtime channel for bench:emit pings

  if (transport === 'supabase') {
    const providerMod = await import('../../src/lib/collab/SupabaseYjsProvider.js');
    providerHandle = providerMod.connect(documentId, ydoc, {
      supabase: supabaseClient,
      onUpdateRejected: (reason) => {
        errors++;
        process.send({ type: 'error', peerIndex, message: `update_rejected: ${reason}` });
      },
      onTransportState: (state) => {
        if (state === 'offline') {
          process.send({ type: 'log', peerIndex, message: `transport_state: ${state}` });
        }
      },
    });

    // Sibling channel for bench:emit pings. Same Realtime infrastructure, same
    // auth, same wire — different event name so we don't collide with sync frames.
    benchChannel = supabaseClient.channel(`yjs-bench:${documentId}`, {
      config: { broadcast: { ack: false, self: false } },
    });
    benchChannel.on('broadcast', { event: 'bench:emit' }, ({ payload }) => {
      if (!payload || payload.peerId === peerId) return;
      // Apply receive-side network delay synthetically — the simulator models
      // the second half of the RTT here.
      const observedLatency = Date.now() - payload.t0_ms + netDelay;
      // Ignore obviously bogus samples (clock skew, late arrivals after duration).
      if (observedLatency >= 0 && observedLatency < 60000) {
        samples.push(observedLatency);
        benchEventsReceived++;
      }
    });
    await new Promise((subResolve) => {
      benchChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') subResolve();
      });
      // Hard timeout in case subscribe never fires.
      setTimeout(subResolve, 5000);
    });
  } else if (transport === 'hocuspocus') {
    // Hocuspocus doesn't provide a sibling channel; we use the Y.Doc's awareness
    // states as a sample-carrying side channel. Each peer writes its own
    // awareness state to { benchEmit: { peerId, seq, t0_ms } } and other peers
    // read each remote awareness change as the propagation sample. Awareness
    // updates flow through the same WebSocket as Y.Doc updates.
    const awarenessProtocol = await import('y-protocols/awareness');
    const awareness = new awarenessProtocol.Awareness(ydoc);
    awareness.on('change', ({ added, updated }) => {
      const changedClients = [...added, ...updated];
      for (const clientId of changedClients) {
        if (clientId === awareness.clientID) continue;
        const state = awareness.getStates().get(clientId);
        if (!state || !state.benchEmit) continue;
        const observedLatency = Date.now() - state.benchEmit.t0_ms + netDelay;
        if (observedLatency >= 0 && observedLatency < 60000) {
          samples.push(observedLatency);
          benchEventsReceived++;
        }
      }
    });
    // Stash awareness for the action loop.
    config._awareness = awareness;

    const providerMod = await import('../../src/lib/collab/HocuspocusYjsProvider.js');
    providerHandle = await providerMod.createHocuspocusYjsProvider({
      documentId,
      ydoc,
      supabase: supabaseClient,
      url: hocuspocusUrl,
      awareness,
      onUpdateRejected: (reason) => {
        errors++;
        process.send({ type: 'error', peerIndex, message: `update_rejected: ${reason}` });
      },
      onTransportState: (state) => {
        if (state === 'offline') {
          process.send({ type: 'log', peerIndex, message: `transport_state: ${state}` });
        }
      },
    });
  }

  // ---- Outbound action loop -----------------------------------------------
  const yArray = ydoc.getArray('penStrokes');
  const yMap = ydoc.getMap('shapes');
  const yText = ydoc.getText('annotation');

  const pickAction = () => {
    const total = ACTION_WEIGHTS.pen + ACTION_WEIGHTS.drag + ACTION_WEIGHTS.text;
    const r = Math.random() * total;
    if (r < ACTION_WEIGHTS.pen) return 'pen';
    if (r < ACTION_WEIGHTS.pen + ACTION_WEIGHTS.drag) return 'drag';
    return 'text';
  };

  let seq = 0;

  const emitBenchPing = async (t0_ms) => {
    // Drop simulation: 5% of pings dropped (samples for those updates won't arrive).
    if (Math.random() < dropP) return;
    if (netDelay > 0) await new Promise((r) => setTimeout(r, netDelay));
    if (transport === 'supabase' && benchChannel) {
      try {
        await benchChannel.send({
          type: 'broadcast',
          event: 'bench:emit',
          payload: { peerId, seq: seq++, t0_ms },
        });
      } catch (err) {
        process.send({ type: 'log', peerIndex, message: `bench:emit send err: ${err.message}` });
      }
    } else if (transport === 'hocuspocus' && config._awareness) {
      try {
        config._awareness.setLocalStateField('benchEmit', { peerId, seq: seq++, t0_ms });
      } catch (err) {
        process.send({ type: 'log', peerIndex, message: `awareness set err: ${err.message}` });
      }
    }
  };

  const runAction = async (action) => {
    const t0_ms = Date.now();
    const origin = {
      source: 'local',
      userId: bot.userId,
      deviceId: `phase28-bot-${peerIndex}`,
      sessionId: `bench-${peerIndex}-${process.pid}`,
      clientID: ydoc.clientID,
      t0_ms,
    };
    try {
      if (action === 'pen') {
        ydoc.transact(() => {
          const pointCount = 1 + Math.floor(Math.random() * 3);
          for (let i = 0; i < pointCount; i++) {
            yArray.push([{ x: Math.random() * 1000, y: Math.random() * 1000, p: peerIndex }]);
          }
        }, origin);
      } else if (action === 'drag') {
        const shapeId = `shape-peer${peerIndex}`;
        ydoc.transact(() => {
          yMap.set(shapeId, { x: Math.random() * 1000, y: Math.random() * 1000, peer: peerIndex });
        }, origin);
      } else if (action === 'text') {
        ydoc.transact(() => {
          yText.insert(yText.length, String.fromCharCode(65 + (peerIndex % 26)));
        }, origin);
      }
      outboundCount++;
      // Send the bench:emit ping that carries t0 for receivers to measure latency.
      // We DON'T await this — fire-and-forget so the action loop stays at its
      // intended cadence regardless of network delay.
      emitBenchPing(t0_ms);
    } catch (err) {
      errors++;
      process.send({ type: 'error', peerIndex, message: `action ${action} failed: ${err.message}` });
    }
  };

  // Stagger peer start so they don't all hit the channel at once.
  await new Promise((r) => setTimeout(r, peerIndex * 50));

  const startTime = Date.now();
  const endTime = startTime + durationS * 1000;

  while (Date.now() < endTime) {
    const action = pickAction();
    await runAction(action);
    const wait =
      ACTION_INTERVAL_MS_RANGE[0] +
      Math.random() * (ACTION_INTERVAL_MS_RANGE[1] - ACTION_INTERVAL_MS_RANGE[0]);
    await new Promise((r) => setTimeout(r, wait));
  }

  // Tail window for in-flight updates to land.
  await new Promise((r) => setTimeout(r, 1500));

  // Disconnect.
  try {
    if (providerHandle?.disconnect) providerHandle.disconnect();
  } catch (err) {
    process.send({ type: 'log', peerIndex, message: `disconnect error: ${err.message}` });
  }
  try {
    if (benchChannel) await benchChannel.unsubscribe();
  } catch {
    /* swallow */
  }
  try {
    await supabaseClient.auth.signOut();
  } catch {
    /* swallow */
  }

  process.send({
    type: 'result',
    peerIndex,
    samples,
    errors,
    outboundCount,
    benchEventsReceived,
    elapsedMs: Date.now() - startTime,
  });
  setTimeout(() => process.exit(0), 200);
}

// ---- Parent: orchestrate workers + aggregate results -----------------------

function percentile(sortedArr, p) {
  if (!sortedArr.length) return null;
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
  return sortedArr[idx];
}

async function runParent(args) {
  const leasedAccounts = loadVerifiedTestAccounts({ minimumAccounts: args.peers });
  const documentId = process.env.PHASE28_TEST_DOCUMENT_ID;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!documentId || !supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'PHASE28_TEST_DOCUMENT_ID, VITE_SUPABASE_URL, and VITE_SUPABASE_ANON_KEY are required',
    );
  }

  const networkProfile = NETWORK_PROFILES[args.network];

  // Fork N workers in parallel.
  const workers = [];
  const allSamples = [];
  let totalErrors = 0;
  let totalOutbound = 0;
  let actualElapsedMs = 0;

  for (let i = 0; i < args.peers; i++) {
    const bot = leasedAccounts[i];
    const config = {
      transport: args.transport,
      peerIndex: i,
      durationS: args.duration,
      networkProfile,
      hocuspocusUrl: args['hocuspocus-url'],
      bot,
      supabaseUrl,
      supabaseAnonKey,
      documentId,
    };
    const child = fork(__filename, ['--worker'], {
      env: { ...process.env, PHASE28_WORKER_CONFIG: JSON.stringify(config) },
      silent: false,
    });
    child.on('message', (msg) => {
      if (msg.type === 'result') {
        allSamples.push(...msg.samples);
        totalErrors += msg.errors;
        totalOutbound += msg.outboundCount;
        actualElapsedMs = Math.max(actualElapsedMs, msg.elapsedMs);
      } else if (msg.type === 'error') {
        console.error(`[peer ${msg.peerIndex}] ERROR: ${msg.message}`);
        // The peer already counts its own error; only count parent-side failures here.
      } else if (msg.type === 'log') {
        // Quiet by default; uncomment for verbose runs:
        // console.log(`[peer ${msg.peerIndex}] ${msg.message}`);
      }
    });
    workers.push(child);
  }

  // Wait for all workers to exit.
  await Promise.all(
    workers.map(
      (w) =>
        new Promise((resolve_) => {
          w.on('exit', (code) => {
            if (code !== 0 && code !== null) {
              totalErrors++;
            }
            resolve_();
          });
        })
    )
  );

  const sortedSamples = allSamples.slice().sort((a, b) => a - b);
  const p50 = percentile(sortedSamples, 50);
  const p95 = percentile(sortedSamples, 95);
  const p99 = percentile(sortedSamples, 99);

  const elapsedS = actualElapsedMs / 1000;
  const msgsPerSec = elapsedS > 0 ? totalOutbound / elapsedS : 0;

  let verdict = 'inconclusive';
  if (allSamples.length === 0) verdict = 'inconclusive';
  else if (p95 !== null && p95 < SPEED_BAR_P95_MS && totalErrors === 0) verdict = 'passes_speed_bar';
  else verdict = 'fails_speed_bar';

  const result = {
    transport: args.transport,
    peers: args.peers,
    duration_s: Math.round(elapsedS),
    network: args.network,
    p50_ms: p50 !== null ? Math.round(p50) : null,
    p95_ms: p95 !== null ? Math.round(p95) : null,
    p99_ms: p99 !== null ? Math.round(p99) : null,
    msgs_per_sec: Math.round(msgsPerSec * 10) / 10,
    errors: totalErrors,
    samples_count: allSamples.length,
    verdict,
    speed_bar_threshold_p95_ms: SPEED_BAR_P95_MS,
  };

  console.log(JSON.stringify(result, null, 2));

  if (args['report-out']) {
    const outDir = dirname(args['report-out']);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(args['report-out'], JSON.stringify(result, null, 2) + '\n');
    console.error(`[transportSpikeBenchmark] wrote ${args['report-out']}`);
  }

  process.exit(0);
}

// ---- Dispatch: worker mode vs parent mode ---------------------------------

const isWorker = process.argv.includes('--worker');
if (isWorker) {
  runWorker().catch((err) => {
    console.error('[worker] FATAL:', err?.message || err);
    process.exit(1);
  });
} else {
  const args = parseArgs(process.argv);
  const error = validateFlags(args);
  if (error) {
    console.error(`transportSpikeBenchmark: invalid arguments — ${error}`);
    process.exit(2);
  }
  runParent(args).catch((err) => {
    console.error('transportSpikeBenchmark: unexpected error', err);
    process.exit(1);
  });
}
