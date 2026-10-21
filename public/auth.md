# Survey: sign-in for AI agents

Survey (https://surveytool.app) lets AI agents act for a signed-in user.

## In the browser (WebMCP)

If your agent runs inside the user's browser and the browser supports WebMCP,
Survey offers tools through `document.modelContext` while the user is signed in.
No extra sign-in is needed: tools act as that user, with that user's plan and
that user's role on each document. Every write goes through the same path as a
human tap (so sync, Excel rows, auto-entity and role checks all apply), and a
viewer's agent can read but not write. (The user can turn WebMCP off with
`localStorage['survey.webmcp'] = 'off'`.)

Always there:

- `survey_whoami` — whether the agent is signed in, and the user's plan.
- `survey_list_projects` — the projects this user can see.
- `survey_list_documents` — the PDFs this user can see (optionally one project).
- `survey_get_document_role` — this user's role on a document (owner/editor/viewer).
- `survey_get_open_document` — the open PDF's page count and the page on screen.
- `survey_go_to_page` — scroll the open PDF to a page.

With a PDF open in Survey mode and a template chosen:

- `survey_add_marker` — add a Survey marker box (editor/owner).
- `survey_list_markers` — list the markers on the plan: id, page, name, box.
- `survey_edit_marker` — move or resize a marker's box by id (editor/owner).
- `survey_delete_marker` — delete a marker and its item answers by id
  (editor/owner). It does nothing unless you pass `confirm: true`, which you
  should set only after the person has agreed; the marker is kept in trash for
  30 days and the last change can be undone.
- Survey item tools: `survey_get_context` (categories, checklists, answers,
  entities), `survey_find_items`, `survey_get_item` (all read),
  `survey_set_answers`, `survey_add_note`, `survey_set_entity` (editor/owner)
  and `survey_show_item`.
- `survey_add_photo` — attach a photo to an item (editor/owner). A browser
  agent has no file to drop, so pass the image as base64 (a `data:` URL is
  fine); the limit is 20MB. The photo is added to the item's note and one Undo
  takes it back.
- `survey_export` — a plain-text summary of the survey counts to hand to the
  person: each category with how many items it has, and the breakdown by
  status (read). It is a summary, not a spreadsheet file; the Excel export
  stays a person-only action in the app.

Marker and item ids are shared: an id from `survey_find_items` or
`survey_list_markers` works with the edit, delete and item tools alike.

Behind the `annotation-agent` flag (off until the tools are proven), the agent
can also write normal annotations — text notes, shapes, callouts and
highlights. These write through the same path as a human edit, so sync, Excel
and the user's role all apply, and one Undo takes a change back. Each add tool
returns the new annotation's id, so `survey_delete_annotation` can take an add
back:

- `survey_list_annotations` — list the normal annotations on the open PDF (text
  notes, shapes, highlights — not Survey markers): id, page, type, text and box.
- `survey_add_text_note` — add a text note at a page point (editor/owner). Give
  the page, the top-left corner in PDF points, the text, and optionally a wrap
  width and hex color. The box fits its text.
- `survey_edit_text_note` — change a text note's text by id (editor/owner). Only
  a note the person could edit by hand changes.
- `survey_delete_annotation` — delete a normal annotation by id (editor/owner).
  It does nothing unless you pass `confirm: true`, which you should set only
  after the person has agreed; one Undo restores it.
- `survey_add_rectangle` / `survey_add_ellipse` — draw a shape from a page box
  (top-left corner in PDF points, a width and a height), with an optional hex
  stroke color, hex fill color and stroke width (editor/owner).
- `survey_add_line` — draw a straight line or arrow between two page points;
  set `arrow` true for an arrowhead (editor/owner).
- `survey_add_polygon` — draw a polygon (closed, 3+ points) or polyline (open,
  `closed: false`, 2+ points) from a list of page points (editor/owner).
- `survey_add_callout` — add a text box with a leader line pointing at a page
  spot: the text, the arrow point and the box corner, with optional box width
  and colors (editor/owner).
- `survey_add_highlight` — highlight a run of text on a page (editor/owner).
  Give the page and the words to highlight; Survey finds them in the page text
  (matching ignores case and extra spaces, and a phrase that wraps across lines
  still matches) and highlights them, with an optional hex color and opacity. If
  the words repeat, `occurrence` picks which one. A scanned page needs text
  recognition run on it first.
- `survey_edit_callout` — change a callout's text and/or its colors by id
  (editor/owner). A text change re-fits the box.
- `survey_recolor_highlight` — change a highlight's color and/or opacity by id
  (editor/owner); it recolors the whole highlighted run.
- `survey_delete_annotation` removes the rectangle/ellipse/line/polygon shapes,
  highlights and callouts too, by id (editor/owner, confirm-first).

## Outside the browser: user-claimed flow

Supported flows: `user_claimed` (the user confirms a code). Agent-verified
flows are not supported yet.

Scopes: `read` (read-only; the user can remove the agent at any time).

Endpoint: `POST https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/agent-auth`
with a JSON body.

1. Start: `{"action": "start", "agent_name": "<your agent's name>"}`
   Returns `device_code` (keep it secret), `user_code`, `verification_uri`,
   `verification_uri_complete`, `expires_in` (600) and `interval` (5).
2. Show the user `user_code` and send them to `verification_uri_complete`.
   They sign in, or create a free account there if they have none (Survey
   checks their email), and press Allow. The account always belongs to the
   person: agents never get an account of their own.
3. Every `interval` seconds: `{"action": "token", "device_code": "<device_code>"}`.
   Until the user allows it you get `authorization_pending`. After that you get
   `access_token` (starts with `sat_`, lasts one hour), `refresh_token` (starts
   with `srt_`, lasts 30 days), `token_type: Bearer`, `expires_in`, `scope`.
   Each device code gives one token. `expired_token` or `access_denied` means start over.
   When the access token runs out: `{"action": "refresh", "refresh_token": "<refresh_token>"}`
   returns a new pair. Each refresh token works once. `invalid_grant` means the
   person removed the agent or 30 days passed: start over.
4. Check the token: `{"action": "whoami"}` with header
   `Authorization: Bearer <access_token>`.

Users see and remove agents at https://surveytool.app/agent-link.

## Outside the browser: act as the person (OAuth 2.1)

Survey is an OAuth 2.1 server (authorization code with PKCE). After the person
signs in and presses Allow on Survey's consent screen, your token works as
that person: the same role on each document and the same plan, enforced by
the database itself.

- Discovery: `https://cvamwtpsuvxvjdnotbeg.supabase.co/.well-known/oauth-authorization-server/auth/v1`
- Authorize: `https://cvamwtpsuvxvjdnotbeg.supabase.co/auth/v1/oauth/authorize`
  (the person lands on `https://surveytool.app/oauth/consent`; they can create
  a free account there first)
- Token: `https://cvamwtpsuvxvjdnotbeg.supabase.co/auth/v1/oauth/token`
- Scope: leave it out or ask for `email`. Don't ask for `openid`.
- Data: `https://cvamwtpsuvxvjdnotbeg.supabase.co/rest/v1/` with headers
  `Authorization: Bearer <access_token>` and
  `apikey: sb_publishable_TbwXDm3ybv24oQMBMxlUfQ_kcJ_Byrx` (Survey's public key).

The person sees and removes agents at https://surveytool.app/agent-link.
Removing one takes effect at once: its next request gets HTTP 403 and its
refresh token stops working. Start over to be let in again.

### Optional: show who you are with AgentID

If you have an AgentID (AgentMail), you can show it once you're let in. It
never grants access: only the person's Allow does that. The person then sees
your AgentID and your owner next to your name on /agent-link.

1. `GET https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/agent-identity`
   with your Survey `Authorization: Bearer <access_token>`. It returns the
   AgentID `client_id` (`https://surveytool.app`) and `redirect_uri`
   (`https://surveytool.app/agentid/callback`).
2. Sign in to AgentID with those (authorization code + PKCE S256, scope
   `openid email profile`). Your browser lands on the redirect page; read the
   `code` from its address and exchange it at `https://auth.agentid.com/v0/token`
   for an `id_token` (it lasts 10 minutes).
3. `POST` the same URL with `{"id_token": "..."}`. Survey checks the signature,
   issuer, audience and expiry, and records it.

## Outside the browser: remote MCP server

For agents that speak MCP (Claude and ChatGPT connectors, scripts):

- Server URL: `https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/survey-mcp`
  (MCP over HTTP POST, JSON-RPC, no session).
- Sign-in: the OAuth 2.1 flow above. Without a token the server answers 401
  with `WWW-Authenticate: Bearer resource_metadata="<server URL>/.well-known/oauth-protected-resource"`,
  which points to Survey's authorization server, so MCP clients find the sign-in
  on their own. Dynamic client registration is on.
- Read tools (always): `list_projects`, `list_documents`,
  `list_survey_items`, `find_survey_items`, `get_survey_item`,
  `get_document_role` (this person's role on a document) and
  `get_survey_context` (a document's survey template: categories, checklist
  items and entities).
- Write tools (`set_answers`, `add_note`) appear only when the person turned on
  survey changes for the connector and let this agent make changes (otherwise
  the connector is read-only). They act as the person with the person's role:
  - `set_answers` — set checklist answers on one item (editor or owner). Pass
    the item id and a list of `{ checklist_item_id, value }`; only the items you
    list change. Use the checklist item ids from `get_survey_context` and the
    template's own answer values.
  - `add_note` — add text to the end of one item's note (editor or owner). It
    never removes what is already there, and one Undo in the app takes it back.
  Both write through the document's live collaboration state, so an open app
  converges to the change. A viewer's agent, or a read-only agent, cannot write.
- Every call runs as the person, so the agent sees exactly their documents.

In Claude: Settings > Connectors > Add custom connector, paste the server URL.

## Rules for agents

- An agent acts for one person and has exactly that person's rights: the same
  role on each document (a viewer's agent can only read) and the same plan.
- Agents cannot pay, change plans, delete the account, use the person's linked
  accounts, let other agents in, or change the person's email or password.
