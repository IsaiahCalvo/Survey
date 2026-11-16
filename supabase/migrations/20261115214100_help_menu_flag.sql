-- Nightly flag 'help-menu': "Help & support" in the account menu (start
-- guide, stuck-page fix, links to the site's FAQ, status and What's new pages,
-- version). Beta, so only Survey Nightly shows it; the row starts off.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('help-menu', 'off', 'Account menu: Help & support (start guide, stuck-page fix, help pages, version)')
ON CONFLICT (key) DO NOTHING;
