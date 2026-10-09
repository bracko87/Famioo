-- Famioo migration 089
-- Travel & Trips V1: trips, itinerary, accommodation/transport,
-- trip documents/tickets, checklist and Calendar integration.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'travel',
  'Travel & Trips',
  'Family trips with itinerary, bookings, documents, checklists and Calendar sync',
  'plane',
  41,
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
select h.id,'travel',r.role,'full'
from public.households h
cross join (values ('owner'::text),('admin'::text),('user'::text)) as r(role)
on conflict(household_id,module_code,role)
do update set access_level='full',updated_at=now();

create table if not exists public.family_trips(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check(length(trim(title)) between 1 and 160),
  destination text not null check(length(trim(destination)) between 1 and 180),
  start_date date not null,
  end_date date not null,
  notes text,
  status text not null default 'planned' check(status in ('planned','active','completed','archived')),
  calendar_event_id uuid references public.calendar_events(id) on delete set null,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_date>=start_date)
);

create index if not exists family_trips_household_dates_idx
  on public.family_trips(household_id,status,start_date,end_date);

create table if not exists public.family_trip_itinerary(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  trip_id uuid not null references public.family_trips(id) on delete cascade,
  item_type text not null check(item_type in ('transport','accommodation','activity','note')),
  title text not null check(length(trim(title)) between 1 and 180),
  start_at timestamptz,
  end_at timestamptz,
  location_text text,
  booking_reference text,
  notes text,
  sort_order integer not null default 0,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_at is null or start_at is null or end_at>=start_at)
);

create index if not exists family_trip_itinerary_trip_idx
  on public.family_trip_itinerary(trip_id,sort_order,start_at,created_at);

create table if not exists public.family_trip_checklist_items(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  trip_id uuid not null references public.family_trips(id) on delete cascade,
  title text not null check(length(trim(title)) between 1 and 180),
  checked boolean not null default false,
  sort_order integer not null default 0,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists family_trip_checklist_trip_idx
  on public.family_trip_checklist_items(trip_id,checked,sort_order,created_at);

create table if not exists public.family_trip_documents(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  trip_id uuid not null references public.family_trips(id) on delete cascade,
  file_id uuid not null references public.household_files(id) on delete cascade,
  document_type text not null default 'document' check(document_type in ('document','ticket')),
  label text,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(trip_id,file_id)
);

create index if not exists family_trip_documents_trip_idx
  on public.family_trip_documents(trip_id,document_type,created_at desc);

alter table public.family_trips enable row level security;
alter table public.family_trip_itinerary enable row level security;
alter table public.family_trip_checklist_items enable row level security;
alter table public.family_trip_documents enable row level security;

drop policy if exists family_trips_read on public.family_trips;
create policy family_trips_read on public.family_trips for select to authenticated
using(private.has_module_access(household_id,'travel','read'));
drop policy if exists family_trips_write on public.family_trips;
create policy family_trips_write on public.family_trips for all to authenticated
using(private.has_module_access(household_id,'travel','full'))
with check(private.has_module_access(household_id,'travel','full'));

drop policy if exists family_trip_itinerary_read on public.family_trip_itinerary;
create policy family_trip_itinerary_read on public.family_trip_itinerary for select to authenticated
using(private.has_module_access(household_id,'travel','read'));
drop policy if exists family_trip_itinerary_write on public.family_trip_itinerary;
create policy family_trip_itinerary_write on public.family_trip_itinerary for all to authenticated
using(private.has_module_access(household_id,'travel','full'))
with check(private.has_module_access(household_id,'travel','full'));

drop policy if exists family_trip_checklist_read on public.family_trip_checklist_items;
create policy family_trip_checklist_read on public.family_trip_checklist_items for select to authenticated
using(private.has_module_access(household_id,'travel','read'));
drop policy if exists family_trip_checklist_write on public.family_trip_checklist_items;
create policy family_trip_checklist_write on public.family_trip_checklist_items for all to authenticated
using(private.has_module_access(household_id,'travel','full'))
with check(private.has_module_access(household_id,'travel','full'));

drop policy if exists family_trip_documents_read on public.family_trip_documents;
create policy family_trip_documents_read on public.family_trip_documents for select to authenticated
using(private.has_module_access(household_id,'travel','read'));
drop policy if exists family_trip_documents_write on public.family_trip_documents;
create policy family_trip_documents_write on public.family_trip_documents for all to authenticated
using(private.has_module_access(household_id,'travel','full'))
with check(private.has_module_access(household_id,'travel','full'));

grant select,insert,update,delete on
  public.family_trips,
  public.family_trip_itinerary,
  public.family_trip_checklist_items,
  public.family_trip_documents
to authenticated;

create or replace function public.save_family_trip_v1(
  p_id uuid,
  p_household_id uuid,
  p_title text,
  p_destination text,
  p_start_date date,
  p_end_date date,
  p_notes text default null,
  p_sync_calendar boolean default true
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_id uuid;
  v_event uuid;
  v_calendar uuid;
  v_timezone text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'travel','full') then raise exception 'Travel write access required'; end if;
  if nullif(trim(coalesce(p_title,'')),'') is null then raise exception 'Trip title is required'; end if;
  if nullif(trim(coalesce(p_destination,'')),'') is null then raise exception 'Destination is required'; end if;
  if p_start_date is null or p_end_date is null or p_end_date<p_start_date then raise exception 'Valid trip dates are required'; end if;

  if p_id is null then
    insert into public.family_trips(
      household_id,title,destination,start_date,end_date,notes,created_by_user_id
    )
    values(
      p_household_id,trim(p_title),trim(p_destination),p_start_date,p_end_date,
      nullif(trim(coalesce(p_notes,'')),''),auth.uid()
    )
    returning id into v_id;
  else
    update public.family_trips
    set title=trim(p_title),
        destination=trim(p_destination),
        start_date=p_start_date,
        end_date=p_end_date,
        notes=nullif(trim(coalesce(p_notes,'')),''),
        updated_at=now()
    where id=p_id and household_id=p_household_id
    returning id,calendar_event_id into v_id,v_event;
    if v_id is null then raise exception 'Trip not found'; end if;
  end if;

  if p_sync_calendar and private.has_module_access(p_household_id,'calendar','full') then
    select id into v_calendar
    from public.calendars
    where household_id=p_household_id and active
    order by is_default desc,name
    limit 1;

    select timezone into v_timezone from public.households where id=p_household_id;

    if v_calendar is not null then
      v_event:=public.save_event_v1(
        v_event,p_household_id,v_calendar,
        trim(p_title)||' — '||trim(p_destination),
        nullif(trim(coalesce(p_notes,'')),''),
        true,null,null,p_start_date,p_end_date,
        v_timezone,trim(p_destination),null,'household',
        '[]'::jsonb,null,'[]'::jsonb
      );

      update public.family_trips
      set calendar_event_id=v_event,updated_at=now()
      where id=v_id;
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_family_trip_v1(uuid,uuid,text,text,date,date,text,boolean)
from public,anon;
grant execute on function public.save_family_trip_v1(uuid,uuid,text,text,date,date,text,boolean)
to authenticated;
