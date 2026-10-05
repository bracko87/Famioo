-- Famioo migration 019
-- Reliable owner resolution and task editing/deletion.

create or replace function public.owner_household_context_v1(
  p_household_id uuid
)
returns table(
  household_id uuid,
  timezone text
)
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  return query
  select h.id,h.timezone
  from public.households h
  left join public.household_members hm
    on hm.household_id=h.id
   and hm.user_id=v_user
   and hm.status='active'
  where h.id=p_household_id
    and h.archived_at is null
    and (
      h.created_by_user_id=v_user
      or hm.role='owner'
    )
  limit 1;
end;
$$;

revoke all on function public.owner_household_context_v1(uuid) from public;
grant execute on function public.owner_household_context_v1(uuid) to authenticated;

create or replace function public.create_household_profile_v1(
  p_household_id uuid,
  p_display_name text,
  p_profile_type text default 'child'
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_profile uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists(
    select 1
    from public.owner_household_context_v1(p_household_id)
  ) then
    raise exception 'Only the household owner can create participant profiles';
  end if;

  if nullif(trim(p_display_name),'') is null then
    raise exception 'Display name is required';
  end if;

  if p_profile_type not in ('child','profile_only') then
    raise exception 'Invalid profile type';
  end if;

  insert into public.family_profiles(
    household_id,
    linked_user_id,
    display_name,
    profile_type,
    color_key,
    active
  )
  values(
    p_household_id,
    null,
    trim(p_display_name),
    p_profile_type,
    case when p_profile_type='child' then 'pink' else 'purple' end,
    true
  )
  returning id into v_profile;

  return v_profile;
end;
$$;

revoke all on function public.create_household_profile_v1(uuid,text,text) from public;
grant execute on function public.create_household_profile_v1(uuid,text,text) to authenticated;

create or replace function public.update_task_v1(
  p_task_id uuid,
  p_household_id uuid,
  p_title text,
  p_category_id uuid,
  p_due_date date default null,
  p_location_text text default null,
  p_participants jsonb default '[]'::jsonb,
  p_add_to_calendar boolean default false
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_event uuid;
  v_calendar uuid;
  v_timezone text;
  v_first_profile uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'tasks','full') then
    raise exception 'Tasks write access required';
  end if;
  if nullif(trim(p_title),'') is null then raise exception 'Task name is required'; end if;

  if not exists(
    select 1 from public.tasks
    where id=p_task_id
      and household_id=p_household_id
      and archived_at is null
  ) then
    raise exception 'Task not found';
  end if;

  if p_category_id is null or not exists(
    select 1 from public.event_categories
    where id=p_category_id and household_id=p_household_id and active
  ) then
    raise exception 'A valid category is required';
  end if;

  select x.profile_id into v_first_profile
  from jsonb_to_recordset(coalesce(p_participants,'[]'::jsonb)) as x(profile_id uuid)
  join public.family_profiles fp
    on fp.id=x.profile_id and fp.household_id=p_household_id and fp.active
  limit 1;

  select linked_event_id into v_event
  from public.tasks
  where id=p_task_id;

  update public.tasks
  set title=trim(p_title),
      category_id=p_category_id,
      due_date=p_due_date,
      due_at=null,
      location_text=nullif(trim(p_location_text),''),
      assigned_profile_id=v_first_profile,
      updated_at=now()
  where id=p_task_id;

  delete from public.task_participants where task_id=p_task_id;

  insert into public.task_participants(household_id,task_id,profile_id)
  select p_household_id,p_task_id,x.profile_id
  from jsonb_to_recordset(coalesce(p_participants,'[]'::jsonb)) as x(profile_id uuid)
  join public.family_profiles fp
    on fp.id=x.profile_id and fp.household_id=p_household_id and fp.active
  on conflict(task_id,profile_id) do nothing;

  if p_add_to_calendar then
    if p_due_date is null then
      raise exception 'A date is required when adding this task to Calendar';
    end if;

    select timezone into v_timezone from public.households where id=p_household_id;

    if v_event is null then
      select id into v_calendar
      from public.calendars
      where household_id=p_household_id and active
      order by is_default desc,name
      limit 1;

      if v_calendar is null then raise exception 'No active calendar found'; end if;

      v_event:=public.save_event_v1(
        null,p_household_id,v_calendar,trim(p_title),null,true,
        null,null,p_due_date,p_due_date,v_timezone,
        p_location_text,p_category_id,'household',
        coalesce(p_participants,'[]'::jsonb),null,'[]'::jsonb
      );

      update public.tasks
      set linked_event_id=v_event,updated_at=now()
      where id=p_task_id;
    else
      update public.calendar_events
      set title=trim(p_title),
          category_id=p_category_id,
          description=null,
          all_day=true,
          start_at=null,
          end_at=null,
          start_date=p_due_date,
          end_date=p_due_date,
          location_text=nullif(trim(p_location_text),''),
          updated_at=now()
      where id=v_event
        and household_id=p_household_id
        and deleted_at is null;

      delete from public.event_participants where event_id=v_event;

      insert into public.event_participants(
        household_id,event_id,profile_id,participant_role,can_edit
      )
      select p_household_id,v_event,x.profile_id,'participant',false
      from jsonb_to_recordset(coalesce(p_participants,'[]'::jsonb)) as x(profile_id uuid)
      join public.family_profiles fp
        on fp.id=x.profile_id and fp.household_id=p_household_id and fp.active;
    end if;
  elsif v_event is not null then
    update public.calendar_events
    set deleted_at=now(),
        deleted_by_user_id=v_user,
        updated_at=now()
    where id=v_event
      and household_id=p_household_id
      and deleted_at is null;

    update public.tasks
    set linked_event_id=null,updated_at=now()
    where id=p_task_id;
  end if;

  return p_task_id;
end;
$$;

revoke all on function public.update_task_v1(uuid,uuid,text,uuid,date,text,jsonb,boolean) from public;
grant execute on function public.update_task_v1(uuid,uuid,text,uuid,date,text,jsonb,boolean) to authenticated;

create or replace function public.delete_completed_task_v1(
  p_task_id uuid,
  p_household_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_event uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'tasks','full') then
    raise exception 'Tasks write access required';
  end if;

  select linked_event_id into v_event
  from public.tasks
  where id=p_task_id
    and household_id=p_household_id
    and status='done'
    and archived_at is null;

  if not found then
    raise exception 'Only completed tasks can be deleted';
  end if;

  if v_event is not null then
    update public.calendar_events
    set deleted_at=coalesce(deleted_at,now()),
        deleted_by_user_id=coalesce(deleted_by_user_id,v_user),
        updated_at=now()
    where id=v_event
      and household_id=p_household_id;
  end if;

  delete from public.tasks
  where id=p_task_id
    and household_id=p_household_id
    and status='done';

  return true;
end;
$$;

revoke all on function public.delete_completed_task_v1(uuid,uuid) from public;
grant execute on function public.delete_completed_task_v1(uuid,uuid) to authenticated;
