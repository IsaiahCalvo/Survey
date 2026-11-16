-- Walkthru (schema walkthru), KAL-593: Walkthru Categories link to the shared
-- library (public.library_entries, KAL-585). The source is the Walkthru repo
-- (same change there). Adds two empty, nullable columns; nothing is removed.
--
--   walkthru.node_types.library_entry_id    the library entry a Category is
--                                           (library id first when matching
--                                           Categories across the suite)
--   walkthru.organizations.survey_company_id the Survey Company whose company
--                                           library a Walkthru org shares
--
-- Production has schema walkthru (KAL-579), but this repo's migrations don't
-- build it, so a fresh local database skips this file instead of failing.
do $kal593$
begin
  if to_regclass('walkthru.node_types') is null
     or to_regclass('walkthru.organizations') is null
     or to_regclass('public.library_entries') is null
     or to_regclass('public.organizations') is null then
    raise notice 'KAL-593 library link skipped: schema walkthru or the library is not in this database';
    return;
  end if;

  alter table walkthru.node_types
    add column if not exists library_entry_id uuid
      references public.library_entries(id) on delete set null;
  create index if not exists node_types_library_entry_id_idx
    on walkthru.node_types (library_entry_id)
    where library_entry_id is not null;
  comment on column walkthru.node_types.library_entry_id is
    'KAL-593: the shared library entry (public.library_entries) this Category is. Kept by copies and duplicates.';

  alter table walkthru.organizations
    add column if not exists survey_company_id uuid
      references public.organizations(id) on delete set null;
  create index if not exists organizations_survey_company_id_idx
    on walkthru.organizations (survey_company_id)
    where survey_company_id is not null;
  comment on column walkthru.organizations.survey_company_id is
    'KAL-593: the Survey Company (public.organizations) whose company library this Walkthru org uses.';
end
$kal593$;
