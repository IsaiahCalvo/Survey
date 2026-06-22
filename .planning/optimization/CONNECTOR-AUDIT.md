# Connector Audit — Which Claude Connectors to Keep, Turn Off, or Replace with a CLI

_Last reviewed: 2026-06-07_

## The one distinction that decides almost everything

You work primarily through **Claude Code** (this terminal agent). Claude Code is
not the same product as the **Claude desktop app** or the **Claude web app**
(the chat windows). The vast majority of "connectors" exist to give those chat
interfaces abilities that **Claude Code already has natively**.

Claude Code, with no connector at all, can already:

- Read / write / edit any local file (native `Read` / `Write` / `Edit` tools)
- Run any shell command — bash, zsh, `git`, `npx`, build tools
- Run `osascript` / AppleScript from the shell → it can already drive macOS apps
- Search and fetch the web (native `WebSearch` / `WebFetch`)
- Drive a browser tab for testing via the already-installed **kapture** MCP

So for every connector below, the real question is:

> **Does Claude Code already do this? If yes, the connector only earns its keep
> when you're chatting in the desktop/web app instead of the terminal.**

### The second distinction: connector vs. CLI

A **connector (MCP server)** loads a whole menu of tools into the model's
context at *every session start* — that costs tokens on every single session,
forever, whether or not you use it. A **CLI** sits on disk and costs nothing
until Claude Code actually types the command. For services that ship a good CLI
(GitHub, Supabase, Vercel), the CLI is almost always the leaner choice for a
terminal-first workflow.

### Your actual stack

You use: **GitHub**, **Linear** (heavily), **Supabase** (via its CLI),
**Vercel** (via its CLI), and **kapture** (to drive your Electron app's browser
view for testing). You do **not** use ClickUp, Adobe, or Zoom for this project.

---

## Resolving your three "why do I have two of these?" confusions up front

**"Two for Chrome" — not duplicates, two genuinely different tools.**

- **Claude in Chrome** (Anthropic's official extension) attaches to *your real,
  logged-in Chrome* and works in a side panel — it sees the pages you're
  already browsing and can act in your authenticated sessions (your Gmail, your
  Linear, your GitHub, already signed in). It's an assistant riding shotgun in
  your everyday browser.
- **Control Chrome** is the generic "let Claude drive a Chrome tab" automation
  capability. For *testing your own app* that role is already filled by
  **kapture**, which drives a dedicated DevTools-connected tab.

  → If you want Claude to act inside your *existing logged-in* browser sessions,
  keep **Claude in Chrome**. For *driving/testing your app*, keep **kapture**.
  You do not need a third generic "Control Chrome" on top of those two.

**"Two for kapture" — true duplicate.** "kapture" and "Kapture Browser
Automation" are the **same** William Kapke Chrome-DevTools MCP server listed
twice (lowercase entry vs. the store display name). Keep **one**. The one wired
into your project (`mcp__kapture__*`) is the live one.

**"Two for Mac" — overlapping, pick one.** "Control your Mac" and the "Macos"
MCP are both community AppleScript/JXA bridges that let a *chat app* run Apple
events. They do the same category of thing. Claude Code already runs
`osascript` directly from the shell, so for terminal work you need **neither**.
If you ever want Mac control *from the desktop chat app*, keep just one.

**Do you need Desktop Commander or Filesystem at all?** No. Both exist to give
the *desktop chat app* terminal + file access. Claude Code has both natively and
better-integrated. They are pure redundancy for a terminal-first workflow.

---

## The full table (all 20)

Legend for **Native?**: does Claude Code already have this ability?

| # | Connector | What it does | Native in Claude Code? | Solid CLI alternative? | VERDICT | Why |
|---|-----------|--------------|------------------------|------------------------|---------|-----|
| 1 | **Adobe for creativity** | Adobe Firefly/Express image, video, document & asset generation/editing in the cloud | No | n/a | **Turn OFF (unused)** | You don't do creative/Adobe work in this project; huge tool menu burning context for nothing |
| 2 | **ClickUp** | Read/write ClickUp tasks, docs, time tracking, chat | No | n/a | **Turn OFF (unused)** | You track issues in Linear, not ClickUp |
| 3 | **Context7** | Injects up-to-date, version-specific library docs into context on demand | Partial (web search exists; this is cleaner for exact API docs) | n/a (it *is* the lean form) | **Your call — lean keep** | Genuinely useful for current React/PDF.js/Yjs API docs; only 2 tools so cheap. Note you also have it as a plugin already |
| 4 | **GitHub Integration** | Read/write repos, issues, PRs, Actions via GitHub's API | Partial (via `gh` + `git` in shell) | **Yes — `gh` CLI** | **Replace with CLI** | `gh` is already on disk, fully scriptable, zero per-session token cost. Connector only helps in desktop chat |
| 5 | **Gmail** | Search/read threads, draft, label email | No | n/a (Gmail API is awkward from CLI) | **Your call (desktop/web only)** | Claude Code can't read your Gmail; keep only if you actually triage mail *in the chat app* |
| 6 | **Google Calendar** | List/create/update calendar events, suggest times | No | n/a | **Your call (desktop/web only)** | Same as Gmail — useful only when chatting, not for building the app |
| 7 | **Linear** | Read/write Linear issues, projects, cycles, comments, docs | No (not native) | Community CLIs exist, no official one | **Keep as connector** | You use Linear heavily, Claude Code has no native Linear access, and there's no first-party CLI worth swapping to. This is a real keep |
| 8 | **Slack** | Read/post messages, search channels, canvases | No | n/a | **Turn OFF (unused)** | No Slack in this solo project's loop |
| 9 | **Zoom for Claude** | Search meetings, fetch recordings/transcripts | No | n/a | **Turn OFF (unused)** | You don't use Zoom for this project |
| 10 | **Claude in Chrome** (Anthropic ext.) | Side-panel assistant in your *real logged-in* Chrome; sees/acts on pages you browse | Partial (kapture drives a tab, but not your authed everyday session) | n/a | **Your call (desktop/web only)** | The one tool that taps your *existing logged-in* sessions. Keep if you want that; irrelevant to terminal building |
| 11 | **Control Chrome** | Generic "let Claude drive a Chrome tab" automation | Yes (kapture covers app-testing) | n/a | **Turn OFF (redundant)** | kapture already drives a tab for testing; Claude-in-Chrome covers your live session. This middle option is redundant |
| 12 | **Control your Mac** | Community AppleScript/JXA bridge to run Mac app automation from a chat app | Yes (`osascript` in shell) | n/a (it's shell) | **Turn OFF (redundant)** | Claude Code runs AppleScript directly; only a desktop-chat convenience |
| 13 | **Desktop Commander** | Gives the *desktop chat app* terminal control + file search/edit (community MCP) | Yes (this is literally Claude Code's core) | n/a | **Turn OFF (redundant)** | 100% overlap with Claude Code's native shell + file tools |
| 14 | **Filesystem** (reference MCP server) | Read/write local files within allowed dirs (Anthropic reference impl.) | Yes | n/a | **Turn OFF (redundant)** | Claude Code's native file tools are a strict superset |
| 15 | **kapture** | Local Chrome DevTools MCP — drive a tab, click, screenshot, read console/DOM, eval JS | (this IS your native browser-test tool) | n/a | **Keep as connector** | Your live tool for testing the Electron/PDF app's browser view. Keep |
| 16 | **Kapture Browser Automation** | Same William Kapke kapture server, store display name | — | n/a | **Turn OFF (duplicate of #15)** | Exact duplicate of kapture; keep only one entry |
| 17 | **Macos** (MCP) | Community AppleScript/JXA macOS control for a chat app | Yes (`osascript` in shell) | n/a | **Turn OFF (redundant)** | Same role as "Control your Mac" (#12); Claude Code already does this natively. Keep at most one, and only for desktop chat |
| 18 | **PDF Tools — Fill, Sign, Merge, Split, Extract** | Community MCP for PDF form-fill / sign / merge / split / text extract | Partial (you can do all this in-repo with pdf-lib/pdf.js + shell) | n/a (use your own libs) | **Turn OFF (redundant)** | You're *building* a PDF tool with pdf-lib/pdf.js already in the repo; Claude Code can script those directly. A generic PDF MCP adds nothing and could confuse intent |
| 19 | **Word (by Anthropic)** | Claude inside Microsoft Word — read/edit docs as tracked changes | No | n/a | **Turn OFF (unused)** | This is a Word add-in workflow, irrelevant to an Electron/React codebase |
| 20 | **Windows-MCP** | Computer-use automation for *Windows* (clicks, typing, UI) | No (and you're on macOS) | n/a | **Turn OFF (wrong OS)** | You're on Darwin/macOS; a Windows automation server can't run here |

---

## If you only ever work through Claude Code in the terminal — turn these OFF

These are redundant with Claude Code's native abilities, unused in this project,
or duplicates. Turning them off saves context tokens on every session:

- **Adobe for creativity** — unused, and it's one of the largest tool menus
- **ClickUp** — you use Linear, not ClickUp
- **GitHub Integration** — replaced by the `gh` CLI (see "Replace with CLI")
- **Slack** — not in your loop
- **Zoom for Claude** — not in your loop
- **Control Chrome** — redundant with kapture + Claude in Chrome
- **Control your Mac** — Claude Code runs AppleScript via `osascript` natively
- **Desktop Commander** — pure overlap with Claude Code's shell + file tools
- **Filesystem** — Claude Code's native file tools are a superset
- **Kapture Browser Automation** — duplicate of the `kapture` you already have
- **Macos** (MCP) — same AppleScript role; native via shell. Keep at most one for desktop chat
- **PDF Tools** — you build PDF features with your own libs; nothing to gain
- **Word (by Anthropic)** — Word add-in, irrelevant to this codebase
- **Windows-MCP** — Windows-only; you're on macOS

## Keep these

- **Linear** — heavy daily use, no native Claude Code access, no first-party CLI
  worth swapping to. A real keep.
- **kapture** — your live browser-test tool for the app. Keep exactly one
  kapture entry (turn off the duplicate "Kapture Browser Automation").
- **Context7** — lean (2 tools), gives current library API docs. Keep if you
  value version-correct React/PDF.js/Yjs syntax; harmless to drop. Note it also
  exists as a plugin in this project, so you may not need the connector form too.

## Replace with a CLI

- **GitHub Integration → `gh` CLI.** Already on disk, fully scriptable, zero
  per-session token cost. Keep the connector only if you also drive GitHub from
  the *desktop chat app*.
- (For reference, the same logic already applies to **Supabase** and **Vercel** —
  you're correctly using their official CLIs instead of connectors.)

## "Your call" — depends entirely on whether you use the desktop/web chat app

None of these help Claude Code build the app; they only matter when you're
chatting in the desktop or web Claude interface:

- **Gmail** — only if you triage email in the chat app
- **Google Calendar** — only if you manage your calendar in the chat app
- **Claude in Chrome** — the only tool that acts inside your *existing
  logged-in* browser sessions (your already-signed-in Gmail/Linear/GitHub).
  Keep if that's a workflow you want; it does something neither Claude Code nor
  kapture does.

---

## One-paragraph bottom line

For a terminal-first solo dev on macOS, the keep list is short: **Linear**
(connector — real, no good alternative), **kapture** (one copy — your browser
test harness), and optionally **Context7** (cheap, current docs). Swap **GitHub**
to the `gh` CLI. Everything else in your list is either redundant with Claude
Code's native shell/file/AppleScript/browser abilities (Desktop Commander,
Filesystem, Control your Mac, Macos, Control Chrome, the duplicate kapture),
unused in this project (Adobe, ClickUp, Slack, Zoom, Word), wrong-OS
(Windows-MCP), or better handled by your own repo libraries (PDF Tools) — so
turn them off to stop paying their token tax every session.

---

### Sources

- Desktop Commander — [github.com/wonderwhy-er/DesktopCommanderMCP](https://github.com/wonderwhy-er/DesktopCommanderMCP)
- Context7 — [github.com/upstash/context7](https://github.com/upstash/context7)
- kapture — [github.com/williamkapke/kapture](https://github.com/williamkapke/kapture)
- Claude in Chrome — [anthropic.com/news/claude-for-chrome](https://www.anthropic.com/news/claude-for-chrome), [code.claude.com/docs/en/chrome](https://code.claude.com/docs/en/chrome)
- "Control your Mac" / AppleScript MCPs — [github.com/steipete/macos-automator-mcp](https://github.com/steipete/macos-automator-mcp), [github.com/joshrutkowski/applescript-mcp](https://github.com/joshrutkowski/applescript-mcp)
- Windows-MCP — [github.com/CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP)
- Word / M365 by Anthropic — [support.claude.com/en/articles/14465370-use-claude-for-word](https://support.claude.com/en/articles/14465370-use-claude-for-word)
- PDF Tools — [github.com/Open-Document-Alliance/PDF-Tools](https://github.com/Open-Document-Alliance/PDF-Tools)
- Filesystem reference server — [github.com/modelcontextprotocol/servers/tree/main/src/filesystem](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem)
- Linear CLIs (community) — [github.com/schpet/linear-cli](https://github.com/schpet/linear-cli)
