// debug/scenarios/phase28-multi-peer-throttled.spec.mjs
// Phase 28 Plan 28-04 — Playwright wrapper for the multi-peer throttled-network benchmark.
//
// The benchmark itself is implemented in tests/phase28/transportSpikeBenchmark.mjs as a
// Node-driven harness that forks N peer workers, signs each in as a distinct bot, and
// drives a mixed pen-scribble + drag + text-typing load against the chosen transport.
// This spec wraps the harness as a Playwright test so it integrates with the project's
// existing debug:scenario infrastructure.
//
// Speed bar from 28-CONTEXT.md (LOCKED):
//   - 4-5 concurrent peers (dedicated test bot accounts per 2026-04-27 decision)
//   - Worst-case action mix: pen scribble + shape drag + text typing simultaneously
//   - Latency target: end-to-end propagation under 500ms (p95)
//   - Network conditions: throttled wifi (5 Mbps / 1 Mbps / 50ms RTT / 5% loss)
//
// CDP throttling note: Plan 28-04's harness uses a Node-level network simulator at
// the channel boundary instead of CDP-level throttling because the transport providers
// don't go through a CDP-controllable browser layer in the Node-driven harness.
// Same simulator is applied to BOTH transports for a fair comparison. See
// transportSpikeBenchmark.mjs header for the full architecture rationale.
//
// This spec is gated behind PHASE28_BENCHMARK_RUN=1 because each run takes minutes
// and exercises real Supabase Realtime traffic; it MUST NOT fire on every CI run.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe('Phase 28 — Multi-peer throttled-wifi p95 latency (speed bar)', () => {
  test.skip(
    !process.env.PHASE28_BENCHMARK_RUN,
    'Spike-only — set PHASE28_BENCHMARK_RUN=1 to run (each run uses real Supabase Realtime traffic)'
  );

  test('multi-peer-throttled-wifi-p95-under-500ms', async () => {
    // Spawn the harness as a child process. We use a short --duration here
    // (30s) so the test completes in a reasonable Playwright timeout window;
    // the full 5-minute spike runs are driven by Plan 28-04 Task 2 directly,
    // not via this Playwright wrapper.
    const tmp = mkdtempSync(join(tmpdir(), 'phase28-bench-'));
    const reportPath = join(tmp, 'supabase.json');

    const result = spawnSync(
      'node',
      [
        'tests/phase28/transportSpikeBenchmark.mjs',
        '--transport=supabase',
        '--peers=5',
        '--duration=30',
        '--network=throttled',
        `--report-out=${reportPath}`,
      ],
      {
        encoding: 'utf8',
        timeout: 90_000,
      }
    );

    expect(result.status, `harness exited ${result.status} — stderr: ${result.stderr}`).toBe(0);
    const json = JSON.parse(readFileSync(reportPath, 'utf8'));
    expect(json.samples_count, 'no propagation samples — bench:emit pings did not fan out').toBeGreaterThan(0);
    expect(json.errors, `expected 0 errors, got ${json.errors}`).toBe(0);
    expect(json.p95_ms, `p95 ${json.p95_ms}ms exceeds speed bar 500ms`).toBeLessThan(500);
  });
});
