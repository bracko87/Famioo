create index if not exists assistant_usage_events_user_id_idx
  on public.assistant_usage_events (user_id)
  where user_id is not null;
