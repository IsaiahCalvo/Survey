-- Nightly flag 'paper-overlays' (Drawboard Projects parity VT-46): a Paper
-- button on the viewer's rail lays a paper pattern (notebook rules, graph,
-- isometric and hex grids, music staves) over every page, above the PDF and
-- under the marks. View only, never saved or exported. Beta, so only Survey
-- Nightly shows it; the row starts off.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('paper-overlays', 'off', 'Viewer: Paper button lays notebook, graph, isometric, hex or music paper over every page')
ON CONFLICT (key) DO NOTHING;
