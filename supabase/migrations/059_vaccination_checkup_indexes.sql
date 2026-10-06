-- Famioo migration 059
-- Supporting indexes for Vaccinations & Check-ups foreign keys.

create index if not exists child_vaccination_entries_template_idx
  on public.child_vaccination_entries(template_code)
  where template_code is not null;

create index if not exists child_vaccination_entries_calendar_idx
  on public.child_vaccination_entries(calendar_id)
  where calendar_id is not null;

create index if not exists child_vaccination_entries_event_idx
  on public.child_vaccination_entries(linked_event_id)
  where linked_event_id is not null;

create index if not exists child_vaccination_entries_creator_idx
  on public.child_vaccination_entries(created_by_user_id);

create index if not exists child_checkup_entries_template_idx
  on public.child_checkup_entries(template_code)
  where template_code is not null;

create index if not exists child_checkup_entries_calendar_idx
  on public.child_checkup_entries(calendar_id)
  where calendar_id is not null;

create index if not exists child_checkup_entries_event_idx
  on public.child_checkup_entries(linked_event_id)
  where linked_event_id is not null;

create index if not exists child_checkup_entries_creator_idx
  on public.child_checkup_entries(created_by_user_id);
