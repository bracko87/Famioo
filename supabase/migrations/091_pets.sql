-- Famioo migration 091
-- Pets V1: pet profiles, vet/vaccination/medication, insurance,
-- recurring care, Files documents, Calendar reminders and optional costs.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'pets',
  'Pets',
  'Pet profiles, vet care, vaccinations, medication, insurance, documents and recurring care',
  'paw',
  43,
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
select h.id,'pets',r.role,'full'
from public.households h
cross join (values ('owner'::text),('admin'::text),('user'::text)) as r(role)
on conflict(household_id,module_code,role)
do update set access_level='full',updated_at=now();

create table if not exists public.family_pets(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 120),
  species text not null default 'other',
  breed text,
  sex text check(sex is null or sex in ('female','male','unknown')),
  birth_date date,
  chip_number text,
  weight_kg numeric(6,2) check(weight_kg is null or weight_kg>=0),
  color_markings text,
  notes text,
  active boolean not null default true,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists family_pets_household_idx
  on public.family_pets(household_id,active,name);

create table if not exists public.pet_health_events(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  pet_id uuid not null references public.family_pets(id) on delete cascade,
  event_type text not null check(event_type in ('vet','vaccination','medication','insurance','other')),
  title text not null check(length(trim(title)) between 1 and 180),
  due_date date,
  completed_date date,
  provider text,
  medication_name text,
  dosage text,
  recurring_every_days integer check(recurring_every_days is null or recurring_every_days between 1 and 3650),
  cost_amount numeric(12,2) check(cost_amount is null or cost_amount>=0),
  currency text not null default 'EUR',
  notes text,
  calendar_event_id uuid references public.calendar_events(id) on delete set null,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pet_health_events_pet_idx
  on public.pet_health_events(pet_id,due_date,completed_date,event_type);

create table if not exists public.pet_care_routines(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  pet_id uuid not null references public.family_pets(id) on delete cascade,
  title text not null check(length(trim(title)) between 1 and 160),
  frequency_days integer not null check(frequency_days between 1 and 3650),
  next_due_date date not null,
  last_completed_date date,
  notes text,
  active boolean not null default true,
  calendar_event_id uuid references public.calendar_events(id) on delete set null,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pet_care_routines_pet_idx
  on public.pet_care_routines(pet_id,active,next_due_date);

create table if not exists public.pet_insurance_policies(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  pet_id uuid not null references public.family_pets(id) on delete cascade,
  provider text not null check(length(trim(provider)) between 1 and 160),
  policy_number text,
  valid_from date,
  valid_until date,
  notes text,
  active boolean not null default true,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(valid_until is null or valid_from is null or valid_until>=valid_from)
);

create index if not exists pet_insurance_pet_idx
  on public.pet_insurance_policies(pet_id,active,valid_until);

create table if not exists public.pet_documents(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  pet_id uuid not null references public.family_pets(id) on delete cascade,
  file_id uuid not null references public.household_files(id) on delete cascade,
  document_type text not null default 'document' check(document_type in ('vaccination','insurance','vet','prescription','registration','document')),
  label text,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(pet_id,file_id)
);

create index if not exists pet_documents_pet_idx
  on public.pet_documents(pet_id,document_type,created_at desc);

alter table public.family_pets enable row level security;
alter table public.pet_health_events enable row level security;
alter table public.pet_care_routines enable row level security;
alter table public.pet_insurance_policies enable row level security;
alter table public.pet_documents enable row level security;

drop policy if exists family_pets_read on public.family_pets;
create policy family_pets_read on public.family_pets for select to authenticated
using(private.has_module_access(household_id,'pets','read'));
drop policy if exists family_pets_write on public.family_pets;
create policy family_pets_write on public.family_pets for all to authenticated
using(private.has_module_access(household_id,'pets','full'))
with check(private.has_module_access(household_id,'pets','full'));

drop policy if exists pet_health_events_read on public.pet_health_events;
create policy pet_health_events_read on public.pet_health_events for select to authenticated
using(private.has_module_access(household_id,'pets','read'));
drop policy if exists pet_health_events_write on public.pet_health_events;
create policy pet_health_events_write on public.pet_health_events for all to authenticated
using(private.has_module_access(household_id,'pets','full'))
with check(private.has_module_access(household_id,'pets','full'));

drop policy if exists pet_care_routines_read on public.pet_care_routines;
create policy pet_care_routines_read on public.pet_care_routines for select to authenticated
using(private.has_module_access(household_id,'pets','read'));
drop policy if exists pet_care_routines_write on public.pet_care_routines;
create policy pet_care_routines_write on public.pet_care_routines for all to authenticated
using(private.has_module_access(household_id,'pets','full'))
with check(private.has_module_access(household_id,'pets','full'));

drop policy if exists pet_insurance_read on public.pet_insurance_policies;
create policy pet_insurance_read on public.pet_insurance_policies for select to authenticated
using(private.has_module_access(household_id,'pets','read'));
drop policy if exists pet_insurance_write on public.pet_insurance_policies;
create policy pet_insurance_write on public.pet_insurance_policies for all to authenticated
using(private.has_module_access(household_id,'pets','full'))
with check(private.has_module_access(household_id,'pets','full'));

drop policy if exists pet_documents_read on public.pet_documents;
create policy pet_documents_read on public.pet_documents for select to authenticated
using(private.has_module_access(household_id,'pets','read'));
drop policy if exists pet_documents_write on public.pet_documents;
create policy pet_documents_write on public.pet_documents for all to authenticated
using(private.has_module_access(household_id,'pets','full'))
with check(private.has_module_access(household_id,'pets','full'));

grant select,insert,update,delete on
  public.family_pets,
  public.pet_health_events,
  public.pet_care_routines,
  public.pet_insurance_policies,
  public.pet_documents
to authenticated;

alter table public.household_costs
  add column if not exists source_pet_event_id uuid references public.pet_health_events(id) on delete set null;

create unique index if not exists household_costs_source_pet_event_uidx
  on public.household_costs(source_pet_event_id)
  where source_pet_event_id is not null;

alter table public.household_costs drop constraint if exists household_costs_source_type_check;
alter table public.household_costs
  add constraint household_costs_source_type_check
  check(source_type in (
    'manual','shopping','task','home_care','life_admin','projects','calendar_event','vehicle','pet'
  ));

create or replace function public.save_family_pet_v1(
  p_id uuid,
  p_household_id uuid,
  p_name text,
  p_species text,
  p_breed text default null,
  p_sex text default null,
  p_birth_date date default null,
  p_chip_number text default null,
  p_weight_kg numeric default null,
  p_color_markings text default null,
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
  if not private.has_module_access(p_household_id,'pets','full') then raise exception 'Pet write access required'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Pet name is required'; end if;
  if nullif(trim(coalesce(p_species,'')),'') is null then raise exception 'Species is required'; end if;
  if p_sex is not null and p_sex not in ('female','male','unknown') then raise exception 'Invalid sex'; end if;
  if p_weight_kg is not null and p_weight_kg<0 then raise exception 'Weight cannot be negative'; end if;

  if p_id is null then
    insert into public.family_pets(
      household_id,name,species,breed,sex,birth_date,chip_number,weight_kg,color_markings,notes,created_by_user_id
    ) values(
      p_household_id,trim(p_name),trim(p_species),nullif(trim(coalesce(p_breed,'')),''),
      p_sex,p_birth_date,nullif(trim(coalesce(p_chip_number,'')),''),
      p_weight_kg,nullif(trim(coalesce(p_color_markings,'')),''),
      nullif(trim(coalesce(p_notes,'')),''),auth.uid()
    ) returning id into v_id;
  else
    update public.family_pets
    set name=trim(p_name),species=trim(p_species),breed=nullif(trim(coalesce(p_breed,'')),''),
        sex=p_sex,birth_date=p_birth_date,chip_number=nullif(trim(coalesce(p_chip_number,'')),''),
        weight_kg=p_weight_kg,color_markings=nullif(trim(coalesce(p_color_markings,'')),''),
        notes=nullif(trim(coalesce(p_notes,'')),''),updated_at=now()
    where id=p_id and household_id=p_household_id
    returning id into v_id;
    if v_id is null then raise exception 'Pet not found'; end if;
  end if;

  return v_id;
end;
$$;

create or replace function public.save_pet_health_event_v1(
  p_id uuid,
  p_household_id uuid,
  p_pet_id uuid,
  p_event_type text,
  p_title text,
  p_due_date date default null,
  p_completed_date date default null,
  p_provider text default null,
  p_medication_name text default null,
  p_dosage text default null,
  p_recurring_every_days integer default null,
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
  v_pet_name text;
  v_event uuid;
  v_calendar uuid;
  v_timezone text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'pets','full') then raise exception 'Pet write access required'; end if;
  if p_event_type not in ('vet','vaccination','medication','insurance','other') then raise exception 'Invalid pet event type'; end if;
  if nullif(trim(coalesce(p_title,'')),'') is null then raise exception 'Event title is required'; end if;
  if p_recurring_every_days is not null and (p_recurring_every_days<1 or p_recurring_every_days>3650) then raise exception 'Invalid recurrence'; end if;
  if p_cost_amount is not null and p_cost_amount<0 then raise exception 'Cost cannot be negative'; end if;

  select name into v_pet_name from public.family_pets
  where id=p_pet_id and household_id=p_household_id and active;
  if v_pet_name is null then raise exception 'Pet not found'; end if;

  if p_id is null then
    insert into public.pet_health_events(
      household_id,pet_id,event_type,title,due_date,completed_date,provider,medication_name,dosage,
      recurring_every_days,cost_amount,currency,notes,created_by_user_id
    ) values(
      p_household_id,p_pet_id,p_event_type,trim(p_title),p_due_date,p_completed_date,
      nullif(trim(coalesce(p_provider,'')),''),nullif(trim(coalesce(p_medication_name,'')),''),
      nullif(trim(coalesce(p_dosage,'')),''),p_recurring_every_days,p_cost_amount,
      coalesce(nullif(trim(coalesce(p_currency,'')),''),'EUR'),nullif(trim(coalesce(p_notes,'')),''),auth.uid()
    ) returning id into v_id;
  else
    update public.pet_health_events
    set event_type=p_event_type,title=trim(p_title),due_date=p_due_date,completed_date=p_completed_date,
        provider=nullif(trim(coalesce(p_provider,'')),''),medication_name=nullif(trim(coalesce(p_medication_name,'')),''),
        dosage=nullif(trim(coalesce(p_dosage,'')),''),recurring_every_days=p_recurring_every_days,
        cost_amount=p_cost_amount,currency=coalesce(nullif(trim(coalesce(p_currency,'')),''),'EUR'),
        notes=nullif(trim(coalesce(p_notes,'')),''),updated_at=now()
    where id=p_id and household_id=p_household_id and pet_id=p_pet_id
    returning id,calendar_event_id into v_id,v_event;
    if v_id is null then raise exception 'Pet event not found'; end if;
  end if;

  if p_sync_calendar and p_due_date is not null and private.has_module_access(p_household_id,'calendar','full') then
    select id into v_calendar from public.calendars
    where household_id=p_household_id and active
    order by is_default desc,name limit 1;
    select timezone into v_timezone from public.households where id=p_household_id;

    if v_calendar is not null then
      v_event:=public.save_event_v1(
        v_event,p_household_id,v_calendar,
        v_pet_name||' · '||trim(p_title),
        nullif(trim(coalesce(p_notes,'')),''),
        true,null,null,p_due_date,p_due_date,
        v_timezone,null,null,'household','[]'::jsonb,null,'[]'::jsonb
      );
      update public.pet_health_events set calendar_event_id=v_event,updated_at=now() where id=v_id;
    end if;
  end if;

  if p_cost_amount is not null and p_cost_amount>0 and private.has_module_access(p_household_id,'costs','full') then
    insert into public.household_costs(
      household_id,title,amount,currency,cost_date,cost_kind,source_type,
      source_pet_event_id,schedule_type,flow_type,notes,created_by_user_id
    ) values(
      p_household_id,'Pet · '||v_pet_name||' · '||trim(p_title),p_cost_amount,
      coalesce(nullif(trim(coalesce(p_currency,'')),''),'EUR'),
      coalesce(p_completed_date,p_due_date,current_date),'additional','pet',v_id,'one_time','expense',
      nullif(trim(coalesce(p_notes,'')),''),auth.uid()
    )
    on conflict(source_pet_event_id) where source_pet_event_id is not null
    do update set title=excluded.title,amount=excluded.amount,currency=excluded.currency,
      cost_date=excluded.cost_date,notes=excluded.notes,updated_at=now();
  elsif private.has_module_access(p_household_id,'costs','full') then
    delete from public.household_costs where source_pet_event_id=v_id;
  end if;

  return v_id;
end;
$$;

create or replace function public.complete_pet_care_routine_v1(
  p_household_id uuid,
  p_routine_id uuid
)
returns date
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_next date;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'pets','full') then raise exception 'Pet write access required'; end if;

  update public.pet_care_routines
  set last_completed_date=current_date,
      next_due_date=greatest(next_due_date,current_date)+frequency_days,
      updated_at=now()
  where id=p_routine_id and household_id=p_household_id and active
  returning next_due_date into v_next;

  if v_next is null then raise exception 'Care routine not found'; end if;
  return v_next;
end;
$$;

revoke all on function public.save_family_pet_v1(uuid,uuid,text,text,text,text,date,text,numeric,text,text) from public,anon;
revoke all on function public.save_pet_health_event_v1(uuid,uuid,uuid,text,text,date,date,text,text,text,integer,numeric,text,text,boolean) from public,anon;
revoke all on function public.complete_pet_care_routine_v1(uuid,uuid) from public,anon;
grant execute on function public.save_family_pet_v1(uuid,uuid,text,text,text,text,date,text,numeric,text,text) to authenticated;
grant execute on function public.save_pet_health_event_v1(uuid,uuid,uuid,text,text,date,date,text,text,text,integer,numeric,text,text,boolean) to authenticated;
grant execute on function public.complete_pet_care_routine_v1(uuid,uuid) to authenticated;
