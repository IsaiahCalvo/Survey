# Survey: sign-in for AI agents

Survey (https://surveytool.app) lets AI agents act for a signed-in user.

## In the browser (WebMCP)

If your agent runs inside the user's browser and the browser supports WebMCP,
Survey offers tools through `document.modelContext` while the user is signed in.
No extra sign-in is needed: tools act as that user.

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

## Rules for agents

- An agent acts for one person and has exactly that person's rights: the same
  role on each document (a viewer's agent can only read) and the same plan.
- Agents cannot pay, change plans, or change the person's email or password.
