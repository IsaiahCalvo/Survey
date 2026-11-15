-- Nightly flag 'mark-subject': every mark can carry its own subject (Properties
-- panel), shown in the Markups list and its CSV and written as /Subj on export.
INSERT INTO public.feature_flags (key, mode, description)
VALUES ('mark-subject', 'off', 'Marks: give any mark its own subject (Properties panel); shows in Markups and in exported PDFs')
ON CONFLICT (key) DO NOTHING;
