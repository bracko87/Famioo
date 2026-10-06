-- Famioo migration 055
-- Local calendar file import: no public feed URL or OAuth required.

alter table public.calendar_connections
  drop constraint if exists calendar_connections_provider_check;

alter table public.calendar_connections
  add constraint calendar_connections_provider_check
  check(provider = any(array['ics'::text,'file'::text,'microsoft'::text,'google'::text]));


create or replace function public.create_calendar_file_import_v1(
  p_household_id uuid,
  p_display_name text,
  p_target_calendar_id uuid,
  p_import_mode text default 'busy'
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

  if not private.has_module_access(p_household_id,'calendar_connections','full') then
    raise exception 'Calendar Connections write access required';
  end if;

  if nullif(trim(p_display_name),'') is null then
    raise exception 'Connection name is required';
  end if;

  if p_import_mode not in ('busy','title','full') then
    raise exception 'Invalid import mode';
  end if;

  if not exists(
    select 1
    from public.calendars
    where household_id=p_household_id
      and id=p_target_calendar_id
      and active
  ) then
    raise exception 'Target calendar not found';
  end if;

  insert into public.calendar_connections(
    household_id,provider,display_name,target_calendar_id,
    import_mode,feed_url,status,sync_enabled,created_by_user_id
  )
  values(
    p_household_id,'file',trim(p_display_name),p_target_calendar_id,
    p_import_mode,null,'connected',false,auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_calendar_file_import_v1(uuid,text,uuid,text) from public,anon;
grant execute on function public.create_calendar_file_import_v1(uuid,text,uuid,text) to authenticated;
