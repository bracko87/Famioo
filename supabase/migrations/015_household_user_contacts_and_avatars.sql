-- Famioo migration 015
-- Expose household user contact and avatar data to household members.

drop function if exists public.household_users_v1(uuid);

create function public.household_users_v1(
  p_household_id uuid
)
returns table(
  user_id uuid,
  email text,
  phone text,
  display_name text,
  avatar_path text,
  role text,
  status text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;

  return query
  select
    hm.user_id,
    u.email::text,
    u.phone::text,
    coalesce(
      fp.display_name,
      up.display_name,
      nullif(split_part(coalesce(u.email,''),'@',1),''),
      nullif(u.phone,''),
      'Member'
    )::text as display_name,
    fp.avatar_path,
    hm.role,
    hm.status,
    hm.joined_at
  from public.household_members hm
  join auth.users u on u.id=hm.user_id
  left join public.user_profiles up on up.id=hm.user_id
  left join public.family_profiles fp
    on fp.household_id=hm.household_id
   and fp.linked_user_id=hm.user_id
   and fp.active
  where hm.household_id=p_household_id
  order by
    case hm.role when 'owner' then 1 when 'admin' then 2 else 3 end,
    lower(coalesce(fp.display_name,up.display_name,u.email,u.phone,'Member'));
end;
$$;

revoke all on function public.household_users_v1(uuid) from public;
grant execute on function public.household_users_v1(uuid) to authenticated;
