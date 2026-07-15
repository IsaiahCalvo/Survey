# Clips: record a Survey bug for an agent

Clips complements the automated debugging pipeline: Isaiah supplies synchronized
video, narration, console errors, and redacted fetch/XHR timing; the agent pairs
that evidence with Survey source and a deterministic repro. Video alone is not a
diagnosis.

## One-time local setup

1. Start Clips:

   ```sh
   cd /Users/isaiahcalvo/Documents/Projects/Active/survey-clips
   pnpm dev
   ```

   Open `http://127.0.0.1:8094`. The app binds only to this Mac and stores app
   data in `data/app.db` (SQLite).

2. Connect video storage at `http://127.0.0.1:8094/record`. Choose **Use
   Builder.io (free)** for the shortest setup, or **configure S3-compatible
   storage** for S3/R2/Spaces/MinIO. Clips will not finish an upload until one is
   connected.

3. Install the local Chrome extension:

   - Open `chrome://extensions`, enable **Developer mode**, choose **Load
     unpacked**, and select
     `/Users/isaiahcalvo/Documents/Projects/Active/survey-clips/chrome-extension/dist`.
   - The unpacked build is preconfigured for `http://127.0.0.1:8094`. In
     **Details → Extension options**, verify that URL and leave **Developer
     logs** enabled.
   - When Chrome/macOS asks, allow screen recording and the microphone. Camera
     is optional.

Rebuild the extension after scaffold updates with `pnpm chrome:build`, then use
**Reload** on `chrome://extensions`.

## Record a useful clip

1. Open Survey on `http://localhost:5173` and navigate to the state immediately
   before the bug.
2. Click the Clips extension from that Survey tab. Keep **Developer logs** on.
3. Narrate the build/runtime, document type, page, zoom, active tool, and exact
   expected result. Perform one minimal repro; pause briefly when the defect is
   visible.
4. Stop and save. Title it `Survey — <bug> — <scenario> — <date>`.
5. Wait for the transcript. Open **Share → Share with agents → Copy** to create a
   private, recording-scoped agent link (expires after two hours), then paste
   that link into the coding task.

The extension captures bounded, redacted console output plus fetch/XHR method,
sanitized URL, status, duration, and failures. It does not capture headers,
cookies, request/response bodies, or query values. Still avoid showing customer
documents, tokens, or unrelated private tabs.

## How an agent consumes it

1. Open the supplied link and discover `/api/agent-context.json?id=<id>`.
2. Read `/api/agent-transcript.json?id=<id>` for the timestamped narration.
3. Pull `/api/agent-frame.jpg?id=<id>&atMs=<ms>` around the reported defect and
   inspect `browserDiagnostics` for console/network correlation.
4. If transcription is pending, retry after 15–30 seconds several times.
5. Reproduce in Survey, correlate the common timeline with source/debug events,
   then preserve only the useful frames, timestamps, logs, and findings in the
   bug's normal debug bundle.

This is capture layer v1. Playwright traces, performance streams, and structured
`debug_runs/` bundles remain the reproducible automation layer described in the
Obsidian **Debugging Pipeline Spec**.
