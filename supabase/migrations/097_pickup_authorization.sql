-- Famioo migration 097
-- Pickup Authorization V1.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'pickup_authorization',
  'Pickup Authorization',
  'One-time child pickup authorizations with approved contacts and guardian confirmation',
  'badge-check',
  49,
  true,
  true
)
on conflict(code) do update set
  name=excluded.name,
  description=excluded.description,
  icon_key=excluded.icon_key,
  sort_order=excluded.sort_order,
  is_core=true,
  is_active=true;

insert into public.module_role_permissions(household_id,module_code,role,access_level)
select h.id,'pickup_authorization',r.role,'full'
from public.households h
cross join (values ('owner'::text),('admin'::text),('user'::text)) as r(role)
on conflict(household_id,module_code,role)
do update set access_level='full',updated_at=now();

create table if not exists public.family_pickup_authorizations(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  child_profile_id uuid not null references public.family_profiles(id) on delete cascade,
  pickup_contact_id uuid not null references public.family_contacts(id) on delete restrict,
  pickup_date date not null,
  valid_from time,
  valid_until time,
  note text,
  status text not null default 'authorized' check(status in ('authorized','confirmed','cancelled')),
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  confirmed_by_user_id uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  cancelled_by_user_id uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(valid_from is null or valid_until is null or valid_until > valid_from)
);

create index if not exists family_pickup_authorizations_household_date_idx
  on public.family_pickup_authorizations(household_id,pickup_date desc,status,created_at desc);
create index if not exists family_pickup_authorizations_child_date_idx
  on public.family_pickup_authorizations(child_profile_id,pickup_date desc);
create index if not exists family_pickup_authorizations_contact_idx
  on public.family_pickup_authorizations(pickup_contact_id,pickup_date desc);
create index if not exists family_pickup_authorizations_creator_idx
  on public.family_pickup_authorizations(created_by_user_id,created_at desc);
create index if not exists family_pickup_authorizations_confirmer_idx
  on public.family_pickup_authorizations(confirmed_by_user_id)
  where confirmed_by_user_id is not null;
create index if not exists family_pickup_authorizations_canceller_idx
  on public.family_pickup_authorizations(cancelled_by_user_id)
  where cancelled_by_user_id is not null;

alter table public.family_pickup_authorizations enable row level security;

drop policy if exists family_pickup_authorizations_read on public.family_pickup_authorizations;
create policy family_pickup_authorizations_read
on public.family_pickup_authorizations
for select to authenticated
using(private.has_module_access(household_id,'pickup_authorization','read'));

drop policy if exists family_pickup_authorizations_insert on public.family_pickup_authorizations;
create policy family_pickup_authorizations_insert
on public.family_pickup_authorizations
for insert to authenticated
with check(
  private.has_module_access(household_id,'pickup_authorization','full')
  and created_by_user_id=(select auth.uid())
  and (
    exists(
      select 1 from public.household_members hm
      where hm.household_id=family_pickup_authorizations.household_id
        and hm.user_id=(select auth.uid())
        and hm.status='active'
        and hm.role in ('owner','admin')
    )
    or exists(
      select 1 from public.family_profiles fp
      where fp.household_id=family_pickup_authorizations.household_id
        and fp.linked_user_id=(select auth.uid())
        and fp.active
        and fp.profile_type='adult'
    )
  )
  and exists(
    select 1 from public.family_profiles child
    where child.id=child_profile_id
      and child.household_id=household_id
      and child.active
      and child.profile_type in ('child','profile_only')
  )
  and exists(
    select 1 from public.family_contacts fc
    where fc.id=pickup_contact_id
      and fc.household_id=household_id
      and fc.active
  )
);

drop policy if exists family_pickup_authorizations_update on public.family_pickup_authorizations;
create policy family_pickup_authorizations_update
on public.family_pickup_authorizations
for update to authenticated
using(
  private.has_module_access(household_id,'pickup_authorization','full')
  and (
    exists(
      select 1 from public.household_members hm
      where hm.household_id=family_pickup_authorizations.household_id
        and hm.user_id=(select auth.uid())
        and hm.status='active'
        and hm.role in ('owner','admin')
    )
    or exists(
      select 1 from public.family_profiles fp
      where fp.household_id=family_pickup_authorizations.household_id
        and fp.linked_user_id=(select auth.uid())
        and fp.active
        and fp.profile_type='adult'
    )
  )
)
with check(
  private.has_module_access(household_id,'pickup_authorization','full')
  and exists(
    select 1 from public.family_profiles child
    where child.id=child_profile_id
      and child.household_id=household_id
      and child.active
      and child.profile_type in ('child','profile_only')
  )
  and exists(
    select 1 from public.family_contacts fc
    where fc.id=pickup_contact_id
      and fc.household_id=household_id
      and fc.active
  )
);

grant select,insert,update on public.family_pickup_authorizations to authenticated;

create or replace function public.create_family_pickup_authorization_v1(
  p_household_id uuid,
  p_child_profile_id uuid,
  p_pickup_contact_id uuid,
  p_pickup_date date,
  p_valid_from time default null,
  p_valid_until time default null,
  p_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path=public,private,pg_temp
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'pickup_authorization','full') then
    raise exception 'Pickup Authorization write access required';
  end if;

  if not (
    exists(
      select 1 from public.household_members hm
      where hm.household_id=p_household_id
        and hm.user_id=auth.uid()
        and hm.status='active'
        and hm.role in ('owner','admin')
    )
    or exists(
      select 1 from public.family_profiles fp
      where fp.household_id=p_household_id
        and fp.linked_user_id=auth.uid()
        and fp.active
        and fp.profile_type='adult'
    )
  ) then raise exception 'Only an adult guardian can authorize pickup'; end if;

  if not exists(
    select 1 from public.family_profiles fp
    where fp.id=p_child_profile_id
      and fp.household_id=p_household_id
      and fp.active
      and fp.profile_type in ('child','profile_only')
  ) then raise exception 'Child profile not found'; end if;

  if not exists(
    select 1 from public.family_contacts fc
    where fc.id=p_pickup_contact_id
      and fc.household_id=p_household_id
      and fc.active
  ) then raise exception 'Pickup contact not found'; end if;

  if p_pickup_date < current_date then
    raise exception 'Pickup date cannot be in the past';
  end if;

  if p_valid_from is not null and p_valid_until is not null and p_valid_until<=p_valid_from then
    raise exception 'End time must be after start time';
  end if;

  insert into public.family_pickup_authorizations(
    household_id,child_profile_id,pickup_contact_id,pickup_date,
    valid_from,valid_until,note,status,created_by_user_id
  )
  values(
    p_household_id,p_child_profile_id,p_pickup_contact_id,p_pickup_date,
    p_valid_from,p_valid_until,nullif(trim(coalesce(p_note,'')),''),
    'authorized',auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.confirm_family_pickup_authorization_v1(
  p_household_id uuid,
  p_authorization_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'pickup_authorization','full') then
    raise exception 'Pickup Authorization write access required';
  end if;

  if not (
    exists(
      select 1 from public.household_members hm
      where hm.household_id=p_household_id
        and hm.user_id=auth.uid()
        and hm.status='active'
        and hm.role in ('owner','admin')
    )
    or exists(
      select 1 from public.family_profiles fp
      where fp.household_id=p_household_id
        and fp.linked_user_id=auth.uid()
        and fp.active
        and fp.profile_type='adult'
    )
  ) then raise exception 'Only an adult guardian can confirm pickup'; end if;

  update public.family_pickup_authorizations
  set status='confirmed',
      confirmed_by_user_id=auth.uid(),
      confirmed_at=now(),
      cancelled_by_user_id=null,
      cancelled_at=null,
      updated_at=now()
  where id=p_authorization_id
    and household_id=p_household_id
    and status='authorized'
    and pickup_date<=current_date;

  return found;
end;
$$;

create or replace function public.cancel_family_pickup_authorization_v1(
  p_household_id uuid,
  p_authorization_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'pickup_authorization','full') then
    raise exception 'Pickup Authorization write access required';
  end if;

  if not (
    exists(
      select 1 from public.household_members hm
      where hm.household_id=p_household_id
        and hm.user_id=auth.uid()
        and hm.status='active'
        and hm.role in ('owner','admin')
    )
    or exists(
      select 1 from public.family_profiles fp
      where fp.household_id=p_household_id
        and fp.linked_user_id=auth.uid()
        and fp.active
        and fp.profile_type='adult'
    )
  ) then raise exception 'Only an adult guardian can cancel pickup authorization'; end if;

  update public.family_pickup_authorizations
  set status='cancelled',
      cancelled_by_user_id=auth.uid(),
      cancelled_at=now(),
      updated_at=now()
  where id=p_authorization_id
    and household_id=p_household_id
    and status='authorized';

  return found;
end;
$$;

revoke all on function public.create_family_pickup_authorization_v1(uuid,uuid,uuid,date,time,time,text) from public,anon;
revoke all on function public.confirm_family_pickup_authorization_v1(uuid,uuid) from public,anon;
revoke all on function public.cancel_family_pickup_authorization_v1(uuid,uuid) from public,anon;
grant execute on function public.create_family_pickup_authorization_v1(uuid,uuid,uuid,date,time,time,text) to authenticated;
grant execute on function public.confirm_family_pickup_authorization_v1(uuid,uuid) to authenticated;
grant execute on function public.cancel_family_pickup_authorization_v1(uuid,uuid) to authenticated;
