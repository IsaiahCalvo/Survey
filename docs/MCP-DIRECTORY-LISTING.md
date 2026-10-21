# Listing Survey's MCP connector in public directories

Survey runs a remote MCP server so AI tools (Claude, ChatGPT, scripts) can act
for a signed-in user. This note has everything you need to list that server in
a public MCP directory. **It does not submit anything** — it is the copy to
paste when you decide to.

Keep it in step with `public/auth.md` (the agent-facing docs) and the server at
`supabase/functions/survey-mcp/index.ts`. If the URL, auth or tool list below
drifts from those, those two win — fix this note.

## The facts to paste

| Field | Value |
| --- | --- |
| Name | `survey` |
| Title | Survey |
| Version | 1.0.0 |
| Server URL | `https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/survey-mcp` |
| Transport | MCP over HTTP POST (JSON-RPC, no session) |
| Homepage | https://surveytool.app/use-with-ai |
| Docs | https://surveytool.app/auth.md |
| Category | Productivity / Construction / PDF |
| Auth | OAuth 2.1 (authorization code + PKCE); dynamic client registration on |
| Contact | isaiahcalvo123@gmail.com |

**One-line description**

> Act in Survey for a signed-in user: find their construction-drawing PDFs and
> read the markup and survey items on each plan. Every call runs as that person,
> with their plan and their role, so an agent sees exactly their documents.

**Longer description**

> Survey (surveytool.app) is a PDF markup and counting app for construction and
> engineering drawings. Its MCP server lets an AI assistant work for a
> signed-in user: list their projects and documents, and read the survey items,
> checklists and answers on a plan. Sign-in is OAuth 2.1 — the person presses
> Allow on Survey's own consent screen, and the token acts as that person, with
> the same role on each document (a viewer only reads) and the same plan,
> enforced by the database. The person sees and removes agents at
> surveytool.app/agent-link. Tools are read-only today (write tools are added
> in the browser, as the signed-in person).

**Tools (read-only)**

- `list_projects` — the projects this user can see
- `list_documents` — the PDFs this user can see
- `list_survey_items` — the survey items on a document
- `find_survey_items` — search a document's items
- `get_survey_item` — one item's detail

## Where you might list it

Only the person who owns the account should submit. Pick any; none is required.

- **Official MCP registry** — https://registry.modelcontextprotocol.io
  (GitHub: `modelcontextprotocol/registry`). Publish with the `mcp-publisher`
  CLI and a `server.json` like the one below. This is the canonical list that
  other directories mirror.
- **Community directories** — Smithery (smithery.ai), PulseMCP (pulsemcp.com),
  mcp.so, Glama (glama.ai). Most pull from the official registry or take a short
  web form with the fields in the table above.

Survey needs **no API key handed out**: discovery and OAuth let a client sign
the user in on its own. Do not paste any `sb_secret…` or service-role key into a
directory — the only key a client needs is the public `apikey`, and it is
already in `public/auth.md`.

## server.json for the official registry

The registry publishes a remote server by URL — no package to ship. Adjust the
`$schema` version to the current registry schema before publishing.

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-07-09/server.schema.json",
  "name": "io.surveytool/survey",
  "description": "Act in Survey for a signed-in user: find their construction-drawing PDFs and read the markup and survey items on each plan. Runs as that person, with their plan and role.",
  "version": "1.0.0",
  "websiteUrl": "https://surveytool.app/use-with-ai",
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/survey-mcp"
    }
  ]
}
```

Publishing to the official registry needs ownership of a matching namespace
(for `io.surveytool/*`, a DNS TXT record on surveytool.app; or publish under a
`io.github.<user>/*` name you own). The `mcp-publisher` CLI walks you through
it. Do none of this until you want the listing live.

## Before you submit — a quick check

1. The server answers: `POST` an `initialize` JSON-RPC call to the URL returns
   `serverInfo` `{ "name": "survey", "title": "Survey", "version": "1.0.0" }`.
2. Unauthenticated calls return `401` with a `WWW-Authenticate: Bearer
   resource_metadata="…/.well-known/oauth-protected-resource"` header, so
   clients find the sign-in on their own.
3. The description and tool list here still match `public/auth.md`.
