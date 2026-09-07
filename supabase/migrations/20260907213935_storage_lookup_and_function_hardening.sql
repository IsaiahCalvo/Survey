-- Applied live as 20260907213935. The private Storage read policy joins documents.file_path = objects.name.
-- Live EXPLAIN showed a full documents scan; a path lookup must not scan PDFs'
-- metadata or invoke document permission helpers for unrelated rows.
SET lock_timeout = '3s';
SET statement_timeout = '30s';
CREATE INDEX IF NOT EXISTS idx_documents_file_path ON public.documents (file_path);

-- Pure interval helper: preserve its body, volatility, owner and EXECUTE grants.
ALTER FUNCTION public.archive_retention_interval() SET search_path = '';

RESET lock_timeout;
RESET statement_timeout;
