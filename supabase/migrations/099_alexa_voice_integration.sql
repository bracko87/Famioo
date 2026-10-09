-- Famioo migration 099
-- Alexa / Voice Integration V1 (Famioo-side).

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'voice_integration',
  'Alexa / Voice Integration',
  'Voice integration settings for Calendar queries, Shopping, Tasks and reminders',
  'audio-lines',
  51,
  true,
  true
)
on conflict(code) do update set
  name=excluded.name,
  description=excluded.description,
  icon_key=excluded.icon_key,
  sort_order=excluded.sort_order,
  is_core=true,
  is_active=true;

insert into public.module_role_permissions(household_id,module_code,role,access_level)
select h.id,'voice_integration',r.role,'full'
from public.households h
cross join (values ('owner'::text),('admin'::text),('user'::text)) as r(role)
on conflict(household_id,module_code,role)
do update set access_level='full',updated_at=now();

create table if not exists public.voice_integration_settings(
  household_id uuid primary key references public.households(id) on delete cascade,
  provider text not null default 'alexa' check(provider='alexa'),
  enabled boolean not null default false,
  allowed_actions text[] not null default array['calendar_query','shopping_add','task_add','reminders_query']::text[],
  token_hash text,
  token_prefix text,
  linked_by_user_id uuid not null references auth.users(id) on delete restrict,
  token_rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(allowed_actions <@ array['calendar_query','shopping_add','task_add','reminders_query']::text[])
);
create index if not exists voice_integration_settings_linked_by_idx
  on public.voice_integration_settings(linked_by_user_id);

create table if not exists public.voice_integration_action_log(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  provider text not null default 'alexa',
  intent text not null,
  success boolean not null,
  summary text,
  created_at timestamptz not null default now()
);
create index if not exists voice_integration_action_log_household_idx
  on public.voice_integration_action_log(household_id,created_at desc);

alter table public.voice_integration_settings enable row level security;
alter table public.voice_integration_action_log enable row level security;

create policy voice_integration_settings_owner_admin
on public.voice_integration_settings for all to authenticated
using(
  exists(
    select 1 from public.household_members hm
    where hm.household_id=voice_integration_settings.household_id
      and hm.user_id=(select auth.uid())
      and hm.status='active'
      and hm.role in ('owner','admin')
  )
)
with check(
  exists(
    select 1 from public.household_members hm
    where hm.household_id=voice_integration_settings.household_id
      and hm.user_id=(select auth.uid())
      and hm.status='active'
      and hm.role in ('owner','admin')
  )
);

create policy voice_integration_action_log_owner_admin
on public.voice_integration_action_log for select to authenticated
using(
  exists(
    select 1 from public.household_members hm
    where hm.household_id=voice_integration_action_log.household_id
      and hm.user_id=(select auth.uid())
      and hm.status='active'
      and hm.role in ('owner','admin')
  )
);

grant select,insert,update,delete on public.voice_integration_settings to authenticated;
grant select on public.voice_integration_action_log to authenticated;

create or replace function public.save_voice_integration_settings_v1(
  p_household_id uuid,
  p_enabled boolean,
  p_allowed_actions text[]
)
returns boolean
language plpgsql
security invoker
set search_path=public,private,pg_temp
as $$
declare v_actions text[]:=coalesce(p_allowed_actions,'{}'::text[]);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(
    select 1 from public.household_members hm
    where hm.household_id=p_household_id
      and hm.user_id=auth.uid()
      and hm.status='active'
      and hm.role in ('owner','admin')
  ) then raise exception 'Only household owners/admins can configure voice integration'; end if;
  if not (v_actions <@ array['calendar_query','shopping_add','task_add','reminders_query']::text[]) then
    raise exception 'Unsupported voice action';
  end if;

  insert into public.voice_integration_settings(
    household_id,enabled,allowed_actions,linked_by_user_id
  )
  values(p_household_id,coalesce(p_enabled,false),v_actions,auth.uid())
  on conflict(household_id) do update set
    enabled=excluded.enabled,
    allowed_actions=excluded.allowed_actions,
    updated_at=now();

  return true;
end;
$$;

create or replace function public.rotate_voice_integration_token_v1(
  p_household_id uuid
)
returns text
language plpgsql
security invoker
set search_path=public,private,extensions,pg_temp
as $$
declare v_token text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(
    select 1 from public.household_members hm
    where hm.household_id=p_household_id
      and hm.user_id=auth.uid()
      and hm.status='active'
      and hm.role in ('owner','admin')
  ) then raise exception 'Only household owners/admins can rotate voice integration tokens'; end if;

  v_token:='fami_voice_'||encode(gen_random_bytes(24),'hex');

  insert into public.voice_integration_settings(
    household_id,enabled,allowed_actions,token_hash,token_prefix,linked_by_user_id,token_rotated_at
  )
  values(
    p_household_id,false,
    array['calendar_query','shopping_add','task_add','reminders_query']::text[],
    encode(digest(v_token,'sha256'),'hex'),
    left(v_token,18),
    auth.uid(),
    now()
  )
  on conflict(household_id) do update set
    token_hash=excluded.token_hash,
    token_prefix=excluded.token_prefix,
    linked_by_user_id=auth.uid(),
    token_rotated_at=now(),
    updated_at=now();

  return v_token;
end;
$$;

create or replace function public.voice_calendar_household_events_v1(
  p_household_id uuid,
  p_range_start date,
  p_range_end date
)
returns table(
  event_id uuid,
  title text,
  occurrence_start_at timestamptz,
  occurrence_start_date date,
  event_timezone text,
  location_text text
)
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if p_range_end<p_range_start or p_range_end-p_range_start>14 then
    raise exception 'Invalid voice calendar range';
  end if;

  return query
  with base as (
    select e.*,r.rrule,r.exception_dates,r.exception_instants
    from public.calendar_events e
    left join public.event_recurrence_rules r
      on r.household_id=e.household_id and r.event_id=e.id
    where e.household_id=p_household_id
      and e.deleted_at is null
      and e.status='active'
      and e.visibility='household'
  ),
  all_day_occ as (
    select e.id,d.occurrence_date,null::timestamptz as occurrence_at
    from base e
    cross join lateral private.rrule_occurrence_dates(
      e.start_date,e.rrule,coalesce(e.exception_dates,array[]::date[]),
      p_range_start,p_range_end
    ) d(occurrence_date)
    where e.all_day
  ),
  timed_occ_pre as (
    select e.id,d.occurrence_date,
      (d.occurrence_date+(timezone(e.event_timezone,e.start_at))::time) at time zone e.event_timezone as occurrence_at
    from base e
    cross join lateral private.rrule_occurrence_dates(
      timezone(e.event_timezone,e.start_at)::date,e.rrule,array[]::date[],
      p_range_start,p_range_end
    ) d(occurrence_date)
    where not e.all_day
  ),
  timed_occ as (
    select t.*
    from timed_occ_pre t
    join base e on e.id=t.id
    where not (t.occurrence_at=any(coalesce(e.exception_instants,array[]::timestamptz[])))
  ),
  occurrences as (
    select * from all_day_occ
    union all
    select * from timed_occ
  )
  select
    e.id,e.title,
    case when e.all_day then null else o.occurrence_at end,
    case when e.all_day then o.occurrence_date else null end,
    e.event_timezone,e.location_text
  from occurrences o
  join base e on e.id=o.id
  order by coalesce(o.occurrence_at,o.occurrence_date::timestamp at time zone e.event_timezone),e.title;
end;
$$;

revoke all on function public.save_voice_integration_settings_v1(uuid,boolean,text[]) from public,anon;
revoke all on function public.rotate_voice_integration_token_v1(uuid) from public,anon;
revoke all on function public.voice_calendar_household_events_v1(uuid,date,date) from public,anon,authenticated;
grant execute on function public.save_voice_integration_settings_v1(uuid,boolean,text[]) to authenticated;
grant execute on function public.rotate_voice_integration_token_v1(uuid) to authenticated;
grant execute on function public.voice_calendar_household_events_v1(uuid,date,date) to service_role;
