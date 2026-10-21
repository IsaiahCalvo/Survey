-- Flag: agent annotation writes. Lets the WebMCP agent add, edit and delete
-- normal annotations (text notes first, shapes and callouts later). Off for
-- everyone until the tools are proven. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('annotation-agent', 'off', 'Agent annotation writes: WebMCP tools to add, edit and delete normal annotations.')
on conflict (key) do nothing;
