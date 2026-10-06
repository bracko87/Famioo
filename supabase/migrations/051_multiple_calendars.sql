-- Famioo migration 051
-- Multiple Calendar management for the free Calendar core.

create or replace function public.save_calendar_v1(
  p_calendar_id uuid,
  p_household_id uuid,
  p_name text,
  p_color_key text
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.has_module_access(p_household_id,'calendar','full') then
    raise exception 'Calendar write access required';
  end if;

  if nullif(trim(p_name),'') is null then
    raise exception 'Calendar name is required';
  end if;

  if p_calendar_id is null then
    insert into public.calendars(
      household_id,name,color_key,is_default,active,created_by_user_id
    )
    values(
      p_household_id,trim(p_name),coalesce(nullif(trim(p_color_key),''),'purple'),
      false,true,auth.uid()
    )
    returning id into v_id;
  else
    update public.calendars
    set name=trim(p_name),
        color_key=coalesce(nullif(trim(p_color_key),''),color_key),
        updated_at=now()
    where id=p_calendar_id
      and household_id=p_household_id
      and active
    returning id into v_id;

    if v_id is null then
      raise exception 'Calendar not found';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_calendar_v1(uuid,uuid,text,text) from public,anon;
grant execute on function public.save_calendar_v1(uuid,uuid,text,text) to authenticated;


create or replace function public.set_default_calendar_v1(
  p_household_id uuid,
  p_calendar_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.has_module_access(p_household_id,'calendar','full') then
    raise exception 'Calendar write access required';
  end if;

  if not exists(
    select 1 from public.calendars
    where id=p_calendar_id and household_id=p_household_id and active
  ) then
    raise exception 'Calendar not found';
  end if;

  update public.calendars
  set is_default=(id=p_calendar_id),
      updated_at=case when is_default is distinct from (id=p_calendar_id) then now() else updated_at end
  where household_id=p_household_id
    and active;

  return true;
end;
$$;

revoke all on function public.set_default_calendar_v1(uuid,uuid) from public,anon;
grant execute on function public.set_default_calendar_v1(uuid,uuid) to authenticated;


create or replace function public.archive_calendar_v1(
  p_household_id uuid,
  p_calendar_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_default boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.has_module_access(p_household_id,'calendar','full') then
    raise exception 'Calendar write access required';
  end if;

  select is_default into v_default
  from public.calendars
  where id=p_calendar_id
    and household_id=p_household_id
    and active;

  if not found then
    raise exception 'Calendar not found';
  end if;

  if v_default then
    raise exception 'Choose another default calendar before archiving this one';
  end if;

  update public.calendars
  set active=false,
      updated_at=now()
  where id=p_calendar_id
    and household_id=p_household_id;

  return true;
end;
$$;

revoke all on function public.archive_calendar_v1(uuid,uuid) from public,anon;
grant execute on function public.archive_calendar_v1(uuid,uuid) to authenticated;
