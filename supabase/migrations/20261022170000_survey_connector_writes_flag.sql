-- Flag: survey connector writes. Lets the outside MCP connector (Claude and
-- ChatGPT remote MCP, scripts signed in through survey-mcp OAuth) make survey
-- changes — set checklist answers and add to an item's note — as the person,
-- when the person granted the agent write access (#1034). Off for everyone
-- until the server-side write path is proven. Keep in step with
-- src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('survey-connector-writes', 'off', 'Outside MCP connector may make survey changes (set answers, add notes) through the server-side CRDT write path.')
on conflict (key) do nothing;
