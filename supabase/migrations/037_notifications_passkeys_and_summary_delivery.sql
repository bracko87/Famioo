-- Famioo migration 037
-- Push notifications, calendar reminder queueing, and daily/weekly summary email delivery.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

alter table public.notifications
  add column if not exists source_key text;

create unique index if not exists notifications_source_key_uidx
  on public.notifications(source_key)
  where source_key is not null;

create table if not exists private.notification_push_config (
  singleton boolean primary key default true check (singleton),
  public_key text not null,
  vault_secret_name text not null default 'famioo_vapid_private_key',
  updated_at timestamptz not null default now()
);

create table if not exists public.summary_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  summary_kind text not null check (summary_kind in ('daily','weekly')),
  recipient_email text not null,
  period_start date not null,
  period_end date not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending','sending','sent','failed','expired')),
  attempts integer not null default 0 check (attempts >= 0),
  provider_status integer,
  provider_response jsonb,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  error_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id,user_id,summary_kind,period_start)
);

create index if not exists summary_email_deliveries_due_idx
  on public.summary_email_deliveries(status,scheduled_for)
  where status in ('pending','failed');

alter table public.summary_email_deliveries enable row level security;

drop policy if exists summary_email_deliveries_select_own on public.summary_email_deliveries;
create policy summary_email_deliveries_select_own
on public.summary_email_deliveries for select to authenticated
using (
  user_id=(select auth.uid())
  and private.is_household_member(household_id)
);

revoke all on public.summary_email_deliveries from anon;
grant select on public.summary_email_deliveries to authenticated;
grant all on public.summary_email_deliveries to service_role;


create or replace function private.worker_calendar_occurrences(
  p_household_id uuid,
  p_range_start date,
  p_range_end date
)
returns table(
  event_id uuid,
  occurrence_key text,
  household_id uuid,
  title text,
  all_day boolean,
  occurrence_start_at timestamptz,
  occurrence_start_date date,
  event_timezone text,
  location_text text
)
language sql
stable
security definer
set search_path=public,private,pg_temp
as $$
with base as (
  select e.*,r.rrule,r.exception_dates,r.exception_instants
  from public.calendar_events e
  left join public.event_recurrence_rules r
    on r.household_id=e.household_id and r.event_id=e.id
  where e.household_id=p_household_id
    and e.deleted_at is null
    and e.status='active'
),
all_day_occ as (
  select e.id,d.occurrence_date,null::timestamptz as occurrence_at
  from base e
  cross join lateral private.rrule_occurrence_dates(
    e.start_date,
    e.rrule,
    coalesce(e.exception_dates,array[]::date[]),
    p_range_start,
    p_range_end
  ) d(occurrence_date)
  where e.all_day
),
timed_occ_pre as (
  select
    e.id,
    d.occurrence_date,
    (d.occurrence_date + (timezone(e.event_timezone,e.start_at))::time)
      at time zone e.event_timezone as occurrence_at
  from base e
  cross join lateral private.rrule_occurrence_dates(
    timezone(e.event_timezone,e.start_at)::date,
    e.rrule,
    array[]::date[],
    p_range_start,
    p_range_end
  ) d(occurrence_date)
  where not e.all_day
),
timed_occ as (
  select t.*
  from timed_occ_pre t
  join base e on e.id=t.id
  where not (
    t.occurrence_at=any(coalesce(e.exception_instants,array[]::timestamptz[]))
  )
),
occurrences as (
  select * from all_day_occ
  union all
  select * from timed_occ
)
select
  e.id,
  e.id::text||':'||
    case when e.all_day then o.occurrence_date::text
         else extract(epoch from o.occurrence_at)::bigint::text end,
  e.household_id,
  e.title,
  e.all_day,
  case when e.all_day then null else o.occurrence_at end,
  case when e.all_day then o.occurrence_date else null end,
  e.event_timezone,
  e.location_text
from occurrences o
join base e on e.id=o.id;
$$;

revoke all on function private.worker_calendar_occurrences(uuid,date,date)
from public,anon,authenticated;
grant execute on function private.worker_calendar_occurrences(uuid,date,date)
to service_role;


create or replace function private.queue_due_calendar_notifications(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  h record;
  v_local_today date;
  v_rows integer;
  v_total integer:=0;
begin
  for h in select id,timezone from public.households loop
    v_local_today := (p_now at time zone h.timezone)::date;

    with due as (
      select
        o.*,
        r.id as reminder_id,
        r.profile_id,
        r.reminder_kind,
        r.offset_minutes,
        r.exact_at,
        r.morning_time,
        r.timezone as reminder_timezone,
        fp.linked_user_id as recipient_user_id,
        case
          when r.reminder_kind='exact' then r.exact_at
          when r.reminder_kind='morning_of' then
            (
              coalesce(o.occurrence_start_date, timezone(o.event_timezone,o.occurrence_start_at)::date)
              + coalesce(r.morning_time,time '08:00')
            ) at time zone r.timezone
          when r.reminder_kind='offset' and o.all_day then
            (
              o.occurrence_start_date + time '09:00'
            ) at time zone o.event_timezone
              - make_interval(mins=>coalesce(r.offset_minutes,0))
          when r.reminder_kind='offset' then
            o.occurrence_start_at - make_interval(mins=>coalesce(r.offset_minutes,0))
          else null
        end as scheduled_for
      from private.worker_calendar_occurrences(
        h.id,
        v_local_today-2,
        v_local_today+3
      ) o
      join public.event_reminders r
        on r.event_id=o.event_id
       and r.household_id=o.household_id
       and r.enabled
       and r.delivery_channel='push'
      join public.family_profiles fp
        on fp.id=r.profile_id
       and fp.household_id=r.household_id
       and fp.active
       and fp.linked_user_id is not null
    )
    insert into public.notifications(
      household_id,
      recipient_user_id,
      notification_type,
      title,
      body,
      entity_type,
      entity_id,
      scheduled_for,
      status,
      source_key
    )
    select
      h.id,
      d.recipient_user_id,
      'calendar_reminder',
      'Calendar · '||d.title,
      case
        when d.all_day then
          to_char(d.occurrence_start_date,'Dy, DD Mon')||' · All day'
        else
          to_char(timezone(d.event_timezone,d.occurrence_start_at),'Dy, DD Mon HH24:MI')
      end
      || case when d.location_text is not null then ' · '||d.location_text else '' end,
      'calendar_event',
      d.event_id,
      d.scheduled_for,
      'pending',
      'event-reminder:'||d.reminder_id::text||':'||d.occurrence_key
    from due d
    where d.scheduled_for is not null
      and d.scheduled_for between p_now-interval '2 hours' and p_now+interval '2 minutes'
    on conflict (source_key) where source_key is not null do nothing;

    get diagnostics v_rows=row_count;
    v_total:=v_total+v_rows;
  end loop;

  return v_total;
end;
$$;

revoke all on function private.queue_due_calendar_notifications(timestamptz)
from public,anon,authenticated;
grant execute on function private.queue_due_calendar_notifications(timestamptz)
to service_role;


create or replace function private.queue_due_summary_emails(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path=public,private,auth,pg_temp
as $$
declare
  r record;
  v_local_date date;
  v_scheduled timestamptz;
  v_rows integer;
  v_total integer:=0;
begin
  for r in
    select np.*,u.email
    from public.notification_preferences np
    join public.household_members hm
      on hm.household_id=np.household_id
     and hm.user_id=np.user_id
     and hm.status='active'
    join auth.users u on u.id=np.user_id
    where np.email_enabled
      and u.email is not null
  loop
    v_local_date := (p_now at time zone r.timezone)::date;

    if r.daily_summary_enabled then
      v_scheduled := (v_local_date+r.daily_summary_time) at time zone r.timezone;

      if v_scheduled between p_now-interval '2 hours' and p_now+interval '2 minutes' then
        insert into public.summary_email_deliveries(
          household_id,user_id,summary_kind,recipient_email,
          period_start,period_end,scheduled_for,status
        )
        values(
          r.household_id,r.user_id,'daily',r.email,
          v_local_date,v_local_date,v_scheduled,'pending'
        )
        on conflict(household_id,user_id,summary_kind,period_start) do nothing;

        get diagnostics v_rows=row_count;
        v_total:=v_total+v_rows;
      end if;
    end if;

    if r.weekly_summary_enabled
       and extract(isodow from v_local_date)::integer=r.weekly_summary_weekday
    then
      v_scheduled := (v_local_date+r.weekly_summary_time) at time zone r.timezone;

      if v_scheduled between p_now-interval '2 hours' and p_now+interval '2 minutes' then
        insert into public.summary_email_deliveries(
          household_id,user_id,summary_kind,recipient_email,
          period_start,period_end,scheduled_for,status
        )
        values(
          r.household_id,r.user_id,'weekly',r.email,
          v_local_date,v_local_date+6,v_scheduled,'pending'
        )
        on conflict(household_id,user_id,summary_kind,period_start) do nothing;

        get diagnostics v_rows=row_count;
        v_total:=v_total+v_rows;
      end if;
    end if;
  end loop;

  return v_total;
end;
$$;

revoke all on function private.queue_due_summary_emails(timestamptz)
from public,anon,authenticated;
grant execute on function private.queue_due_summary_emails(timestamptz)
to service_role;


do $$
begin
  if not exists(select 1 from vault.secrets where name='famioo_project_url') then
    perform vault.create_secret(
      'https://pqnotyfcypxsspyhtcqn.supabase.co',
      'famioo_project_url',
      'Famioo Supabase project URL for scheduled Edge Function workers'
    );
  end if;

  if not exists(select 1 from vault.secrets where name='famioo_notification_worker_token') then
    perform vault.create_secret(
      encode(gen_random_bytes(32),'hex'),
      'famioo_notification_worker_token',
      'Authentication token for the Famioo scheduled notification worker'
    );
  end if;
end
$$;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname='famioo-notification-worker-v1'
  limit 1;

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end
$$;

select cron.schedule(
  'famioo-notification-worker-v1',
  '* * * * *',
  $job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name='famioo_project_url'
      ) || '/functions/v1/famioo-notification-worker',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-famioo-worker',(
          select decrypted_secret
          from vault.decrypted_secrets
          where name='famioo_notification_worker_token'
        )
      ),
      body := jsonb_build_object('source','pg_cron','scheduled_at',now()),
      timeout_milliseconds := 50000
    );
  $job$
);
