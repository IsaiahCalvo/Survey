# Survey: sign-in for AI agents

Survey (https://surveytool.app) lets AI agents act for a signed-in user.

## In the browser (WebMCP)

If your agent runs inside the user's browser and the browser supports WebMCP,
Survey offers tools through `document.modelContext` while the user is signed in.
No extra sign-in is needed: tools act as that user.

## Outside the browser: user-claimed flow

Supported flows: `user_claimed` (the user confirms a code). Agent-verified
flows are not supported yet.

Scopes: `read` (one hour, read-only, the user can remove it at any time).

Endpoint: `POST https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/agent-auth`
with a JSON body.

1. Start: `{"action": "start", "agent_name": "<your agent's name>"}`
   Returns `device_code` (keep it secret), `user_code`, `verification_uri`,
   `verification_uri_complete`, `expires_in` (600) and `interval` (5).
2. Show the user `user_code` and send them to `verification_uri_complete`.
   They sign in to Survey and press Allow.
3. Every `interval` seconds: `{"action": "token", "device_code": "<device_code>"}`.
   Until the user allows it you get `authorization_pending`. After that you get
   `access_token` (starts with `sat_`), `token_type: Bearer`, `expires_in`, `scope`.
   Each device code gives one token. `expired_token` or `access_denied` means start over.
4. Check the token: `{"action": "whoami"}` with header
   `Authorization: Bearer <access_token>`.

Users see and remove agents at https://surveytool.app/agent-link.
