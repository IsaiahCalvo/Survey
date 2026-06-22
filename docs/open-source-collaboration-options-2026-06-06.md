# Open-source / self-hosted collaboration options for Survey

Date: 2026-06-06
Prompt: Find non-Liveblocks paid alternatives, including tldraw sync demo.

## Recommendation

Use **Hocuspocus + Yjs Awareness + Supabase Postgres persistence** as the best serious open-source/self-hosted path.

For a faster proof of concept, use **y-websocket** first, but expect to build more auth, persistence, scaling, and observability yourself.

Do **not** treat tldraw's `sync-demo` as the answer. It is useful inspiration, but the hosted demo is prototype-only and tldraw's SDK/sync packages are not simple free-for-production OSS.

## tldraw sync findings

The example at `https://tldraw.dev/examples/sync-demo` uses:

```tsx
const store = useSyncDemo({ roomId })
return <Tldraw store={store} />
```

`useSyncDemo` connects to tldraw's hosted demo worker at `https://demo.tldraw.xyz`.

Official/source caveats:

- Demo data is temporary, deleted after about a day.
- Rooms are public to anyone with the room ID.
- Global shared namespace.
- File uploads disabled on production tldraw domains to prevent abuse.
- Production requires hosting sync yourself.

Production/self-hosting paths:

- Recommended official backend: Cloudflare Workers + Durable Objects + R2.
- Custom backend possible through `@tldraw/sync-core` in any JS WebSocket environment.
- Simple server examples use `TLSocketRoom` and SQLite-style storage.

Important licensing point:

- Starter/templates are MIT.
- The tldraw SDK packages (`tldraw`, `@tldraw/sync`, `@tldraw/sync-core`) use the tldraw license, not MIT.
- Development use is free, but production/commercial use requires the appropriate tldraw license key.

Fit for Survey:

- Good only if we want to adopt tldraw's canvas/store/sync model for annotations.
- Not a drop-in replacement for Survey's existing Supabase + Yjs annotation system.
- tldraw sync is server-authoritative tldraw-record sync, not Yjs CRDT sync.

## Best options compared

### Hocuspocus

Best serious choice.

- MIT licensed.
- Yjs-native.
- Self-hostable Node/WebSocket server.
- Supports Yjs Awareness for presence/cursors/selections.
- Has auth/authorization hooks.
- Has database persistence extension hooks.
- Can persist to Survey's existing Supabase tables: `annotation_updates` and `annotation_snapshots`.

Architecture:

```text
Survey React/Electron client
  Y.Doc + Awareness
  @hocuspocus/provider over WebSocket
        ↓
Self-hosted Hocuspocus Node service
  Supabase JWT auth + document permission check
  append Yjs updates / compact snapshots
        ↓
Supabase Postgres
  annotation_updates / annotation_snapshots
```

### y-websocket

Best tiny prototype.

- MIT licensed.
- Official/simple Yjs WebSocket transport.
- Supports Awareness.
- Memory-only by default.
- Persistence possible with custom `setPersistence({ bindState, writeState })`.

Downside: less production-ready than Hocuspocus; we would build auth, persistence, lifecycle, metrics, horizontal scaling, and failure handling ourselves.

### PartyKit / PartyServer

Good per-room multiplayer architecture, but practically tied to Cloudflare Durable Objects. Useful if we want Cloudflare, less ideal if the goal is normal self-hosting.

### ElectricSQL / PGlite

Good Postgres/local-first read sync, not a Liveblocks replacement. Does not provide Yjs room presence/cursors by itself.

### Replicache / Zero

Good app-data sync direction, but not a direct Yjs annotation collaboration backend. Too much architecture change for the first prototype.

### Automerge

Good CRDT alternative, but we already have Yjs. Switching CRDT libraries is unnecessary.

### Jazz

Interesting local-first stack, but not naturally Supabase/Postgres/Yjs-native. Too large a shift.

### ShareDB

Mature self-hosted OT backend with Postgres adapter, but it would replace Yjs with OT. Not first choice.

## Survey repo-specific notes

Survey already has two collaboration paths:

1. Older `YDocProvider` + `SupabaseYjsProvider`
   - File: `src/components/collab/YDocProvider.jsx`
   - Transport: `src/lib/collab/SupabaseYjsProvider.js`
   - Uses Supabase Realtime Broadcast channel `yjs:<documentId>`.
   - Live transport only; local IndexedDB persistence via `ydocLifecycle.js`.

2. New annotation persistence engine
   - File: `src/services/annotationDocSync.js`
   - Hook: `src/hooks/useAnnotationDoc.js`
   - Tables: `annotation_updates`, `annotation_snapshots`
   - Uses Yjs + y-indexeddb + Supabase op-log/snapshots.
   - Uses Supabase Realtime `postgres_changes` on `annotation_updates` for live remote updates.

Best prototype target: the new `annotationDocSync` engine, not the older raw `YDocProvider` path.

## Minimal prototype plan

1. Add Hocuspocus or y-websocket server.
2. Keep Supabase as durable persistence:
   - load latest `annotation_snapshots`
   - replay `annotation_updates`
   - append local updates
   - compact snapshots
3. Replace live fan-out only:
   - turn off Supabase Realtime subscription when websocket transport is enabled
   - use websocket for low-latency Yjs updates and Awareness
4. Add origin filtering so remote websocket updates are not re-appended into Supabase by every receiving client.
5. Gate behind env:
   - `VITE_YJS_TRANSPORT=supabase|websocket|hocuspocus`
   - `VITE_YJS_WS_URL=ws://localhost:1234`
6. Acceptance test:
   - two clients open same document
   - client A draws one mark
   - client B sees it live
   - Supabase `annotation_updates` gets one row, not duplicate rows
   - websocket server off + reload still hydrates from Supabase snapshot/tail

## Decision

Pick Hocuspocus for production-ish self-hosted collaboration. Use y-websocket only if we want a very fast spike. tldraw sync is interesting, but it is not the clean open-source Liveblocks replacement for this app unless we intentionally adopt tldraw's editor/store model and accept its production licensing.
