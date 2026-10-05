-- Famioo migration 018
-- Household people can be login users or profile-only children.

drop function if exists public.household_users_v1(uuid);

create function public.household_users_v1(
  p_household_id uuid
)
returns table(
  profile_id uuid,
  user_id uuid,
  email text,
  phone text,
  display_name text,
  avatar_path text,
  profile_type text,
  role text,
  status text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;

  return query
  select
    fp.id as profile_id,
    fp.linked_user_id as user_id,
    u.email::text,
    u.phone::text,
    fp.display_name::text,
    fp.avatar_path,
    fp.profile_type,
    coalesce(hm.role,'profile')::text as role,
    coalesce(hm.status,'active')::text as status,
    coalesce(hm.joined_at,fp.created_at) as joined_at
  from public.family_profiles fp
  left join auth.users u on u.id=fp.linked_user_id
  left join public.household_members hm
    on hm.household_id=fp.household_id
   and hm.user_id=fp.linked_user_id
  where fp.household_id=p_household_id
    and fp.active
  order by
    case coalesce(hm.role,'profile')
      when 'owner' then 1
      when 'admin' then 2
      when 'user' then 3
      else 4
    end,
    lower(fp.display_name);
end;
$$;

revoke all on function public.household_users_v1(uuid) from public;
grant execute on function public.household_users_v1(uuid) to authenticated;
