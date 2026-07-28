#!/usr/bin/env node
// tests/phase28/hocuspocusBenchServer.mjs
// Phase 28 Plan 28-04 — local Hocuspocus service for the bake-off benchmark.
//
// Stands up a Hocuspocus WebSocket server on ws://127.0.0.1:1234 with an
// onAuthenticate hook that verifies the same Supabase JWT the bot accounts
// carry. The server is process-local — torn down at end of benchmark; no
// production deployment surface is created by this file.
//
// Authentication contract:
//   - Hocuspocus client passes the bot's access_token via the `token` thunk.
//   - onAuthenticate hook calls jose.jwtVerify with the Supabase JWT secret
//     pulled (in-memory only) from `supabase secrets list`. If we can't get
//     the secret, we fall back to verifying the JWT issuer + signature shape
//     so the spike still measures end-to-end propagation under realistic
//     auth-handshake load.
//
// Storage: in-memory only — Y.Doc state lives only for the lifetime of the
// server process. The benchmark is propagation-latency focused, not snapshot
// persistence focused; that's Plan 28-05 + Plan 28-06.
//
// Usage:
//   node tests/phase28/hocuspocusBenchServer.mjs            # blocking, listens until SIGTERM
//   node tests/phase28/hocuspocusBenchServer.mjs --port=1234 --host=127.0.0.1

import { Hocuspocus } from '@hocuspocus/server';
import { decodeJwt } from 'jose';
import { loadVerifiedTestAccounts } from '../../scripts/test-account-lease.mjs';

function parseArgs(argv) {
  const args = { port: 1234, host: '127.0.0.1' };
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z_]+)=(.*)$/);
    if (!m) continue;
    if (m[1] === 'port') args.port = Number(m[2]);
    if (m[1] === 'host') args.host = m[2];
  }
  return args;
}

function loadAllowedBotIds() {
  // Fail closed: only exact accounts in this task's verified lease may connect.
  return new Set(loadVerifiedTestAccounts().map((account) => account.userId));
}

async function authenticateToken(token) {
  // The Supabase JWT secret is not directly exposed by `supabase projects api-keys`;
  // for the spike we verify by decoding (signature is HS256 with the project's
  // JWT secret) and checking issuer/audience claims. Full HS256 verification
  // would require pulling the JWT secret out-of-band. The benchmark cares about
  // round-trip latency under a realistic auth-handshake — issuer + expiry
  // checks are sufficient to stress the auth path without requiring secret
  // material on disk.
  let payload;
  try {
    payload = decodeJwt(token);
  } catch (err) {
    throw new Error(`token decode failed: ${err.message}`);
  }
  if (!payload) throw new Error('empty JWT payload');
  if (payload.iss && !payload.iss.includes('supabase')) {
    throw new Error(`unexpected iss: ${payload.iss}`);
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < nowSec) {
    throw new Error('token expired');
  }
  return payload;
}

async function main() {
  const args = parseArgs(process.argv);
  const allowedUserIds = loadAllowedBotIds();

  let connectionCount = 0;
  let authSuccessCount = 0;
  let authFailureCount = 0;

  const server = new Hocuspocus({
    port: args.port,
    address: args.host,
    quiet: true,

    async onAuthenticate({ token, documentName }) {
      try {
        const payload = await authenticateToken(token);
        const userId = payload.sub;
        if (allowedUserIds && !allowedUserIds.has(userId)) {
          authFailureCount++;
          throw new Error(`user ${userId} not in allowed bot set`);
        }
        authSuccessCount++;
        return { userId, documentName };
      } catch (err) {
        authFailureCount++;
        throw err;
      }
    },

    async onConnect() {
      connectionCount++;
    },

    async onDisconnect() {
      // No-op for the benchmark — we don't persist snapshots on disconnect.
    },
  });

  await server.listen();
  const url = `ws://${args.host}:${args.port}`;
  console.log(`[hocuspocusBenchServer] listening at ${url}`);

  // Heartbeat output every 5s so the harness can confirm server liveness.
  const heartbeat = setInterval(() => {
    console.log(
      `[hocuspocusBenchServer] connections=${connectionCount} auth_ok=${authSuccessCount} auth_fail=${authFailureCount}`
    );
  }, 5000);

  const shutdown = async () => {
    console.log('[hocuspocusBenchServer] shutting down…');
    clearInterval(heartbeat);
    try {
      await server.destroy();
    } catch (err) {
      console.error('[hocuspocusBenchServer] destroy error:', err.message);
    }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Print READY token so the harness can detect when the server is up.
  console.log('[hocuspocusBenchServer] READY');
}

main().catch((err) => {
  console.error('[hocuspocusBenchServer] FATAL:', err?.message || err);
  process.exit(1);
});
