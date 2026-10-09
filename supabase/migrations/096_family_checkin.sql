-- Famioo migration 096
-- Family Check-In V1.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'checkin',
  'Family Check-In',
  'Quick family status updates: home, safe, pickup requests and running late',
  'circle-check-big',
  48,
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
select h.id,'checkin',r.role,'full'
from public.households h
cross join (values ('owner'::text),('admin'::text),('user'::text)) as r(role)
on conflict(household_id,module_code,role)
do update set access_level='full',updated_at=now();

create table if not exists public.family_checkins(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  profile_id uuid references public.family_profiles(id) on delete set null,
  checkin_type text not null check(checkin_type in ('home','safe','pickup','late')),
  note text,
  eta_minutes integer check(eta_minutes is null or eta_minutes between 1 and 1440),
  event_id uuid references public.calendar_events(id) on delete set null,
  latitude double precision check(latitude is null or latitude between -90 and 90),
  longitude double precision check(longitude is null or longitude between -180 and 180),
  accuracy_m double precision check(accuracy_m is null or accuracy_m>=0),
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check(
    (latitude is null and longitude is null)
    or (latitude is not null and longitude is not null)
  )
);

create index if not exists family_checkins_household_created_idx
  on public.family_checkins(household_id,created_at desc,id);

create index if not exists family_checkins_profile_created_idx
  on public.family_checkins(profile_id,created_at desc)
  where profile_id is not null;

create index if not exists family_checkins_creator_idx
  on public.family_checkins(created_by_user_id,created_at desc);

create index if not exists family_checkins_event_idx
  on public.family_checkins(event_id,created_at desc)
  where event_id is not null;

alter table public.family_checkins enable row level security;

drop policy if exists family_checkins_read on public.family_checkins;
create policy family_checkins_read
on public.family_checkins
for select to authenticated
using(private.has_module_access(household_id,'checkin','read'));

drop policy if exists family_checkins_insert on public.family_checkins;
create policy family_checkins_insert
on public.family_checkins
for insert to authenticated
with check(
  private.has_module_access(household_id,'checkin','full')
  and created_by_user_id=(select auth.uid())
  and (
    profile_id is null
    or exists(
      select 1 from public.family_profiles fp
      where fp.id=profile_id
        and fp.household_id=household_id
        and fp.active
        and fp.linked_user_id=(select auth.uid())
    )
  )
  and (
    event_id is null
    or exists(
      select 1 from public.calendar_events ce
      where ce.id=event_id and ce.household_id=household_id and ce.deleted_at is null
    )
  )
);

drop policy if exists family_checkins_delete on public.family_checkins;
create policy family_checkins_delete
on public.family_checkins
for delete to authenticated
using(
  private.has_module_access(household_id,'checkin','full')
  and (
    created_by_user_id=(select auth.uid())
    or exists(
      select 1 from public.household_members hm
      where hm.household_id=family_checkins.household_id
        and hm.user_id=(select auth.uid())
        and hm.status='active'
        and hm.role in ('owner','admin')
    )
  )
);

grant select,insert,delete on public.family_checkins to authenticated;

create or replace function public.create_family_checkin_v1(
  p_household_id uuid,
  p_profile_id uuid,
  p_checkin_type text,
  p_note text default null,
  p_eta_minutes integer default null,
  p_event_id uuid default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_m double precision default null
)
returns uuid
language plpgsql
security invoker
set search_path=public,private,pg_temp
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'checkin','full') then
    raise exception 'Family Check-In write access required';
  end if;
  if p_checkin_type not in ('home','safe','pickup','late') then
    raise exception 'Invalid check-in type';
  end if;
  if p_eta_minutes is not null and (p_eta_minutes<1 or p_eta_minutes>1440) then
    raise exception 'ETA must be between 1 and 1440 minutes';
  end if;
  if p_profile_id is not null and not exists(
    select 1 from public.family_profiles fp
    where fp.id=p_profile_id and fp.household_id=p_household_id
      and fp.active and fp.linked_user_id=auth.uid()
  ) then raise exception 'You can only check in as your linked family profile'; end if;
  if p_event_id is not null and not exists(
    select 1 from public.calendar_events ce
    where ce.id=p_event_id and ce.household_id=p_household_id and ce.deleted_at is null
  ) then raise exception 'Calendar event not found'; end if;
  if (p_latitude is null)<>(p_longitude is null) then
    raise exception 'Latitude and longitude must be provided together';
  end if;

  insert into public.family_checkins(
    household_id,profile_id,checkin_type,note,eta_minutes,event_id,
    latitude,longitude,accuracy_m,created_by_user_id
  )
  values(
    p_household_id,p_profile_id,p_checkin_type,
    nullif(trim(coalesce(p_note,'')),''),
    case when p_checkin_type='late' then p_eta_minutes else null end,
    p_event_id,p_latitude,p_longitude,p_accuracy_m,auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.delete_family_checkin_v1(
  p_household_id uuid,
  p_checkin_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  delete from public.family_checkins
  where id=p_checkin_id and household_id=p_household_id;

  return found;
end;
$$;

revoke all on function public.create_family_checkin_v1(uuid,uuid,text,text,integer,uuid,double precision,double precision,double precision) from public,anon;
revoke all on function public.delete_family_checkin_v1(uuid,uuid) from public,anon;
grant execute on function public.create_family_checkin_v1(uuid,uuid,text,text,integer,uuid,double precision,double precision,double precision) to authenticated;
grant execute on function public.delete_family_checkin_v1(uuid,uuid) to authenticated;
