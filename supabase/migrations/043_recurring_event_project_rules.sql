-- Famioo migration 043
-- Recurring Calendar -> Projects & Chores rules.

create table if not exists public.project_event_series_rules(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  project_id uuid null references public.household_projects(id) on delete set null,
  item_kind text not null check(item_kind in ('project_task','chore')),
  assigned_profile_id uuid null references public.family_profiles(id) on delete set null,
  notes text null,
  score_duration text not null default '15_30',
  score_effort text not null default 'medium',
  score_execution text not null default 'manual',
  score_responsibility text not null default 'normal',
  points smallint not null default 1,
  active boolean not null default true,
  created_by_user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(household_id,event_id,item_kind)
);

alter table public.project_event_series_rules enable row level security;

drop policy if exists project_event_series_rules_select on public.project_event_series_rules;
create policy project_event_series_rules_select
on public.project_event_series_rules
for select
using(private.has_module_access(household_id,'projects','read'));

drop policy if exists project_event_series_rules_insert on public.project_event_series_rules;
create policy project_event_series_rules_insert
on public.project_event_series_rules
for insert
with check(private.has_module_access(household_id,'projects','full'));

drop policy if exists project_event_series_rules_update on public.project_event_series_rules;
create policy project_event_series_rules_update
on public.project_event_series_rules
for update
using(private.has_module_access(household_id,'projects','full'))
with check(private.has_module_access(household_id,'projects','full'));

grant select,insert,update on public.project_event_series_rules to authenticated;

alter table public.project_work_items
  add column if not exists source_event_occurrence_key text,
  add column if not exists source_event_series_rule_id uuid
    references public.project_event_series_rules(id) on delete set null;

create unique index if not exists project_work_items_event_occurrence_uidx
on public.project_work_items(household_id,linked_event_id,item_kind,source_event_occurrence_key)
where source_event_occurrence_key is not null;


create or replace function private.materialize_project_event_series_rule_v1(
  p_rule_id uuid,
  p_from date,
  p_to date
)
returns integer
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_count integer:=0;
begin
  with source as (
    select
      sr.*,
      e.title,
      e.category_id,
      e.all_day,
      e.start_at,
      e.start_date,
      e.event_timezone,
      e.location_text,
      er.rrule,
      coalesce(er.exception_dates,array[]::date[]) as exception_dates,
      coalesce(er.exception_instants,array[]::timestamptz[]) as exception_instants
    from public.project_event_series_rules sr
    join public.calendar_events e
      on e.id=sr.event_id
     and e.household_id=sr.household_id
     and e.deleted_at is null
     and e.status='active'
    join public.event_recurrence_rules er
      on er.event_id=e.id
     and er.household_id=e.household_id
    where sr.id=p_rule_id
      and sr.active
  ),
  all_day_occ as (
    select
      s.*,
      d.occurrence_date,
      null::timestamptz as occurrence_at
    from source s
    cross join lateral private.rrule_occurrence_dates(
      s.start_date,
      s.rrule,
      s.exception_dates,
      p_from,
      p_to
    ) d(occurrence_date)
    where s.all_day
  ),
  timed_pre as (
    select
      s.*,
      d.occurrence_date,
      (
        d.occurrence_date
        + (timezone(s.event_timezone,s.start_at))::time
      ) at time zone s.event_timezone as occurrence_at
    from source s
    cross join lateral private.rrule_occurrence_dates(
      timezone(s.event_timezone,s.start_at)::date,
      s.rrule,
      array[]::date[],
      p_from,
      p_to
    ) d(occurrence_date)
    where not s.all_day
  ),
  timed_occ as (
    select *
    from timed_pre
    where not (occurrence_at=any(exception_instants))
  ),
  occ as (
    select * from all_day_occ
    union all
    select * from timed_occ
  ),
  inserted as (
    insert into public.project_work_items(
      household_id,project_id,item_kind,title,category_id,due_date,location_text,
      assigned_profile_id,points,notes,sync_task,sync_calendar,linked_task_id,
      linked_event_id,status,created_by_user_id,score_duration,score_effort,
      score_execution,score_responsibility,task_link_origin,
      source_event_occurrence_key,source_event_series_rule_id
    )
    select
      o.household_id,
      case when o.item_kind='project_task' then o.project_id else null end,
      o.item_kind,
      o.title,
      o.category_id,
      o.occurrence_date,
      o.location_text,
      o.assigned_profile_id,
      o.points,
      o.notes,
      false,
      true,
      null,
      o.event_id,
      'open',
      o.created_by_user_id,
      o.score_duration,
      o.score_effort,
      o.score_execution,
      o.score_responsibility,
      null,
      o.event_id::text||':'||
        case
          when o.all_day then o.occurrence_date::text
          else extract(epoch from o.occurrence_at)::bigint::text
        end,
      o.id
    from occ o
    where o.category_id is not null
    on conflict(household_id,linked_event_id,item_kind,source_event_occurrence_key)
      where source_event_occurrence_key is not null
    do update set
      project_id=excluded.project_id,
      title=excluded.title,
      category_id=excluded.category_id,
      due_date=excluded.due_date,
      location_text=excluded.location_text,
      assigned_profile_id=excluded.assigned_profile_id,
      points=excluded.points,
      notes=excluded.notes,
      score_duration=excluded.score_duration,
      score_effort=excluded.score_effort,
      score_execution=excluded.score_execution,
      score_responsibility=excluded.score_responsibility,
      source_event_series_rule_id=excluded.source_event_series_rule_id,
      updated_at=now()
    where public.project_work_items.status='open'
      and public.project_work_items.source_event_series_rule_id is not null
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;


create or replace function public.save_project_event_series_rule_v1(
  p_id uuid,
  p_household_id uuid,
  p_event_id uuid,
  p_project_id uuid,
  p_item_kind text,
  p_assigned_profile_id uuid,
  p_notes text,
  p_score_duration text,
  p_score_effort text,
  p_score_execution text,
  p_score_responsibility text
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_id uuid;
  v_points smallint;
  v_today date;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'projects','full') then
    raise exception 'Projects & Chores write access required';
  end if;
  if not private.has_module_access(p_household_id,'calendar','read') then
    raise exception 'Calendar access required';
  end if;
  if p_item_kind not in ('project_task','chore') then
    raise exception 'Invalid responsibility type';
  end if;

  if not exists(
    select 1 from public.calendar_events e
    join public.event_recurrence_rules r
      on r.event_id=e.id and r.household_id=e.household_id
    where e.id=p_event_id
      and e.household_id=p_household_id
      and e.deleted_at is null
      and e.status='active'
  ) then
    raise exception 'A recurring Calendar event is required';
  end if;

  if p_project_id is not null and not exists(
    select 1 from public.household_projects
    where id=p_project_id
      and household_id=p_household_id
      and status='active'
  ) then
    raise exception 'Project not found';
  end if;

  if p_assigned_profile_id is not null and not exists(
    select 1 from public.family_profiles
    where id=p_assigned_profile_id
      and household_id=p_household_id
      and active
  ) then
    raise exception 'Assigned household member not found';
  end if;

  v_points:=private.project_points_for_v1(
    p_score_duration,p_score_effort,p_score_execution,p_score_responsibility
  );

  if p_id is null then
    insert into public.project_event_series_rules(
      household_id,event_id,project_id,item_kind,assigned_profile_id,notes,
      score_duration,score_effort,score_execution,score_responsibility,
      points,active,created_by_user_id
    )
    values(
      p_household_id,p_event_id,
      case when p_item_kind='project_task' then p_project_id else null end,
      p_item_kind,p_assigned_profile_id,nullif(trim(p_notes),''),
      p_score_duration,p_score_effort,p_score_execution,p_score_responsibility,
      v_points,true,auth.uid()
    )
    on conflict(household_id,event_id,item_kind)
    do update set
      project_id=excluded.project_id,
      assigned_profile_id=excluded.assigned_profile_id,
      notes=excluded.notes,
      score_duration=excluded.score_duration,
      score_effort=excluded.score_effort,
      score_execution=excluded.score_execution,
      score_responsibility=excluded.score_responsibility,
      points=excluded.points,
      active=true,
      updated_at=now()
    returning id into v_id;
  else
    update public.project_event_series_rules
    set project_id=case when p_item_kind='project_task' then p_project_id else null end,
        item_kind=p_item_kind,
        assigned_profile_id=p_assigned_profile_id,
        notes=nullif(trim(p_notes),''),
        score_duration=p_score_duration,
        score_effort=p_score_effort,
        score_execution=p_score_execution,
        score_responsibility=p_score_responsibility,
        points=v_points,
        active=true,
        updated_at=now()
    where id=p_id
      and household_id=p_household_id
      and event_id=p_event_id
    returning id into v_id;

    if v_id is null then raise exception 'Recurring rule not found'; end if;
  end if;

  select (now() at time zone timezone)::date
  into v_today
  from public.households
  where id=p_household_id;

  perform private.materialize_project_event_series_rule_v1(
    v_id,v_today,v_today+69
  );

  return v_id;
end;
$$;

revoke all on function public.save_project_event_series_rule_v1(
  uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text
) from public,anon;
grant execute on function public.save_project_event_series_rule_v1(
  uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text
) to authenticated;


create or replace function public.stop_project_event_series_rule_v1(
  p_id uuid,
  p_household_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_today date;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'projects','full') then
    raise exception 'Projects & Chores write access required';
  end if;

  select (now() at time zone timezone)::date
  into v_today
  from public.households
  where id=p_household_id;

  update public.project_event_series_rules
  set active=false,updated_at=now()
  where id=p_id and household_id=p_household_id;

  if not found then raise exception 'Recurring rule not found'; end if;

  update public.project_work_items
  set status='archived',updated_at=now()
  where source_event_series_rule_id=p_id
    and household_id=p_household_id
    and status='open'
    and due_date>=v_today;

  return true;
end;
$$;

revoke all on function public.stop_project_event_series_rule_v1(uuid,uuid)
from public,anon;
grant execute on function public.stop_project_event_series_rule_v1(uuid,uuid)
to authenticated;


create or replace function public.save_event_project_work_occurrence_v1(
  p_id uuid,
  p_household_id uuid,
  p_event_id uuid,
  p_occurrence_key text,
  p_occurrence_date date,
  p_project_id uuid,
  p_item_kind text,
  p_assigned_profile_id uuid,
  p_notes text,
  p_score_duration text,
  p_score_effort text,
  p_score_execution text,
  p_score_responsibility text
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_event public.calendar_events%rowtype;
  v_id uuid;
  v_points smallint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'projects','full') then
    raise exception 'Projects & Chores write access required';
  end if;

  select * into v_event
  from public.calendar_events
  where id=p_event_id
    and household_id=p_household_id
    and deleted_at is null
    and status='active';

  if not found then raise exception 'Calendar event not found'; end if;
  if v_event.category_id is null then
    raise exception 'The Calendar event needs a category first';
  end if;
  if p_occurrence_key is null or p_occurrence_date is null then
    raise exception 'Calendar occurrence is required';
  end if;
  if p_occurrence_key not like p_event_id::text||':%' then
    raise exception 'Invalid Calendar occurrence';
  end if;
  if p_item_kind not in ('project_task','chore') then
    raise exception 'Invalid responsibility type';
  end if;

  v_points:=private.project_points_for_v1(
    p_score_duration,p_score_effort,p_score_execution,p_score_responsibility
  );

  if p_id is null then
    insert into public.project_work_items(
      household_id,project_id,item_kind,title,category_id,due_date,location_text,
      assigned_profile_id,points,notes,sync_task,sync_calendar,linked_event_id,
      status,created_by_user_id,score_duration,score_effort,score_execution,
      score_responsibility,source_event_occurrence_key
    )
    values(
      p_household_id,
      case when p_item_kind='project_task' then p_project_id else null end,
      p_item_kind,v_event.title,v_event.category_id,p_occurrence_date,v_event.location_text,
      p_assigned_profile_id,v_points,nullif(trim(p_notes),''),
      false,true,p_event_id,'open',auth.uid(),
      p_score_duration,p_score_effort,p_score_execution,p_score_responsibility,
      p_occurrence_key
    )
    on conflict(household_id,linked_event_id,item_kind,source_event_occurrence_key)
      where source_event_occurrence_key is not null
    do update set
      project_id=excluded.project_id,
      assigned_profile_id=excluded.assigned_profile_id,
      points=excluded.points,
      notes=excluded.notes,
      score_duration=excluded.score_duration,
      score_effort=excluded.score_effort,
      score_execution=excluded.score_execution,
      score_responsibility=excluded.score_responsibility,
      updated_at=now()
    returning id into v_id;
  else
    update public.project_work_items
    set project_id=case when p_item_kind='project_task' then p_project_id else null end,
        item_kind=p_item_kind,
        title=v_event.title,
        category_id=v_event.category_id,
        due_date=p_occurrence_date,
        location_text=v_event.location_text,
        assigned_profile_id=p_assigned_profile_id,
        points=v_points,
        notes=nullif(trim(p_notes),''),
        linked_event_id=p_event_id,
        source_event_occurrence_key=p_occurrence_key,
        score_duration=p_score_duration,
        score_effort=p_score_effort,
        score_execution=p_score_execution,
        score_responsibility=p_score_responsibility,
        updated_at=now()
    where id=p_id
      and household_id=p_household_id
      and status in ('open','done')
    returning id into v_id;

    if v_id is null then raise exception 'Responsibility not found'; end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_event_project_work_occurrence_v1(
  uuid,uuid,uuid,text,date,uuid,text,uuid,text,text,text,text,text
) from public,anon;
grant execute on function public.save_event_project_work_occurrence_v1(
  uuid,uuid,uuid,text,date,uuid,text,uuid,text,text,text,text,text
) to authenticated;


create or replace function public.sync_project_event_series_rules_v1(
  p_household_id uuid
)
returns integer
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_today date;
  v_rule record;
  v_total integer:=0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'projects','read') then
    raise exception 'Projects & Chores access required';
  end if;

  select (now() at time zone timezone)::date
  into v_today
  from public.households
  where id=p_household_id;

  for v_rule in
    select id
    from public.project_event_series_rules
    where household_id=p_household_id
      and active
  loop
    v_total:=v_total+private.materialize_project_event_series_rule_v1(
      v_rule.id,v_today,v_today+69
    );
  end loop;

  return v_total;
end;
$$;

revoke all on function public.sync_project_event_series_rules_v1(uuid)
from public,anon;
grant execute on function public.sync_project_event_series_rules_v1(uuid)
to authenticated;


create or replace function private.sync_all_project_event_series_rules_v1()
returns integer
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_rule record;
  v_today date;
  v_total integer:=0;
begin
  for v_rule in
    select sr.id,sr.household_id,h.timezone
    from public.project_event_series_rules sr
    join public.households h on h.id=sr.household_id
    where sr.active
  loop
    v_today:=(now() at time zone v_rule.timezone)::date;
    v_total:=v_total+private.materialize_project_event_series_rule_v1(
      v_rule.id,v_today,v_today+69
    );
  end loop;
  return v_total;
end;
$$;

revoke all on function private.sync_all_project_event_series_rules_v1()
from public,anon,authenticated;
grant execute on function private.sync_all_project_event_series_rules_v1()
to service_role;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname='famioo-sync-project-event-series-v1'
  limit 1;

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end
$$;

select cron.schedule(
  'famioo-sync-project-event-series-v1',
  '37 * * * *',
  $$select private.sync_all_project_event_series_rules_v1();$$
);
