-- Famioo migration 098
-- TV Remote / Home Remote V1.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values('home_remote','TV Remote / Home Remote','Rooms, TV and streaming-device controls with household permissions','radio-tower',50,true,true)
on conflict(code) do update set
  name=excluded.name,description=excluded.description,icon_key=excluded.icon_key,
  sort_order=excluded.sort_order,is_core=true,is_active=true;

insert into public.module_role_permissions(household_id,module_code,role,access_level)
select h.id,'home_remote',r.role,'full'
from public.households h
cross join (values ('owner'::text),('admin'::text),('user'::text)) as r(role)
on conflict(household_id,module_code,role)
do update set access_level='full',updated_at=now();

create table if not exists public.home_remote_rooms(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 120),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists home_remote_rooms_household_idx on public.home_remote_rooms(household_id,active,sort_order,name);

create table if not exists public.home_remote_devices(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  room_id uuid references public.home_remote_rooms(id) on delete set null,
  name text not null check(length(trim(name)) between 1 and 160),
  device_type text not null default 'tv' check(device_type in ('tv','streamer','audio','other')),
  manufacturer text,
  capabilities text[] not null default '{}'::text[],
  active boolean not null default true,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists home_remote_devices_household_idx on public.home_remote_devices(household_id,active,room_id,name);
create index if not exists home_remote_devices_room_idx on public.home_remote_devices(room_id) where room_id is not null;
create index if not exists home_remote_devices_creator_idx on public.home_remote_devices(created_by_user_id);

create table if not exists public.home_remote_device_permissions(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  device_id uuid not null references public.home_remote_devices(id) on delete cascade,
  profile_id uuid not null references public.family_profiles(id) on delete cascade,
  can_control boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(device_id,profile_id)
);
create index if not exists home_remote_permissions_profile_idx on public.home_remote_device_permissions(profile_id,can_control);

create table if not exists public.home_remote_command_log(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  device_id uuid not null references public.home_remote_devices(id) on delete cascade,
  command text not null,
  requested_by_user_id uuid not null references auth.users(id) on delete cascade,
  success boolean not null default false,
  response_status integer,
  created_at timestamptz not null default now()
);
create index if not exists home_remote_command_log_household_idx on public.home_remote_command_log(household_id,created_at desc);
create index if not exists home_remote_command_log_device_idx on public.home_remote_command_log(device_id,created_at desc);
create index if not exists home_remote_command_log_user_idx on public.home_remote_command_log(requested_by_user_id,created_at desc);

create table if not exists public.home_remote_device_bridges(
  device_id uuid primary key references public.home_remote_devices(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  webhook_url text not null,
  bearer_token text,
  updated_by_user_id uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  check(webhook_url ~ '^https://')
);
create index if not exists home_remote_device_bridges_household_idx on public.home_remote_device_bridges(household_id);

alter table public.home_remote_rooms enable row level security;
alter table public.home_remote_devices enable row level security;
alter table public.home_remote_device_permissions enable row level security;
alter table public.home_remote_command_log enable row level security;
alter table public.home_remote_device_bridges enable row level security;

create policy home_remote_rooms_read on public.home_remote_rooms for select to authenticated
using(private.has_module_access(household_id,'home_remote','read'));
create policy home_remote_rooms_write on public.home_remote_rooms for all to authenticated
using(private.has_module_access(household_id,'home_remote','full'))
with check(private.has_module_access(household_id,'home_remote','full'));

create policy home_remote_devices_read on public.home_remote_devices for select to authenticated
using(private.has_module_access(household_id,'home_remote','read'));
create policy home_remote_devices_write on public.home_remote_devices for all to authenticated
using(private.has_module_access(household_id,'home_remote','full'))
with check(
  private.has_module_access(household_id,'home_remote','full')
  and (room_id is null or exists(select 1 from public.home_remote_rooms r where r.id=room_id and r.household_id=household_id))
);

create policy home_remote_permissions_read on public.home_remote_device_permissions for select to authenticated
using(private.has_module_access(household_id,'home_remote','read'));
create policy home_remote_permissions_write on public.home_remote_device_permissions for all to authenticated
using(
  private.has_module_access(household_id,'home_remote','full')
  and exists(select 1 from public.household_members hm where hm.household_id=home_remote_device_permissions.household_id and hm.user_id=(select auth.uid()) and hm.status='active' and hm.role in ('owner','admin'))
)
with check(
  private.has_module_access(household_id,'home_remote','full')
  and exists(select 1 from public.home_remote_devices d where d.id=device_id and d.household_id=household_id)
  and exists(select 1 from public.family_profiles fp where fp.id=profile_id and fp.household_id=household_id and fp.active)
);

create policy home_remote_command_log_read on public.home_remote_command_log for select to authenticated
using(private.has_module_access(household_id,'home_remote','read'));

create policy home_remote_device_bridges_owner_admin on public.home_remote_device_bridges for all to authenticated
using(exists(select 1 from public.household_members hm where hm.household_id=home_remote_device_bridges.household_id and hm.user_id=(select auth.uid()) and hm.status='active' and hm.role in ('owner','admin')))
with check(
  exists(select 1 from public.household_members hm where hm.household_id=home_remote_device_bridges.household_id and hm.user_id=(select auth.uid()) and hm.status='active' and hm.role in ('owner','admin'))
  and exists(select 1 from public.home_remote_devices d where d.id=device_id and d.household_id=household_id)
);

grant select,insert,update,delete on public.home_remote_rooms,public.home_remote_devices,public.home_remote_device_permissions to authenticated;
grant select on public.home_remote_command_log to authenticated;
grant select,insert,update,delete on public.home_remote_device_bridges to authenticated;

create or replace function public.save_home_remote_room_v1(p_id uuid,p_household_id uuid,p_name text,p_sort_order integer default 0)
returns uuid language plpgsql security invoker set search_path=public,private,pg_temp as $$
declare v_id uuid:=coalesce(p_id,gen_random_uuid());
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'home_remote','full') then raise exception 'Home Remote write access required'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Room name is required'; end if;
  insert into public.home_remote_rooms(id,household_id,name,sort_order,created_by_user_id)
  values(v_id,p_household_id,trim(p_name),coalesce(p_sort_order,0),auth.uid())
  on conflict(id) do update set name=excluded.name,sort_order=excluded.sort_order,updated_at=now();
  return v_id;
end;
$$;

create or replace function public.save_home_remote_device_v1(
  p_id uuid,p_household_id uuid,p_room_id uuid,p_name text,p_device_type text,p_manufacturer text,
  p_capabilities text[],p_webhook_url text,p_bearer_token text default null
)
returns uuid language plpgsql security invoker set search_path=public,private,pg_temp as $$
declare v_id uuid:=coalesce(p_id,gen_random_uuid());
declare v_is_admin boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'home_remote','full') then raise exception 'Home Remote write access required'; end if;
  select exists(select 1 from public.household_members hm where hm.household_id=p_household_id and hm.user_id=auth.uid() and hm.status='active' and hm.role in ('owner','admin')) into v_is_admin;
  if not v_is_admin then raise exception 'Only household owners/admins can configure remote devices'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Device name is required'; end if;
  if p_device_type not in ('tv','streamer','audio','other') then raise exception 'Invalid device type'; end if;
  if p_room_id is not null and not exists(select 1 from public.home_remote_rooms r where r.id=p_room_id and r.household_id=p_household_id and r.active) then raise exception 'Room not found'; end if;
  if nullif(trim(coalesce(p_webhook_url,'')),'') is null or trim(p_webhook_url)!~'^https://' then raise exception 'A secure HTTPS bridge URL is required'; end if;

  insert into public.home_remote_devices(id,household_id,room_id,name,device_type,manufacturer,capabilities,created_by_user_id)
  values(v_id,p_household_id,p_room_id,trim(p_name),p_device_type,nullif(trim(coalesce(p_manufacturer,'')),''),coalesce(p_capabilities,'{}'::text[]),auth.uid())
  on conflict(id) do update set room_id=excluded.room_id,name=excluded.name,device_type=excluded.device_type,manufacturer=excluded.manufacturer,capabilities=excluded.capabilities,updated_at=now();

  insert into public.home_remote_device_bridges(device_id,household_id,webhook_url,bearer_token,updated_by_user_id)
  values(v_id,p_household_id,trim(p_webhook_url),nullif(trim(coalesce(p_bearer_token,'')),''),auth.uid())
  on conflict(device_id) do update set webhook_url=excluded.webhook_url,bearer_token=excluded.bearer_token,updated_by_user_id=auth.uid(),updated_at=now();
  return v_id;
end;
$$;

create or replace function public.set_home_remote_device_permission_v1(p_household_id uuid,p_device_id uuid,p_profile_id uuid,p_can_control boolean)
returns boolean language plpgsql security invoker set search_path=public,private,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.household_members hm where hm.household_id=p_household_id and hm.user_id=auth.uid() and hm.status='active' and hm.role in ('owner','admin')) then
    raise exception 'Only household owners/admins can change remote permissions';
  end if;
  insert into public.home_remote_device_permissions(household_id,device_id,profile_id,can_control)
  values(p_household_id,p_device_id,p_profile_id,coalesce(p_can_control,false))
  on conflict(device_id,profile_id) do update set can_control=excluded.can_control,updated_at=now();
  return true;
end;
$$;

revoke all on function public.save_home_remote_room_v1(uuid,uuid,text,integer) from public,anon;
revoke all on function public.save_home_remote_device_v1(uuid,uuid,uuid,text,text,text,text[],text,text) from public,anon;
revoke all on function public.set_home_remote_device_permission_v1(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.save_home_remote_room_v1(uuid,uuid,text,integer) to authenticated;
grant execute on function public.save_home_remote_device_v1(uuid,uuid,uuid,text,text,text,text[],text,text) to authenticated;
grant execute on function public.set_home_remote_device_permission_v1(uuid,uuid,uuid,boolean) to authenticated;
