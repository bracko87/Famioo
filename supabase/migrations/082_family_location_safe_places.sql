-- Famioo migration 082
-- Family Location + Safe Places PWA V1.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'location',
  'Family Location',
  'Shared family location, safe places and arrival/departure alerts',
  'map-pinned',
  36,
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

insert into public.module_role_permissions(
  household_id,module_code,role,access_level
)
select h.id,'location',r.role,'full'
from public.households h
cross join (values ('owner'::text),('admin'::text),('user'::text)) as r(role)
on conflict(household_id,module_code,role)
do update set access_level='full',updated_at=now();

create table if not exists public.family_location_settings(
  household_id uuid not null references public.households(id) on delete cascade,
  profile_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  sharing_enabled boolean not null default false,
  visibility_scope text not null default 'adults'
    check(visibility_scope in ('household','adults','private')),
  arrival_departure_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(household_id,profile_id),
  foreign key(household_id,profile_id)
    references public.family_profiles(household_id,id)
    on delete cascade
);

create unique index if not exists family_location_settings_household_user_uidx
  on public.family_location_settings(household_id,user_id);

create table if not exists public.family_location_positions(
  household_id uuid not null references public.households(id) on delete cascade,
  profile_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  accuracy_m double precision check(accuracy_m is null or accuracy_m>=0),
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(household_id,profile_id),
  foreign key(household_id,profile_id)
    references public.family_profiles(household_id,id)
    on delete cascade
);

create index if not exists family_location_positions_household_updated_idx
  on public.family_location_positions(household_id,captured_at desc);

create table if not exists public.safe_places(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 120),
  place_type text not null default 'custom'
    check(place_type in ('home','school','kita','work','grandparents','custom')),
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  radius_m integer not null default 200 check(radius_m between 50 and 2000),
  arrival_alerts boolean not null default true,
  departure_alerts boolean not null default true,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists safe_places_household_active_idx
  on public.safe_places(household_id,active,name);

create table if not exists public.family_geofence_states(
  household_id uuid not null references public.households(id) on delete cascade,
  profile_id uuid not null,
  safe_place_id uuid not null references public.safe_places(id) on delete cascade,
  inside boolean not null,
  last_transition_at timestamptz,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(household_id,profile_id,safe_place_id),
  foreign key(household_id,profile_id)
    references public.family_profiles(household_id,id)
    on delete cascade
);

alter table public.family_location_settings enable row level security;
alter table public.family_location_positions enable row level security;
alter table public.safe_places enable row level security;
alter table public.family_geofence_states enable row level security;

revoke all on public.family_location_settings,public.family_location_positions,public.safe_places,public.family_geofence_states
from public,anon,authenticated;
grant all on public.family_location_settings,public.family_location_positions,public.safe_places,public.family_geofence_states
to service_role;

create or replace function private.is_location_adult(
  p_household_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,private,pg_temp
as $$
  select exists(
    select 1
    from public.household_members hm
    where hm.household_id=p_household_id
      and hm.user_id=p_user_id
      and hm.status='active'
      and (
        hm.role in ('owner','admin')
        or exists(
          select 1
          from public.family_profiles fp
          where fp.household_id=hm.household_id
            and fp.linked_user_id=hm.user_id
            and fp.active
            and fp.profile_type='adult'
        )
      )
  );
$$;

revoke all on function private.is_location_adult(uuid,uuid)
from public,anon,authenticated;

create or replace function private.location_distance_m(
  p_lat1 double precision,
  p_lon1 double precision,
  p_lat2 double precision,
  p_lon2 double precision
)
returns double precision
language sql
immutable
as $$
  select 6371000.0 * 2.0 * asin(
    least(
      1.0,
      sqrt(
        power(sin(radians((p_lat2-p_lat1)/2.0)),2)
        + cos(radians(p_lat1))
          * cos(radians(p_lat2))
          * power(sin(radians((p_lon2-p_lon1)/2.0)),2)
      )
    )
  );
$$;

create or replace function public.my_location_setting_v1(
  p_household_id uuid
)
returns table(
  profile_id uuid,
  sharing_enabled boolean,
  visibility_scope text,
  arrival_departure_enabled boolean
)
language plpgsql
stable
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

  return query
  select
    fp.id,
    coalesce(s.sharing_enabled,false),
    coalesce(s.visibility_scope,'adults'),
    coalesce(s.arrival_departure_enabled,true)
  from public.family_profiles fp
  left join public.family_location_settings s
    on s.household_id=fp.household_id
   and s.profile_id=fp.id
  where fp.household_id=p_household_id
    and fp.active
    and fp.linked_user_id=v_user
  order by fp.created_at
  limit 1;
end;
$$;

revoke all on function public.my_location_setting_v1(uuid) from public,anon;
grant execute on function public.my_location_setting_v1(uuid) to authenticated;

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

  return true;
end;
$$;

revoke all on function public.set_location_sharing_v1(uuid,uuid,boolean,text,boolean)
from public,anon;
grant execute on function public.set_location_sharing_v1(uuid,uuid,boolean,text,boolean)
to authenticated;

create or replace function public.family_locations_v1(
  p_household_id uuid
)
returns table(
  profile_id uuid,
  linked_user_id uuid,
  display_name text,
  profile_type text,
  color_key text,
  avatar_path text,
  is_self boolean,
  sharing_enabled boolean,
  visibility_scope text,
  arrival_departure_enabled boolean,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  captured_at timestamptz
)
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_adult boolean;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;

  v_adult:=private.is_location_adult(p_household_id,v_user);

  return query
  select
    fp.id,
    fp.linked_user_id,
    fp.display_name::text,
    fp.profile_type::text,
    fp.color_key::text,
    fp.avatar_path,
    fp.linked_user_id=v_user,
    coalesce(s.sharing_enabled,false),
    coalesce(s.visibility_scope,'adults'),
    coalesce(s.arrival_departure_enabled,true),
    case when
      fp.linked_user_id=v_user
      or (
        coalesce(s.sharing_enabled,false)
        and (
          s.visibility_scope='household'
          or (s.visibility_scope='adults' and v_adult)
        )
      )
      then p.latitude else null end,
    case when
      fp.linked_user_id=v_user
      or (
        coalesce(s.sharing_enabled,false)
        and (
          s.visibility_scope='household'
          or (s.visibility_scope='adults' and v_adult)
        )
      )
      then p.longitude else null end,
    case when
      fp.linked_user_id=v_user
      or (
        coalesce(s.sharing_enabled,false)
        and (
          s.visibility_scope='household'
          or (s.visibility_scope='adults' and v_adult)
        )
      )
      then p.accuracy_m else null end,
    case when
      fp.linked_user_id=v_user
      or (
        coalesce(s.sharing_enabled,false)
        and (
          s.visibility_scope='household'
          or (s.visibility_scope='adults' and v_adult)
        )
      )
      then p.captured_at else null end
  from public.family_profiles fp
  left join public.family_location_settings s
    on s.household_id=fp.household_id
   and s.profile_id=fp.id
  left join public.family_location_positions p
    on p.household_id=fp.household_id
   and p.profile_id=fp.id
  where fp.household_id=p_household_id
    and fp.active
  order by
    case when fp.linked_user_id=v_user then 0 else 1 end,
    lower(fp.display_name);
end;
$$;

revoke all on function public.family_locations_v1(uuid) from public,anon;
grant execute on function public.family_locations_v1(uuid) to authenticated;

create or replace function public.safe_places_v1(
  p_household_id uuid
)
returns table(
  id uuid,
  name text,
  place_type text,
  latitude double precision,
  longitude double precision,
  radius_m integer,
  arrival_alerts boolean,
  departure_alerts boolean,
  created_at timestamptz
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
    sp.id,sp.name,sp.place_type,sp.latitude,sp.longitude,sp.radius_m,
    sp.arrival_alerts,sp.departure_alerts,sp.created_at
  from public.safe_places sp
  where sp.household_id=p_household_id
    and sp.active
  order by lower(sp.name);
end;
$$;

revoke all on function public.safe_places_v1(uuid) from public,anon;
grant execute on function public.safe_places_v1(uuid) to authenticated;

create or replace function public.save_safe_place_v1(
  p_household_id uuid,
  p_id uuid default null,
  p_name text default null,
  p_place_type text default 'custom',
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_radius_m integer default 200,
  p_arrival_alerts boolean default true,
  p_departure_alerts boolean default true
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.is_household_member(p_household_id) then raise exception 'Household access required'; end if;
  if not private.is_location_adult(p_household_id,v_user) then
    raise exception 'Only an adult household member can manage Safe Places';
  end if;
  if nullif(trim(p_name),'') is null then raise exception 'Safe Place name is required'; end if;
  if p_place_type not in ('home','school','kita','work','grandparents','custom') then
    raise exception 'Invalid Safe Place type';
  end if;
  if p_latitude is null or p_latitude not between -90 and 90 then raise exception 'Invalid latitude'; end if;
  if p_longitude is null or p_longitude not between -180 and 180 then raise exception 'Invalid longitude'; end if;
  if p_radius_m not between 50 and 2000 then raise exception 'Safe Place radius must be 50–2000 metres'; end if;

  if p_id is null then
    insert into public.safe_places(
      household_id,name,place_type,latitude,longitude,radius_m,
      arrival_alerts,departure_alerts,created_by_user_id,
      created_at,updated_at
    )
    values(
      p_household_id,trim(p_name),p_place_type,p_latitude,p_longitude,p_radius_m,
      p_arrival_alerts,p_departure_alerts,v_user,now(),now()
    )
    returning id into v_id;
  else
    update public.safe_places
    set name=trim(p_name),
        place_type=p_place_type,
        latitude=p_latitude,
        longitude=p_longitude,
        radius_m=p_radius_m,
        arrival_alerts=p_arrival_alerts,
        departure_alerts=p_departure_alerts,
        updated_at=now()
    where id=p_id
      and household_id=p_household_id
      and active
    returning id into v_id;

    if v_id is null then raise exception 'Safe Place not found'; end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_safe_place_v1(
  uuid,uuid,text,text,double precision,double precision,integer,boolean,boolean
) from public,anon;
grant execute on function public.save_safe_place_v1(
  uuid,uuid,text,text,double precision,double precision,integer,boolean,boolean
) to authenticated;

create or replace function public.archive_safe_place_v1(
  p_household_id uuid,
  p_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_location_adult(p_household_id,auth.uid()) then
    raise exception 'Only an adult household member can manage Safe Places';
  end if;

  update public.safe_places
  set active=false,updated_at=now()
  where household_id=p_household_id
    and id=p_id
    and active;

  return found;
end;
$$;

revoke all on function public.archive_safe_place_v1(uuid,uuid) from public,anon;
grant execute on function public.archive_safe_place_v1(uuid,uuid) to authenticated;

create or replace function public.update_family_location_v1(
  p_household_id uuid,
  p_profile_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision default null,
  p_captured_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_profile_name text;
  v_arrival_departure boolean;
  v_place record;
  v_inside boolean;
  v_previous_inside boolean;
  v_had_state boolean;
  v_notification_type text;
  v_title text;
  v_body text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.is_household_member(p_household_id) then raise exception 'Household access required'; end if;
  if p_latitude not between -90 and 90 then raise exception 'Invalid latitude'; end if;
  if p_longitude not between -180 and 180 then raise exception 'Invalid longitude'; end if;
  if p_accuracy_m is not null and p_accuracy_m<0 then raise exception 'Invalid location accuracy'; end if;

  select fp.display_name,coalesce(s.arrival_departure_enabled,true)
  into v_profile_name,v_arrival_departure
  from public.family_profiles fp
  join public.family_location_settings s
    on s.household_id=fp.household_id
   and s.profile_id=fp.id
  where fp.household_id=p_household_id
    and fp.id=p_profile_id
    and fp.active
    and fp.linked_user_id=v_user
    and s.user_id=v_user
    and s.sharing_enabled;

  if v_profile_name is null then
    raise exception 'Location sharing is not enabled for this profile';
  end if;

  insert into public.family_location_positions(
    household_id,profile_id,user_id,
    latitude,longitude,accuracy_m,captured_at,updated_at
  )
  values(
    p_household_id,p_profile_id,v_user,
    p_latitude,p_longitude,p_accuracy_m,coalesce(p_captured_at,now()),now()
  )
  on conflict(household_id,profile_id)
  do update set
    user_id=excluded.user_id,
    latitude=excluded.latitude,
    longitude=excluded.longitude,
    accuracy_m=excluded.accuracy_m,
    captured_at=excluded.captured_at,
    updated_at=now();

  if not v_arrival_departure then
    return true;
  end if;

  for v_place in
    select *
    from public.safe_places sp
    where sp.household_id=p_household_id
      and sp.active
  loop
    v_inside:=private.location_distance_m(
      p_latitude,p_longitude,v_place.latitude,v_place.longitude
    )<=v_place.radius_m;

    select gs.inside,true
    into v_previous_inside,v_had_state
    from public.family_geofence_states gs
    where gs.household_id=p_household_id
      and gs.profile_id=p_profile_id
      and gs.safe_place_id=v_place.id;

    if coalesce(v_had_state,false)=false then
      insert into public.family_geofence_states(
        household_id,profile_id,safe_place_id,inside,last_seen_at,updated_at
      )
      values(p_household_id,p_profile_id,v_place.id,v_inside,now(),now())
      on conflict(household_id,profile_id,safe_place_id)
      do nothing;
    else
      update public.family_geofence_states
      set inside=v_inside,
          last_seen_at=now(),
          last_transition_at=case when inside is distinct from v_inside then now() else last_transition_at end,
          updated_at=now()
      where household_id=p_household_id
        and profile_id=p_profile_id
        and safe_place_id=v_place.id;

      if v_previous_inside is distinct from v_inside then
        if v_inside and v_place.arrival_alerts then
          v_notification_type:='location_arrival';
          v_title:=v_profile_name||' arrived at '||v_place.name;
          v_body:='Famioo detected arrival at the Safe Place '||v_place.name||'.';
        elsif not v_inside and v_place.departure_alerts then
          v_notification_type:='location_departure';
          v_title:=v_profile_name||' left '||v_place.name;
          v_body:='Famioo detected departure from the Safe Place '||v_place.name||'.';
        else
          v_notification_type:=null;
        end if;

        if v_notification_type is not null then
          insert into public.notifications(
            household_id,recipient_user_id,notification_type,
            title,body,entity_type,entity_id,scheduled_for,status,source_key
          )
          select
            p_household_id,
            hm.user_id,
            v_notification_type,
            v_title,
            v_body,
            'safe_place',
            v_place.id,
            now(),
            'pending',
            v_notification_type||':'||p_profile_id::text||':'||v_place.id::text||':'||floor(extract(epoch from now())/60)::bigint::text||':'||hm.user_id::text
          from public.household_members hm
          where hm.household_id=p_household_id
            and hm.status='active'
            and hm.user_id<>v_user
            and private.is_location_adult(p_household_id,hm.user_id)
          on conflict(source_key) where source_key is not null do nothing;
        end if;
      end if;
    end if;

    v_had_state:=false;
    v_previous_inside:=null;
  end loop;

  return true;
end;
$$;

revoke all on function public.update_family_location_v1(
  uuid,uuid,double precision,double precision,double precision,timestamptz
) from public,anon;
grant execute on function public.update_family_location_v1(
  uuid,uuid,double precision,double precision,double precision,timestamptz
) to authenticated;
