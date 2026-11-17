-- Nightly flag onedrive-file-handler (KAL-703): "Open in Survey" on a PDF in
-- OneDrive or SharePoint on the web opens it in Survey, linked to save back.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('onedrive-file-handler', 'off', 'Open in Survey from OneDrive and SharePoint on the web.')
ON CONFLICT (key) DO NOTHING;
