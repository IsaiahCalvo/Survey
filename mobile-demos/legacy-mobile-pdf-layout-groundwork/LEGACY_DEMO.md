# Legacy Mobile PDF Layout Groundwork

Status: preserved reference — not the current mobile app.

This snapshot came from `claude/eager-antonelli-819afe` at commit `16eb3b330f338a4531cb81f376297bee7b7e76aa`.
That branch already includes all work from `claude/nifty-burnell-c66ee5`.

Keep it because:

- Its PDF viewer layout may be better groundwork for future mobile design.
- It includes native PDF rendering and drawing interaction experiments.
- It demonstrates drawing, selecting, deleting, panning, and zooming on a native PDF surface.
- Its native iOS PDF rasterizer and one-renderer architecture were device-tested groundwork.

Do not treat it as current because:

- It has no homepage.
- Some colors are wrong or outdated.
- Its layout and behavior differ from the current mobile demo.
- It uses a sample PDF and is not connected to current project data or sync.

The current mobile demo remains at [`../../mobile-expo-go`](../../mobile-expo-go).

Reference screenshots are in [`reference`](./reference).
The original architecture research, device-test handoff, and desktop-to-mobile annotation roadmap are in [`docs`](./docs).
