-- Famioo migration 083
-- Reset Safe Place state when a user disables location sharing so stale
-- arrival/departure transitions are not emitted when sharing is re-enabled.

create or replace function public.set_location_sharing_v1(
  p_household_id uuid,
  p_profile_id uuid,
  p_enabled boolean,
  p_visibility_scope text default 'adults',
  p_arrival_departure_enabled boolean default true
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;
  if p_visibility_scope not in ('household','adults','private') then
    raise exception 'Invalid location visibility';
  end if;

  if not exists(
    select 1
    from public.family_profiles fp
    where fp.household_id=p_household_id
      and fp.id=p_profile_id
      and fp.active
      and fp.linked_user_id=v_user
  ) then
    raise exception 'You can only change your own location sharing';
  end if;

  insert into public.family_location_settings(
    household_id,profile_id,user_id,
    sharing_enabled,visibility_scope,arrival_departure_enabled,
    created_at,updated_at
  )
  values(
    p_household_id,p_profile_id,v_user,
    p_enabled,p_visibility_scope,p_arrival_departure_enabled,
    now(),now()
  )
  on conflict(household_id,profile_id)
  do update set
    user_id=excluded.user_id,
    sharing_enabled=excluded.sharing_enabled,
    visibility_scope=excluded.visibility_scope,
    arrival_departure_enabled=excluded.arrival_departure_enabled,
    updated_at=now();

  if not p_enabled then
    delete from public.family_geofence_states
    where household_id=p_household_id
      and profile_id=p_profile_id;
  end if;

  return true;
end;
$$;

revoke all on function public.set_location_sharing_v1(uuid,uuid,boolean,text,boolean)
from public,anon;
grant execute on function public.set_location_sharing_v1(uuid,uuid,boolean,text,boolean)
to authenticated;
