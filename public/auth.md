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

Marker and item ids are shared: an id from `survey_find_items` or
`survey_list_markers` works with the edit, delete and item tools alike.

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
- Tools (read-only for now): `list_projects`, `list_documents`,
  `list_survey_items`, `find_survey_items`, `get_survey_item`.
- Every call runs as the person, so the agent sees exactly their documents.

In Claude: Settings > Connectors > Add custom connector, paste the server URL.

## Rules for agents

- An agent acts for one person and has exactly that person's rights: the same
  role on each document (a viewer's agent can only read) and the same plan.
- Agents cannot pay, change plans, delete the account, use the person's linked
  accounts, let other agents in, or change the person's email or password.
