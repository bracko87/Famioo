-- Famioo migration 054
-- Safe server-side import path for read-only external calendar events.

create or replace function public.upsert_external_calendar_event_v1(
  p_connection_id uuid,
  p_external_uid text,
  p_title text,
  p_description text,
  p_all_day boolean,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_start_date date,
  p_end_date date,
  p_timezone text,
  p_location_text text,
  p_category_id uuid,
  p_external_updated_at timestamptz,
  p_rrule text default null,
  p_exception_dates date[] default array[]::date[],
  p_exception_instants timestamptz[] default array[]::timestamptz[]
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_connection public.calendar_connections%rowtype;
  v_event uuid;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  select * into v_connection
  from public.calendar_connections
  where id=p_connection_id;

  if not found then
    raise exception 'Calendar connection not found';
  end if;

  if not private.has_module_access(v_connection.household_id,'calendar_connections','full')
     or not private.has_module_access(v_connection.household_id,'calendar','full')
  then
    raise exception 'Calendar connection write access required';
  end if;

  if nullif(trim(p_external_uid),'') is null then
    raise exception 'External event UID is required';
  end if;

  if nullif(trim(p_title),'') is null then
    raise exception 'Event title is required';
  end if;

  if not exists(
    select 1 from pg_catalog.pg_timezone_names where name=p_timezone
  ) then
    raise exception 'Invalid timezone';
  end if;

  if not exists(
    select 1
    from public.calendars
    where id=v_connection.target_calendar_id
      and household_id=v_connection.household_id
      and active
  ) then
    raise exception 'Target calendar is not active';
  end if;

  if p_category_id is not null and not exists(
    select 1
    from public.event_categories
    where id=p_category_id
      and household_id=v_connection.household_id
      and active
  ) then
    raise exception 'Invalid event category';
  end if;

  select id into v_event
  from public.calendar_events
  where external_connection_id=p_connection_id
    and external_uid=p_external_uid
  limit 1;

  if v_event is null then
    insert into public.calendar_events(
      household_id,calendar_id,category_id,title,description,all_day,
      start_at,end_at,start_date,end_date,event_timezone,location_text,
      visibility,status,created_by_user_id,
      external_connection_id,external_uid,external_updated_at,external_read_only
    )
    values(
      v_connection.household_id,
      v_connection.target_calendar_id,
      p_category_id,
      trim(p_title),
      nullif(trim(p_description),''),
      p_all_day,
      case when p_all_day then null else p_start_at end,
      case when p_all_day then null else p_end_at end,
      case when p_all_day then p_start_date else null end,
      case when p_all_day then p_end_date else null end,
      p_timezone,
      nullif(trim(p_location_text),''),
      'household',
      'active',
      v_user,
      p_connection_id,
      trim(p_external_uid),
      p_external_updated_at,
      true
    )
    returning id into v_event;
  else
    update public.calendar_events
    set calendar_id=v_connection.target_calendar_id,
        category_id=p_category_id,
        title=trim(p_title),
        description=nullif(trim(p_description),''),
        all_day=p_all_day,
        start_at=case when p_all_day then null else p_start_at end,
        end_at=case when p_all_day then null else p_end_at end,
        start_date=case when p_all_day then p_start_date else null end,
        end_date=case when p_all_day then p_end_date else null end,
        event_timezone=p_timezone,
        location_text=nullif(trim(p_location_text),''),
        visibility='household',
        status='active',
        deleted_at=null,
        deleted_by_user_id=null,
        external_updated_at=p_external_updated_at,
        external_read_only=true,
        updated_at=now()
    where id=v_event;
  end if;

  if nullif(trim(p_rrule),'') is null then
    delete from public.event_recurrence_rules
    where household_id=v_connection.household_id
      and event_id=v_event;
  else
    insert into public.event_recurrence_rules(
      household_id,event_id,rrule,timezone,exception_dates,exception_instants
    )
    values(
      v_connection.household_id,
      v_event,
      trim(p_rrule),
      p_timezone,
      coalesce(p_exception_dates,array[]::date[]),
      coalesce(p_exception_instants,array[]::timestamptz[])
    )
    on conflict(household_id,event_id)
    do update set
      rrule=excluded.rrule,
      timezone=excluded.timezone,
      exception_dates=excluded.exception_dates,
      exception_instants=excluded.exception_instants,
      updated_at=now();
  end if;

  return v_event;
end;
$$;

revoke all on function public.upsert_external_calendar_event_v1(
  uuid,text,text,text,boolean,timestamptz,timestamptz,date,date,text,text,uuid,timestamptz,text,date[],timestamptz[]
) from public,anon;
grant execute on function public.upsert_external_calendar_event_v1(
  uuid,text,text,text,boolean,timestamptz,timestamptz,date,date,text,text,uuid,timestamptz,text,date[],timestamptz[]
) to authenticated;


create or replace function public.delete_external_calendar_event_v1(
  p_connection_id uuid,
  p_external_uid text
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_household uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select household_id into v_household
  from public.calendar_connections
  where id=p_connection_id;

  if v_household is null then
    raise exception 'Calendar connection not found';
  end if;

  if not private.has_module_access(v_household,'calendar_connections','full') then
    raise exception 'Calendar connection write access required';
  end if;

  delete from public.calendar_events
  where external_connection_id=p_connection_id
    and external_uid=p_external_uid;

  return true;
end;
$$;

revoke all on function public.delete_external_calendar_event_v1(uuid,text) from public,anon;
grant execute on function public.delete_external_calendar_event_v1(uuid,text) to authenticated;


create or replace function public.prune_external_calendar_events_v1(
  p_connection_id uuid,
  p_seen_external_uids text[]
)
returns integer
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_household uuid;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select household_id into v_household
  from public.calendar_connections
  where id=p_connection_id;

  if v_household is null then
    raise exception 'Calendar connection not found';
  end if;

  if not private.has_module_access(v_household,'calendar_connections','full') then
    raise exception 'Calendar connection write access required';
  end if;

  delete from public.calendar_events
  where external_connection_id=p_connection_id
    and (
      coalesce(array_length(p_seen_external_uids,1),0)=0
      or external_uid<>all(p_seen_external_uids)
    );

  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.prune_external_calendar_events_v1(uuid,text[]) from public,anon;
grant execute on function public.prune_external_calendar_events_v1(uuid,text[]) to authenticated;
