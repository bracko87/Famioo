-- Famioo migration 111
-- Fix a bad PostgreSQL regex escape in migration 081.
-- The two-backslash pattern can reject valid international phone numbers
-- such as +49... even when the React form accepts them.
-- This repair preserves the existing household permission checks and RPC.
-- Deploy separately to the Famioo Supabase backend; frontend deployment alone
-- cannot repair an existing PostgreSQL check constraint.

alter table public.family_profiles
  drop constraint if exists family_profiles_contact_phone_check;

alter table public.family_profiles
  add constraint family_profiles_contact_phone_check
  check (
    contact_phone is null
    or (
      length(trim(contact_phone)) between 6 and 32
      and trim(contact_phone) ~ '^[+]?[0-9 ()/.-]+$'
    )
  );

create or replace function public.set_household_profile_phone_v1(
  p_household_id uuid,
  p_profile_id uuid,
  p_phone text
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_linked_user uuid;
  v_role text;
  v_phone text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;

  select linked_user_id into v_linked_user
  from public.family_profiles
  where household_id=p_household_id
    and id=p_profile_id
    and active;

  if not found then raise exception 'Family profile not found'; end if;

  select role into v_role
  from public.household_members
  where household_id=p_household_id
    and user_id=v_user
    and status='active';

  if v_linked_user is distinct from v_user
     and coalesce(v_role,'user') not in ('owner','admin')
  then
    raise exception 'Only the profile owner or a household admin can change this phone number';
  end if;

  v_phone:=nullif(trim(p_phone),'');

  if v_phone is not null and (
    length(v_phone) not between 6 and 32
    or v_phone !~ '^[+]?[0-9 ()/.-]+
  ) then
    raise exception 'Use a valid phone number';
  end if;

  update public.family_profiles
  set contact_phone=v_phone,
      updated_at=now()
  where household_id=p_household_id
    and id=p_profile_id;

  return true;
end;
$$;

revoke all on function public.set_household_profile_phone_v1(uuid,uuid,text)
from public,anon;
grant execute on function public.set_household_profile_phone_v1(uuid,uuid,text)
to authenticated;
  ) then
    raise exception 'Use a valid phone number';
  end if;

  update public.family_profiles
  set contact_phone=v_phone,
      updated_at=now()
  where household_id=p_household_id
    and id=p_profile_id;

  return true;
end;
$$;

revoke all on function public.set_household_profile_phone_v1(uuid,uuid,text)
from public,anon;
grant execute on function public.set_household_profile_phone_v1(uuid,uuid,text)
to authenticated;

-- Verify after applying: authenticated household owner/own-profile write
-- with a real +country-code number succeeds, other-household write fails,
-- and household_users_v1 returns the updated contact_phone.
