-- Famioo migration 038
-- Use ISO weekday values (Monday=1 ... Sunday=7) for weekly summary scheduling.

alter table public.notification_preferences
  drop constraint if exists notification_preferences_weekly_summary_weekday_check;

alter table public.notification_preferences
  add constraint notification_preferences_weekly_summary_weekday_check
  check (weekly_summary_weekday between 1 and 7);
