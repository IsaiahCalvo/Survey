insert into public.feature_flags (key, mode, description) values ('box-drag-move','off','Drag inside a picked mark to move it') on conflict (key) do nothing;
