-- Famioo migration 027
-- Harden household-user attachment so the owner can never be demoted by this helper.

create or replace function public.attach_household_user_v1(
  p_household_id uuid,
  p_user_id uuid,
  p_display_name text,
  p_role text default 'user'
)
returns uuid
language plpgsql
security definer
set search_path = public, private, auth, pg_temp
as $$
declare
  v_profile_id uuid;
  v_timezone text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_household_owner(p_household_id) then
    raise exception 'Owner access required';
  end if;

  if p_role not in ('admin','user') then
    raise exception 'Invalid role';
  end if;

  if nullif(trim(p_display_name),'') is null then
    raise exception 'Display name is required';
  end if;

  if exists(
    select 1
    from public.household_members
    where household_id=p_household_id
      and user_id=p_user_id
      and role='owner'
  ) then
    raise exception 'The household owner cannot be changed by this action';
  end if;

  if not exists(select 1 from auth.users where id=p_user_id) then
    raise exception 'Auth user not found';
  end if;

  select timezone
  into v_timezone
  from public.households
  where id=p_household_id;

  if v_timezone is null then
    raise exception 'Household not found';
  end if;

  insert into public.user_profiles(
    id,display_name,default_timezone
  )
  values(
    p_user_id,trim(p_display_name),v_timezone
  )
  on conflict(id)
  do update set
    display_name=excluded.display_name,
    updated_at=now();

  insert into public.household_members(
    household_id,user_id,role,status,updated_at
  )
  values(
    p_household_id,p_user_id,p_role,'active',now()
  )
  on conflict(household_id,user_id)
  do update set
    role=excluded.role,
    status='active',
    updated_at=now();

  select id
  into v_profile_id
  from public.family_profiles
  where household_id=p_household_id
    and linked_user_id=p_user_id
  limit 1;

  if v_profile_id is null then
    insert into public.family_profiles(
      household_id,linked_user_id,display_name,profile_type,color_key,active
    )
    values(
      p_household_id,p_user_id,trim(p_display_name),'adult',
      case when p_role='admin' then 'blue' else 'green' end,
      true
    )
    returning id into v_profile_id;
  else
    update public.family_profiles
    set display_name=trim(p_display_name),
        profile_type='adult',
        active=true,
        updated_at=now()
    where id=v_profile_id;
  end if;

  insert into public.notification_preferences(
    household_id,user_id,timezone
  )
  values(
    p_household_id,p_user_id,v_timezone
  )
  on conflict(household_id,user_id) do nothing;

  return v_profile_id;
end;
$$;

revoke all on function public.attach_household_user_v1(uuid,uuid,text,text) from public;
grant execute on function public.attach_household_user_v1(uuid,uuid,text,text) to authenticated;
