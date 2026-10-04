-- Famioo migration 016
-- Keep default calendar categories consistent for every new household.

update public.event_categories
set sort_order = case lower(name)
  when 'family' then 10
  when 'work' then 20
  when 'school' then 30
  when 'medical' then 40
  when 'birthday' then 50
  when 'travel' then 60
  when 'sport' then 70
  when 'other' then 80
  else sort_order
end,
updated_at = now()
where is_system
  and lower(name) in ('family','work','school','medical','birthday','travel','sport','other');

create or replace function public.create_household_v1(
  p_name text,
  p_timezone text default 'Europe/Berlin',
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_household uuid;
  v_display text;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  if nullif(trim(p_name),'') is null then
    raise exception 'Household name is required';
  end if;

  if not exists(
    select 1 from pg_catalog.pg_timezone_names where name=p_timezone
  ) then
    raise exception 'Invalid timezone';
  end if;

  select coalesce(
    nullif(trim(p_display_name),''),
    nullif(trim(up.display_name),''),
    nullif(split_part(coalesce(u.email,''),'@',1),''),
    nullif(u.phone,''),
    'Member'
  )
  into v_display
  from auth.users u
  left join public.user_profiles up on up.id=u.id
  where u.id=v_user;

  insert into public.households(
    name,timezone,created_by_user_id
  )
  values(
    trim(p_name),p_timezone,v_user
  )
  returning id into v_household;

  insert into public.household_members(
    household_id,user_id,role,status
  )
  values(
    v_household,v_user,'owner','active'
  );

  insert into public.family_profiles(
    household_id,linked_user_id,display_name,profile_type,color_key
  )
  values(
    v_household,v_user,v_display,'adult','purple'
  );

  insert into public.calendars(
    household_id,name,color_key,is_default,created_by_user_id
  )
  values(
    v_household,'Family','purple',true,v_user
  );

  insert into public.event_categories(
    household_id,name,color_key,icon_key,sort_order,is_system,created_by_user_id
  )
  values
    (v_household,'Family','purple','family',10,true,v_user),
    (v_household,'Work','blue','work',20,true,v_user),
    (v_household,'School','indigo','school',30,true,v_user),
    (v_household,'Medical','green','medical',40,true,v_user),
    (v_household,'Birthday','pink','birthday',50,true,v_user),
    (v_household,'Travel','orange','travel',60,true,v_user),
    (v_household,'Sport','teal','sport',70,true,v_user),
    (v_household,'Other','slate','other',80,true,v_user);

  insert into public.household_modules(
    household_id,module_code,enabled,source,enabled_at
  )
  select
    v_household,
    m.code,
    m.is_core,
    'default',
    case when m.is_core then now() else null end
  from public.modules m
  where m.is_active;

  insert into public.module_role_permissions(
    household_id,module_code,role,access_level
  )
  select
    v_household,
    m.code,
    r.role,
    r.access_level
  from public.modules m
  cross join (
    values
      ('owner'::text,'full'::text),
      ('admin'::text,'full'::text),
      ('user'::text,'read'::text)
  ) as r(role,access_level)
  where m.is_active;

  insert into public.notification_preferences(
    household_id,user_id,timezone
  )
  values(
    v_household,v_user,p_timezone
  );

  return v_household;
end;
$$;
