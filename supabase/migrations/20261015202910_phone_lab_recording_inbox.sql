-- Isolated research inbox in the existing Survey backend, not a Walkthu app migration.
-- Clients can submit bounded diagnostics but cannot read, change or delete any row.
-- The pilot sequence caps total attempts/storage rather than enabling paid capacity.
create sequence public.phone_lab_recording_slots as integer minvalue 1 maxvalue 30 start with 1 no cycle cache 1;

create table public.phone_lab_recordings (
  id uuid primary key,
  slot integer not null unique default nextval('public.phone_lab_recording_slots'),
  received_at timestamptz not null default now(),
  recording jsonb not null,
  constraint phone_lab_payload_size check (octet_length(recording::text) <= 8000000),
  constraint phone_lab_stopped_recording check (
    jsonb_typeof(recording) = 'object'
    and recording->>'format' = 'walkthu-motion-check/v1'
    and jsonb_typeof(recording->'device') = 'object'
    and jsonb_typeof(recording->'stoppedAt') = 'string'
    and case when jsonb_typeof(recording->'events') = 'array'
      then jsonb_array_length(recording->'events') between 1 and 30000 else false end
  )
);

alter table public.phone_lab_recordings enable row level security;
revoke all on table public.phone_lab_recordings from public, anon, authenticated;
revoke all on sequence public.phone_lab_recording_slots from public, anon, authenticated;
grant insert (id, recording) on public.phone_lab_recordings to anon;
grant usage on sequence public.phone_lab_recording_slots to anon;
grant all on public.phone_lab_recordings to service_role;
grant all on sequence public.phone_lab_recording_slots to service_role;

create policy phone_lab_submit_stopped_test
on public.phone_lab_recordings for insert to anon
with check (
  recording->>'format' = 'walkthu-motion-check/v1'
  and jsonb_typeof(recording->'stoppedAt') = 'string'
  and jsonb_typeof(recording->'device') = 'object'
  and case when jsonb_typeof(recording->'events') = 'array'
    then jsonb_array_length(recording->'events') between 1 and 30000 else false end
);

comment on table public.phone_lab_recordings is 'Private phone research inbox. Public client has bounded insert-only access; analysis uses the authorized Supabase connector. No read policy. 30 pilot submission attempts, 8 MB maximum each. No customer floor plans.';
;
