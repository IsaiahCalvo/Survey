-- Remove a redundant documents(user_id) index only when PostgreSQL proves
-- that the intentional Phase 28 owner-lookup index is an exact safe survivor.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $cleanup$
DECLARE
  duplicate_oid oid;
  survivor_oid oid;
  exact_duplicate boolean := false;
BEGIN
  -- Keep later index-relation lock waits bounded even when a migration runner
  -- sends the surrounding SET statement in a separate transaction.
  PERFORM pg_catalog.set_config('lock_timeout', '3s', true);
  IF to_regclass('public.documents') IS NULL THEN
    RETURN;
  END IF;

  -- NOWAIT bounds the table lock. Resolve names only after it. PostgreSQL can
  -- still rename an index while this heap lock is held, so the exact OID
  -- postcondition below is also required.
  LOCK TABLE public.documents IN ACCESS EXCLUSIVE MODE NOWAIT;
  duplicate_oid := to_regclass('public.idx_documents_user_id');
  survivor_oid := to_regclass('public.documents_user_id_idx');
  IF duplicate_oid IS NULL OR survivor_oid IS NULL OR duplicate_oid = survivor_oid THEN
    RETURN;
  END IF;

  SELECT
    duplicate_ns.nspname = 'public'
    AND survivor_ns.nspname = 'public'
    AND duplicate_table_ns.nspname = 'public'
    AND survivor_table_ns.nspname = 'public'
    AND duplicate_table.relname = 'documents'
    AND survivor_table.relname = 'documents'
    AND duplicate_index.relname = 'idx_documents_user_id'
    AND survivor_index.relname = 'documents_user_id_idx'
    AND duplicate_index.relkind = 'i'
    AND survivor_index.relkind = 'i'
    AND duplicate_index.relpersistence = 'p' AND survivor_index.relpersistence = 'p'
    AND duplicate_index.reltablespace = 0 AND survivor_index.reltablespace = 0
    AND duplicate_index.reloptions IS NULL AND survivor_index.reloptions IS NULL
    AND duplicate_access_method.oid = survivor_access_method.oid
    AND duplicate_access_method.amname = 'btree'
    AND duplicate_meta.indrelid = survivor_meta.indrelid
    AND duplicate_meta.indnatts = 1 AND survivor_meta.indnatts = 1
    AND duplicate_meta.indnkeyatts = 1 AND survivor_meta.indnkeyatts = 1
    AND duplicate_meta.indkey::text = owner_column.attnum::text
    AND survivor_meta.indkey::text = owner_column.attnum::text
    AND duplicate_meta.indkey::text = survivor_meta.indkey::text
    AND duplicate_meta.indcollation::text = survivor_meta.indcollation::text
    AND duplicate_meta.indclass::text = survivor_meta.indclass::text
    AND duplicate_meta.indoption::text = survivor_meta.indoption::text
    AND duplicate_meta.indexprs IS NULL AND survivor_meta.indexprs IS NULL
    AND duplicate_meta.indpred IS NULL AND survivor_meta.indpred IS NULL
    AND pg_get_expr(duplicate_meta.indexprs, duplicate_meta.indrelid)
      IS NOT DISTINCT FROM pg_get_expr(survivor_meta.indexprs, survivor_meta.indrelid)
    AND pg_get_expr(duplicate_meta.indpred, duplicate_meta.indrelid)
      IS NOT DISTINCT FROM pg_get_expr(survivor_meta.indpred, survivor_meta.indrelid)
    AND duplicate_meta.indisvalid AND duplicate_meta.indisready AND duplicate_meta.indislive
    AND survivor_meta.indisvalid AND survivor_meta.indisready AND survivor_meta.indislive
    AND NOT duplicate_meta.indisunique AND NOT survivor_meta.indisunique
    AND NOT duplicate_meta.indisprimary AND NOT survivor_meta.indisprimary
    AND NOT duplicate_meta.indisexclusion AND NOT survivor_meta.indisexclusion
    AND NOT duplicate_meta.indisreplident AND NOT survivor_meta.indisreplident
    AND NOT duplicate_meta.indisclustered AND NOT survivor_meta.indisclustered
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conindid = duplicate_oid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conindid = survivor_oid)
  INTO exact_duplicate
  FROM pg_catalog.pg_index duplicate_meta
  JOIN pg_catalog.pg_class duplicate_index ON duplicate_index.oid = duplicate_meta.indexrelid
  JOIN pg_catalog.pg_namespace duplicate_ns ON duplicate_ns.oid = duplicate_index.relnamespace
  JOIN pg_catalog.pg_class duplicate_table ON duplicate_table.oid = duplicate_meta.indrelid
  JOIN pg_catalog.pg_namespace duplicate_table_ns ON duplicate_table_ns.oid = duplicate_table.relnamespace
  JOIN pg_catalog.pg_attribute owner_column ON owner_column.attrelid = duplicate_table.oid
    AND owner_column.attname = 'user_id' AND NOT owner_column.attisdropped
  JOIN pg_catalog.pg_am duplicate_access_method ON duplicate_access_method.oid = duplicate_index.relam
  JOIN pg_catalog.pg_index survivor_meta ON survivor_meta.indexrelid = survivor_oid
  JOIN pg_catalog.pg_class survivor_index ON survivor_index.oid = survivor_meta.indexrelid
  JOIN pg_catalog.pg_namespace survivor_ns ON survivor_ns.oid = survivor_index.relnamespace
  JOIN pg_catalog.pg_class survivor_table ON survivor_table.oid = survivor_meta.indrelid
  JOIN pg_catalog.pg_namespace survivor_table_ns ON survivor_table_ns.oid = survivor_table.relnamespace
  JOIN pg_catalog.pg_am survivor_access_method ON survivor_access_method.oid = survivor_index.relam
  WHERE duplicate_meta.indexrelid = duplicate_oid;

  IF COALESCE(exact_duplicate, false) THEN
    -- Do not remove dependents: catalog drift must fail closed.
    EXECUTE 'DROP INDEX public.idx_documents_user_id';
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid = duplicate_oid)
      OR to_regclass('public.documents_user_id_idx') IS DISTINCT FROM survivor_oid THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = 'document owner index names changed during guarded cleanup';
    END IF;
  END IF;
END
$cleanup$;
