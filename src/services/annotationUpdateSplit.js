// src/services/annotationUpdateSplit.js
//
// Split one Yjs update into several smaller, valid updates (2026-09-24, w26).
//
// Why: every local Yjs transaction used to become ONE row in the annotation
// WAL (annotation_updates), and that same row is what Realtime pushes to every
// open screen. Importing a PDF's own markup (Package 2: 3,055 imported ink
// marks, ~17.9 MB) wrote one transaction per page, so single rows were 0.8 to
// 8.8 MB. Realtime could not carry them ("Unexpected end of array" on the
// other screens), tail reads that had to return them hit the database
// statement timeout, and the database itself went unhealthy. The old
// whole-object store had the same problem (7.9 MB for the same page); the
// per-field layout only added ~10%.
//
// The fix is at the append layer, so EVERY writer is covered (viewer capture,
// import, IndexedDB replay, recovery): an update over the byte budget is cut
// into parts that are each under it, and each part becomes its own WAL row.
//
// How: a V1 update is
//   [number of client blocks] then per block [struct count, client, first clock,
//   structs...] then a delete set.
// Every struct names its origin / right origin / parent by ABSOLUTE id (or a
// root-map name), so a run of consecutive structs of one client is a valid
// update on its own. Parts keep the original order; applying them in order
// gives exactly the state the whole update gives (tests prove it). Yjs also
// holds a part back until the part before it (same client, lower clock) has
// arrived, so a peer can never see a later part without the earlier ones.
//
// Cuts prefer the start of a NEW root entry (a struct whose parent is a root
// map name — e.g. a new mark in `marks`), so a peer applying the parts one by
// one sees whole marks appear, never half a mark. Only a single mark larger
// than the budget is cut inside itself (it then completes with the next part).
// The delete set rides with the LAST part, so nothing is removed before the
// structs that replace it exist.
//
// Pure module: imports only 'yjs'.

import * as Y from 'yjs';

// Realtime's Postgres-changes messages top out around 1 MB and the WAL row is
// sent as hex (2 characters per byte), so a 256 KB row is ~512 KB on the wire.
export const WAL_UPDATE_MAX_BYTES = 256 * 1024;

// Bytes reserved for a part's header (client-block counts, clocks, empty
// delete set) on top of its structs.
const PART_HEADER_RESERVE = 64;

function varUintBytes(value) {
  const out = [];
  let number = Math.floor(Number(value) || 0);
  while (number > 0x7f) {
    out.push(0x80 | (number & 0x7f));
    number = Math.floor(number / 128);
  }
  out.push(number & 0x7f);
  return out;
}

function concatBytes(chunks, totalLength) {
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function encodeStruct(struct) {
  const encoder = new Y.UpdateEncoderV1();
  struct.write(encoder, 0);
  return encoder.toUint8Array();
}

// V1 delete set: [client count] then per client [client, range count,
// (clock, len)...].
function encodeDeleteSet(clientsEntries) {
  const bytes = [...varUintBytes(clientsEntries.length)];
  for (const [client, ranges] of clientsEntries) {
    bytes.push(...varUintBytes(client), ...varUintBytes(ranges.length));
    for (const range of ranges) {
      bytes.push(...varUintBytes(range.clock), ...varUintBytes(range.len));
    }
  }
  return Uint8Array.from(bytes);
}

const EMPTY_DELETE_SET = Uint8Array.of(0);

// A run of entries -> one update (structs only) followed by `deleteSet`.
function encodePart(entries, deleteSet) {
  const blocks = [];
  let current = null;
  for (const entry of entries) {
    if (
      !current
      || current.client !== entry.client
      || current.nextClock !== entry.clock
    ) {
      current = { client: entry.client, clock: entry.clock, nextClock: entry.clock, items: [] };
      blocks.push(current);
    }
    current.items.push(entry.bytes);
    current.nextClock = entry.clock + entry.length;
  }
  const chunks = [Uint8Array.from(varUintBytes(blocks.length))];
  let total = chunks[0].length;
  for (const block of blocks) {
    const header = Uint8Array.from([
      ...varUintBytes(block.items.length),
      ...varUintBytes(block.client),
      ...varUintBytes(block.clock),
    ]);
    chunks.push(header);
    total += header.length;
    for (const bytes of block.items) {
      chunks.push(bytes);
      total += bytes.length;
    }
  }
  chunks.push(deleteSet);
  total += deleteSet.length;
  return concatBytes(chunks, total);
}

/**
 * Cut `update` (Yjs V1) into parts of at most `maxBytes` each, in apply
 * order. Returns [update] unchanged when it already fits or cannot be cut.
 * A single struct larger than the budget becomes its own (oversized) part —
 * one value cannot be split; callers keep bulky values small.
 */
export function splitYjsUpdate(update, maxBytes = WAL_UPDATE_MAX_BYTES) {
  const bytes = update instanceof Uint8Array ? update : new Uint8Array(update);
  const budget = Math.max(1024, Number(maxBytes) || WAL_UPDATE_MAX_BYTES);
  if (bytes.length <= budget) return [bytes];

  const decoded = Y.decodeUpdate(bytes);
  const entries = decoded.structs.map((struct) => ({
    client: struct.id.client,
    clock: struct.id.clock,
    length: struct.length,
    bytes: encodeStruct(struct),
    // A new root entry (parent is a root map's name): the preferred place to
    // cut, so a peer never sees half of a mark.
    rootEntry: struct instanceof Y.Item && typeof struct.parent === 'string',
  }));
  const deleteSet = encodeDeleteSet(
    [...decoded.ds.clients.entries()].filter(([, ranges]) => ranges.length > 0),
  );
  if (entries.length <= 1) return [bytes];

  const room = budget - PART_HEADER_RESERVE;
  const ranges = [];
  let start = 0;
  let size = 0;
  let lastRootEntry = -1;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (index > start && size + entry.bytes.length > room) {
      const cut = lastRootEntry > start ? lastRootEntry : index;
      ranges.push([start, cut]);
      start = cut;
      size = 0;
      lastRootEntry = -1;
      for (let carried = start; carried < index; carried += 1) {
        size += entries[carried].bytes.length;
        if (carried > start && entries[carried].rootEntry) lastRootEntry = carried;
      }
    }
    if (index > start && entry.rootEntry) lastRootEntry = index;
    size += entry.bytes.length;
  }
  ranges.push([start, entries.length]);

  const parts = ranges.map(([from, to], index) => encodePart(
    entries.slice(from, to),
    index === ranges.length - 1 ? deleteSet : EMPTY_DELETE_SET,
  ));
  // A large delete set that pushes the last part over the budget goes alone.
  const last = parts.length - 1;
  if (parts[last].length > budget && deleteSet.length > EMPTY_DELETE_SET.length) {
    const [from, to] = ranges[last];
    parts[last] = encodePart(entries.slice(from, to), EMPTY_DELETE_SET);
    parts.push(encodePart([], deleteSet));
  }
  return parts;
}
