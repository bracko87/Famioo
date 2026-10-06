-- Famioo migration 040
-- Calendar occurrence deletion, event-linked costs, and complete Projects & Chores archive lifecycle.

-- Calendar events can own Household Cost rows.
alter table public.household_costs
  add column if not exists source_event_id uuid
  references public.calendar_events(id) on delete set null;

create index if not exists household_costs_source_event_idx
  on public.household_costs(household_id,source_event_id)
  where source_event_id is not null;

alter table public.household_costs
  drop constraint if exists household_costs_source_type_check;

alter table public.household_costs
  add constraint household_costs_source_type_check
  check (source_type = any(array[
    'manual'::text,'shopping'::text,'task'::text,'home_care'::text,
    'life_admin'::text,'projects'::text,'calendar_event'::text
  ]));


-- Delete a single recurrence, this-and-future, or every occurrence.
create or replace function public.delete_event_occurrences_v1(
  p_event_id uuid,
  p_household_id uuid,
  p_scope text,
  p_occurrence_date date default null,
  p_occurrence_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_rule public.event_recurrence_rules%rowtype;
  v_event public.calendar_events%rowtype;
  v_day date;
  v_previous date;
  v_rrule text;
  v_start_day date;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.can_edit_event(p_event_id) then
    raise exception 'Calendar edit access required';
  end if;

  select * into v_event
  from public.calendar_events
  where id=p_event_id
    and household_id=p_household_id
    and deleted_at is null;

  if not found then
    raise exception 'Event not found';
  end if;

  select * into v_rule
  from public.event_recurrence_rules
  where event_id=p_event_id
    and household_id=p_household_id;

  if p_scope='all' or v_rule.id is null then
    perform public.delete_event_v1(p_event_id,p_household_id);
    return true;
  end if;

  v_day := coalesce(
    p_occurrence_date,
    case when p_occurrence_at is not null
      then (p_occurrence_at at time zone v_event.event_timezone)::date
      else null end
  );

  if v_day is null then
    raise exception 'Occurrence date is required';
  end if;

  if p_scope='one' then
    if v_event.all_day then
      update public.event_recurrence_rules
      set exception_dates = case
            when v_day=any(exception_dates) then exception_dates
            else array_append(exception_dates,v_day)
          end,
          updated_at=now()
      where id=v_rule.id;
    else
      if p_occurrence_at is null then
        raise exception 'Occurrence time is required for a timed recurring event';
      end if;

      update public.event_recurrence_rules
      set exception_instants = case
            when p_occurrence_at=any(exception_instants) then exception_instants
            else array_append(exception_instants,p_occurrence_at)
          end,
          updated_at=now()
      where id=v_rule.id;
    end if;

    return true;
  end if;

  if p_scope='future' then
    v_start_day := case
      when v_event.all_day then v_event.start_date
      else (v_event.start_at at time zone v_event.event_timezone)::date
    end;

    if v_start_day is null or v_day <= v_start_day then
      perform public.delete_event_v1(p_event_id,p_household_id);
      return true;
    end if;

    v_previous := v_day - 1;
    v_rrule := regexp_replace(v_rule.rrule,';?UNTIL=[0-9]{8}','', 'g');
    v_rrule := v_rrule || ';UNTIL=' || to_char(v_previous,'YYYYMMDD');

    update public.event_recurrence_rules
    set rrule=v_rrule,
        updated_at=now()
    where id=v_rule.id;

    return true;
  end if;

  raise exception 'Invalid delete scope';
end;
$$;

revoke all on function public.delete_event_occurrences_v1(uuid,uuid,text,date,timestamptz)
from public,anon;
grant execute on function public.delete_event_occurrences_v1(uuid,uuid,text,date,timestamptz)
to authenticated;


-- Projects & Chores archive lifecycle.
create or replace function public.archive_expired_projects_chores_v1(
  p_household_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_today date;
  v_projects integer:=0;
  v_items integer:=0;
  v_rows integer:=0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;

  select (now() at time zone timezone)::date
  into v_today
  from public.households
  where id=p_household_id;

  if v_today is null then
    raise exception 'Household not found';
  end if;

  update public.project_work_items
  set status='archived',
      updated_at=now()
  where household_id=p_household_id
    and status<>'archived'
    and due_date is not null
    and due_date < v_today;

  get diagnostics v_items=row_count;

  update public.household_projects
  set status='archived',
      updated_at=now()
  where household_id=p_household_id
    and status<>'archived'
    and due_date is not null
    and due_date < v_today;

  get diagnostics v_projects=row_count;

  update public.project_work_items pwi
  set status='archived',
      updated_at=now()
  where pwi.household_id=p_household_id
    and pwi.status<>'archived'
    and exists(
      select 1 from public.household_projects hp
      where hp.id=pwi.project_id
        and hp.household_id=p_household_id
        and hp.status='archived'
    );

  get diagnostics v_rows=row_count;
  v_items:=v_items+v_rows;

  return jsonb_build_object(
    'today',v_today,
    'projects_archived',v_projects,
    'responsibilities_archived',v_items
  );
end;
$$;

revoke all on function public.archive_expired_projects_chores_v1(uuid)
from public,anon;
grant execute on function public.archive_expired_projects_chores_v1(uuid)
to authenticated;


create or replace function public.set_household_project_archived_v1(
  p_project_id uuid,
  p_household_id uuid,
  p_archived boolean
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'projects','full') then
    raise exception 'Projects & Chores write access required';
  end if;

  update public.household_projects
  set status=case when p_archived then 'archived' else 'active' end,
      updated_at=now()
  where id=p_project_id and household_id=p_household_id;

  if not found then raise exception 'Project not found'; end if;

  if p_archived then
    update public.project_work_items
    set status='archived',updated_at=now()
    where project_id=p_project_id
      and household_id=p_household_id
      and status<>'archived';
  end if;

  return true;
end;
$$;

revoke all on function public.set_household_project_archived_v1(uuid,uuid,boolean)
from public,anon;
grant execute on function public.set_household_project_archived_v1(uuid,uuid,boolean)
to authenticated;


create or replace function public.set_project_work_item_archived_v1(
  p_item_id uuid,
  p_household_id uuid,
  p_archived boolean
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'projects','full') then
    raise exception 'Projects & Chores write access required';
  end if;

  update public.project_work_items
  set status=case
        when p_archived then 'archived'
        when status='archived' then 'open'
        else status
      end,
      updated_at=now()
  where id=p_item_id and household_id=p_household_id;

  if not found then raise exception 'Responsibility not found'; end if;
  return true;
end;
$$;

revoke all on function public.set_project_work_item_archived_v1(uuid,uuid,boolean)
from public,anon;
grant execute on function public.set_project_work_item_archived_v1(uuid,uuid,boolean)
to authenticated;


create or replace function public.delete_archived_project_work_item_v1(
  p_item_id uuid,
  p_household_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'projects','full') then
    raise exception 'Projects & Chores write access required';
  end if;

  delete from public.family_points_ledger
  where household_id=p_household_id and source_work_item_id=p_item_id;

  delete from public.project_work_items
  where id=p_item_id
    and household_id=p_household_id
    and status='archived';

  if not found then raise exception 'Archived responsibility not found'; end if;
  return true;
end;
$$;

revoke all on function public.delete_archived_project_work_item_v1(uuid,uuid)
from public,anon;
grant execute on function public.delete_archived_project_work_item_v1(uuid,uuid)
to authenticated;


create or replace function public.delete_archived_household_project_v1(
  p_project_id uuid,
  p_household_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'projects','full') then
    raise exception 'Projects & Chores write access required';
  end if;

  delete from public.family_points_ledger fpl
  using public.project_work_items pwi
  where pwi.project_id=p_project_id
    and pwi.household_id=p_household_id
    and fpl.source_work_item_id=pwi.id;

  delete from public.project_work_items
  where project_id=p_project_id
    and household_id=p_household_id;

  delete from public.household_projects
  where id=p_project_id
    and household_id=p_household_id
    and status='archived';

  if not found then raise exception 'Archived project not found'; end if;
  return true;
end;
$$;

revoke all on function public.delete_archived_household_project_v1(uuid,uuid)
from public,anon;
grant execute on function public.delete_archived_household_project_v1(uuid,uuid)
to authenticated;


-- Import an existing Calendar event as a points-only Projects & Chores child.
create or replace function public.save_event_project_work_item_v1(
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
  v_event public.calendar_events%rowtype;
  v_id uuid;
  v_due date;
  v_points smallint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'projects','full') then
    raise exception 'Projects & Chores write access required';
  end if;
  if p_item_kind not in ('project_task','chore') then
    raise exception 'Invalid responsibility type';
  end if;

  select * into v_event
  from public.calendar_events
  where id=p_event_id
    and household_id=p_household_id
    and deleted_at is null;

  if not found then raise exception 'Calendar event not found'; end if;
  if v_event.category_id is null then
    raise exception 'The Calendar event needs a category before it can enter Projects & Chores';
  end if;

  if p_project_id is not null and not exists(
    select 1 from public.household_projects
    where id=p_project_id and household_id=p_household_id and status='active'
  ) then
    raise exception 'Project not found';
  end if;

  v_due:=case when v_event.all_day
    then v_event.start_date
    else (v_event.start_at at time zone v_event.event_timezone)::date
  end;

  v_points:=private.project_points_for_v1(
    p_score_duration,p_score_effort,p_score_execution,p_score_responsibility
  );

  if p_id is null then
    insert into public.project_work_items(
      household_id,project_id,item_kind,title,category_id,due_date,location_text,
      assigned_profile_id,points,notes,sync_task,sync_calendar,linked_event_id,
      status,created_by_user_id,score_duration,score_effort,score_execution,
      score_responsibility,task_link_origin
    )
    values(
      p_household_id,case when p_item_kind='project_task' then p_project_id else null end,
      p_item_kind,v_event.title,v_event.category_id,v_due,v_event.location_text,
      p_assigned_profile_id,v_points,nullif(trim(p_notes),''),
      false,true,p_event_id,'open',auth.uid(),
      p_score_duration,p_score_effort,p_score_execution,p_score_responsibility,null
    )
    returning id into v_id;
  else
    update public.project_work_items
    set project_id=case when p_item_kind='project_task' then p_project_id else null end,
        item_kind=p_item_kind,
        title=v_event.title,
        category_id=v_event.category_id,
        due_date=v_due,
        location_text=v_event.location_text,
        assigned_profile_id=p_assigned_profile_id,
        points=v_points,
        notes=nullif(trim(p_notes),''),
        sync_task=false,
        sync_calendar=true,
        linked_event_id=p_event_id,
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

revoke all on function public.save_event_project_work_item_v1(
  uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text
) from public,anon;

grant execute on function public.save_event_project_work_item_v1(
  uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text
) to authenticated;
