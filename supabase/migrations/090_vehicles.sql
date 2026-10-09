-- Famioo migration 090
-- Vehicles V1: family vehicles, insurance/TÜV/service/maintenance,
-- tyres, costs, Files documents and Calendar reminders.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'vehicles',
  'Vehicles',
  'Family vehicles with service, insurance, TÜV, tyres, costs, documents and reminders',
  'car',
  42,
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
select h.id,'vehicles',r.role,'full'
from public.households h
cross join (values ('owner'::text),('admin'::text),('user'::text)) as r(role)
on conflict(household_id,module_code,role)
do update set access_level='full',updated_at=now();

create table if not exists public.family_vehicles(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 120),
  make text,
  model text,
  registration_plate text,
  vin text,
  model_year smallint check(model_year is null or model_year between 1900 and 2200),
  fuel_type text,
  odometer_km integer not null default 0 check(odometer_km>=0),
  notes text,
  active boolean not null default true,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists family_vehicles_household_idx
  on public.family_vehicles(household_id,active,name);

create table if not exists public.vehicle_events(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  vehicle_id uuid not null references public.family_vehicles(id) on delete cascade,
  event_type text not null check(event_type in (
    'insurance','tuv','service','maintenance','tyre_change','registration','other'
  )),
  title text not null check(length(trim(title)) between 1 and 180),
  due_date date,
  completed_date date,
  odometer_km integer check(odometer_km is null or odometer_km>=0),
  provider text,
  cost_amount numeric(12,2) check(cost_amount is null or cost_amount>=0),
  currency text not null default 'EUR',
  notes text,
  calendar_event_id uuid references public.calendar_events(id) on delete set null,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vehicle_events_vehicle_idx
  on public.vehicle_events(vehicle_id,due_date,completed_date,event_type);

create table if not exists public.vehicle_tyres(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  vehicle_id uuid not null references public.family_vehicles(id) on delete cascade,
  season text not null check(season in ('summer','winter','all_season')),
  brand text,
  tyre_size text,
  installed_date date,
  tread_depth_mm numeric(4,1) check(tread_depth_mm is null or tread_depth_mm>=0),
  storage_location text,
  notes text,
  active boolean not null default true,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vehicle_tyres_vehicle_idx
  on public.vehicle_tyres(vehicle_id,active,season);

create table if not exists public.vehicle_documents(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  vehicle_id uuid not null references public.family_vehicles(id) on delete cascade,
  file_id uuid not null references public.household_files(id) on delete cascade,
  document_type text not null default 'document' check(document_type in (
    'registration','insurance','inspection','service','invoice','document'
  )),
  label text,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(vehicle_id,file_id)
);

create index if not exists vehicle_documents_vehicle_idx
  on public.vehicle_documents(vehicle_id,document_type,created_at desc);

alter table public.family_vehicles enable row level security;
alter table public.vehicle_events enable row level security;
alter table public.vehicle_tyres enable row level security;
alter table public.vehicle_documents enable row level security;

drop policy if exists family_vehicles_read on public.family_vehicles;
create policy family_vehicles_read on public.family_vehicles for select to authenticated
using(private.has_module_access(household_id,'vehicles','read'));
drop policy if exists family_vehicles_write on public.family_vehicles;
create policy family_vehicles_write on public.family_vehicles for all to authenticated
using(private.has_module_access(household_id,'vehicles','full'))
with check(private.has_module_access(household_id,'vehicles','full'));

drop policy if exists vehicle_events_read on public.vehicle_events;
create policy vehicle_events_read on public.vehicle_events for select to authenticated
using(private.has_module_access(household_id,'vehicles','read'));
drop policy if exists vehicle_events_write on public.vehicle_events;
create policy vehicle_events_write on public.vehicle_events for all to authenticated
using(private.has_module_access(household_id,'vehicles','full'))
with check(private.has_module_access(household_id,'vehicles','full'));

drop policy if exists vehicle_tyres_read on public.vehicle_tyres;
create policy vehicle_tyres_read on public.vehicle_tyres for select to authenticated
using(private.has_module_access(household_id,'vehicles','read'));
drop policy if exists vehicle_tyres_write on public.vehicle_tyres;
create policy vehicle_tyres_write on public.vehicle_tyres for all to authenticated
using(private.has_module_access(household_id,'vehicles','full'))
with check(private.has_module_access(household_id,'vehicles','full'));

drop policy if exists vehicle_documents_read on public.vehicle_documents;
create policy vehicle_documents_read on public.vehicle_documents for select to authenticated
using(private.has_module_access(household_id,'vehicles','read'));
drop policy if exists vehicle_documents_write on public.vehicle_documents;
create policy vehicle_documents_write on public.vehicle_documents for all to authenticated
using(private.has_module_access(household_id,'vehicles','full'))
with check(private.has_module_access(household_id,'vehicles','full'));

grant select,insert,update,delete on
  public.family_vehicles,
  public.vehicle_events,
  public.vehicle_tyres,
  public.vehicle_documents
to authenticated;

-- Extend Household Costs with vehicle-origin entries.
alter table public.household_costs
  add column if not exists source_vehicle_event_id uuid references public.vehicle_events(id) on delete set null;

drop index if exists household_costs_source_vehicle_event_uidx;
create unique index household_costs_source_vehicle_event_uidx
  on public.household_costs(source_vehicle_event_id)
  where source_vehicle_event_id is not null;

alter table public.household_costs
  drop constraint if exists household_costs_source_type_check;
alter table public.household_costs
  add constraint household_costs_source_type_check
  check(source_type in (
    'manual','shopping','task','home_care','life_admin','projects','calendar_event','vehicle'
  ));

create or replace function public.save_family_vehicle_v1(
  p_id uuid,
  p_household_id uuid,
  p_name text,
  p_make text default null,
  p_model text default null,
  p_registration_plate text default null,
  p_vin text default null,
  p_model_year integer default null,
  p_fuel_type text default null,
  p_odometer_km integer default 0,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'vehicles','full') then raise exception 'Vehicle write access required'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Vehicle name is required'; end if;
  if coalesce(p_odometer_km,0)<0 then raise exception 'Odometer cannot be negative'; end if;

  if p_id is null then
    insert into public.family_vehicles(
      household_id,name,make,model,registration_plate,vin,model_year,fuel_type,odometer_km,notes,created_by_user_id
    ) values(
      p_household_id,trim(p_name),nullif(trim(coalesce(p_make,'')),''),
      nullif(trim(coalesce(p_model,'')),''),nullif(trim(coalesce(p_registration_plate,'')),''),
      nullif(trim(coalesce(p_vin,'')),''),p_model_year::smallint,
      nullif(trim(coalesce(p_fuel_type,'')),''),coalesce(p_odometer_km,0),
      nullif(trim(coalesce(p_notes,'')),''),auth.uid()
    )
    returning id into v_id;
  else
    update public.family_vehicles
    set name=trim(p_name),
        make=nullif(trim(coalesce(p_make,'')),''),
        model=nullif(trim(coalesce(p_model,'')),''),
        registration_plate=nullif(trim(coalesce(p_registration_plate,'')),''),
        vin=nullif(trim(coalesce(p_vin,'')),''),
        model_year=p_model_year::smallint,
        fuel_type=nullif(trim(coalesce(p_fuel_type,'')),''),
        odometer_km=coalesce(p_odometer_km,0),
        notes=nullif(trim(coalesce(p_notes,'')),''),
        updated_at=now()
    where id=p_id and household_id=p_household_id
    returning id into v_id;
    if v_id is null then raise exception 'Vehicle not found'; end if;
  end if;

  return v_id;
end;
$$;

create or replace function public.save_vehicle_event_v1(
  p_id uuid,
  p_household_id uuid,
  p_vehicle_id uuid,
  p_event_type text,
  p_title text,
  p_due_date date default null,
  p_completed_date date default null,
  p_odometer_km integer default null,
  p_provider text default null,
  p_cost_amount numeric default null,
  p_currency text default 'EUR',
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
  v_vehicle_name text;
  v_event uuid;
  v_calendar uuid;
  v_timezone text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'vehicles','full') then raise exception 'Vehicle write access required'; end if;
  if p_event_type not in ('insurance','tuv','service','maintenance','tyre_change','registration','other') then raise exception 'Invalid vehicle event type'; end if;
  if nullif(trim(coalesce(p_title,'')),'') is null then raise exception 'Event title is required'; end if;
  if p_cost_amount is not null and p_cost_amount<0 then raise exception 'Cost cannot be negative'; end if;

  select name into v_vehicle_name
  from public.family_vehicles
  where id=p_vehicle_id and household_id=p_household_id and active;
  if v_vehicle_name is null then raise exception 'Vehicle not found'; end if;

  if p_id is null then
    insert into public.vehicle_events(
      household_id,vehicle_id,event_type,title,due_date,completed_date,odometer_km,
      provider,cost_amount,currency,notes,created_by_user_id
    )
    values(
      p_household_id,p_vehicle_id,p_event_type,trim(p_title),p_due_date,p_completed_date,
      p_odometer_km,nullif(trim(coalesce(p_provider,'')),''),p_cost_amount,
      coalesce(nullif(trim(coalesce(p_currency,'')),''),'EUR'),
      nullif(trim(coalesce(p_notes,'')),''),auth.uid()
    )
    returning id into v_id;
  else
    update public.vehicle_events
    set event_type=p_event_type,
        title=trim(p_title),
        due_date=p_due_date,
        completed_date=p_completed_date,
        odometer_km=p_odometer_km,
        provider=nullif(trim(coalesce(p_provider,'')),''),
        cost_amount=p_cost_amount,
        currency=coalesce(nullif(trim(coalesce(p_currency,'')),''),'EUR'),
        notes=nullif(trim(coalesce(p_notes,'')),''),
        updated_at=now()
    where id=p_id and household_id=p_household_id and vehicle_id=p_vehicle_id
    returning id,calendar_event_id into v_id,v_event;
    if v_id is null then raise exception 'Vehicle event not found'; end if;
  end if;

  if p_odometer_km is not null then
    update public.family_vehicles
    set odometer_km=greatest(odometer_km,p_odometer_km),updated_at=now()
    where id=p_vehicle_id;
  end if;

  -- Sync due reminder into Calendar when requested.
  if p_sync_calendar and p_due_date is not null and private.has_module_access(p_household_id,'calendar','full') then
    select id into v_calendar
    from public.calendars
    where household_id=p_household_id and active
    order by is_default desc,name
    limit 1;

    select timezone into v_timezone from public.households where id=p_household_id;

    if v_calendar is not null then
      v_event:=public.save_event_v1(
        v_event,p_household_id,v_calendar,
        v_vehicle_name||' · '||trim(p_title),
        nullif(trim(coalesce(p_notes,'')),''),
        true,null,null,p_due_date,p_due_date,
        v_timezone,null,null,'household','[]'::jsonb,null,'[]'::jsonb
      );

      update public.vehicle_events set calendar_event_id=v_event,updated_at=now() where id=v_id;
    end if;
  end if;

  -- Mirror completed vehicle costs into Household Costs.
  if p_cost_amount is not null and p_cost_amount>0
     and private.has_module_access(p_household_id,'costs','full') then
    insert into public.household_costs(
      household_id,title,amount,currency,cost_date,cost_kind,source_type,
      source_vehicle_event_id,schedule_type,flow_type,notes,created_by_user_id
    )
    values(
      p_household_id,
      'Vehicle · '||v_vehicle_name||' · '||trim(p_title),
      p_cost_amount,
      coalesce(nullif(trim(coalesce(p_currency,'')),''),'EUR'),
      coalesce(p_completed_date,p_due_date,current_date),
      'additional','vehicle',v_id,'one_time','expense',
      nullif(trim(coalesce(p_notes,'')),''),auth.uid()
    )
    on conflict(source_vehicle_event_id) where source_vehicle_event_id is not null
    do update set
      title=excluded.title,
      amount=excluded.amount,
      currency=excluded.currency,
      cost_date=excluded.cost_date,
      notes=excluded.notes,
      updated_at=now();
  elsif private.has_module_access(p_household_id,'costs','full') then
    delete from public.household_costs where source_vehicle_event_id=v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_family_vehicle_v1(uuid,uuid,text,text,text,text,text,integer,text,integer,text) from public,anon;
revoke all on function public.save_vehicle_event_v1(uuid,uuid,uuid,text,text,date,date,integer,text,numeric,text,text,boolean) from public,anon;
grant execute on function public.save_family_vehicle_v1(uuid,uuid,text,text,text,text,text,integer,text,integer,text) to authenticated;
grant execute on function public.save_vehicle_event_v1(uuid,uuid,uuid,text,text,date,date,integer,text,numeric,text,text,boolean) to authenticated;
