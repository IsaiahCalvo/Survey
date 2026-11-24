-- Walkthru runs in its own schema on the shared database.
do $walkthrumultidevice$
begin
  if to_regclass('walkthru.audio_recordings') is null then
    return;
  end if;
  execute $migration$
-- One walk can record on several devices at once (Nightly flag
-- multi-device-recording). Each device keeps its own recording row.
alter table walkthru.audio_recordings
  add column if not exists device_id text,
  add column if not exists device_label text,
  -- Pauses as {"offsetMs": audio position at the pause, "ms": its length},
  -- so any moment of the audio maps back to the clock and lines up with the
  -- other devices' recordings.
  add column if not exists pause_spans jsonb not null default '[]'::jsonb,
  -- How loud the voice was, one 0-100 value per step, measured on the device:
  -- {"stepMs": 1000, "levels": [..]}. Picks the clearest device per stretch.
  add column if not exists level_profile jsonb;

do $checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'audio_recordings_device_fields_valid'
                 and conrelid = 'walkthru.audio_recordings'::regclass) then
    alter table walkthru.audio_recordings add constraint audio_recordings_device_fields_valid check (
      (device_id is null or length(device_id) between 1 and 128)
      and (device_label is null or length(device_label) between 1 and 80)
      and jsonb_typeof(pause_spans) = 'array'
      and (level_profile is null or jsonb_typeof(level_profile) = 'object')
    );
  end if;
end
$checks$;

-- Was: one open recording per walkthrough. Now one open recording per device.
-- Rows from apps that send no device id share the '' key, so those apps keep
-- the old one-at-a-time rule among themselves.
create unique index if not exists audio_recordings_one_active_per_device_idx
  on walkthru.audio_recordings (walkthrough_id, coalesce(device_id, ''))
  where deleted_at is null and ended_at is null;
drop index if exists walkthru.audio_recordings_one_active_per_walkthrough_idx;
$migration$;
end
$walkthrumultidevice$;
