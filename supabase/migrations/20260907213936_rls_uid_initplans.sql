-- Applied live as 20260907213936. auth.uid() is constant for one statement. Evaluate it once through an
-- uncorrelated initplan, not once per candidate row. Preserve every policy's
-- roles, operation, permissiveness, row-dependent helpers and WITH CHECK.
-- Skip policies already using a uid initplan; never wrap row-dependent helpers.
SET lock_timeout = '3s';
SET statement_timeout = '30s';
DO $migration$
DECLARE
  p record;
  statement text;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname IN ('public', 'storage')
      AND (position('auth.uid()' in coalesce(qual, '')) > 0
        OR position('auth.uid()' in coalesce(with_check, '')) > 0)
      AND coalesce(qual, '') !~* 'SELECT\s+auth\.uid\(\)'
      AND coalesce(with_check, '') !~* 'SELECT\s+auth\.uid\(\)'
    ORDER BY schemaname, tablename, policyname
  LOOP
    -- pg_policies returns parsed expressions, but a literal could contain the
    -- function's spelling. Fail closed rather than change literal data.
    IF EXISTS (
      SELECT 1 FROM regexp_matches(concat_ws(' ', p.qual, p.with_check), $pattern$'(?:''|[^'])*'$pattern$, 'g') AS literal(parts)
      WHERE position('auth.uid()' in parts[1]) > 0
    ) THEN
      RAISE EXCEPTION 'Unexpected auth.uid() literal in policy %.%.%', p.schemaname, p.tablename, p.policyname;
    END IF;
    statement := format('ALTER POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    IF p.qual IS NOT NULL THEN
      statement := statement || ' USING (' || replace(p.qual, 'auth.uid()', '(select auth.uid())') || ')';
    END IF;
    IF p.with_check IS NOT NULL THEN
      statement := statement || ' WITH CHECK (' || replace(p.with_check, 'auth.uid()', '(select auth.uid())') || ')';
    END IF;
    EXECUTE statement;
  END LOOP;
END
$migration$;
RESET lock_timeout;
RESET statement_timeout;
