-- Famioo migration 030
-- Functional Home Care module: assets, maintenance, repairs, warranties, history and attachments.

create table if not exists public.home_care_assets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  asset_type text not null default 'Other',
  room_location text,
  brand text,
  model text,
  serial_number text,
  purchase_date date,
  purchase_price numeric(12,2),
  retailer text,
  warranty_until date,
  responsible_profile_id uuid,
  notes text,
  active boolean not null default true,
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint home_care_assets_name_check check (length(trim(name)) between 1 and 160),
  constraint home_care_assets_purchase_price_check check (purchase_price is null or purchase_price >= 0),
  constraint home_care_assets_responsible_fk
    foreign key(household_id,responsible_profile_id)
    references public.family_profiles(household_id,id)
);

create index if not exists home_care_assets_household_idx
  on public.home_care_assets(household_id,active,name);

create index if not exists home_care_assets_warranty_idx
  on public.home_care_assets(household_id,warranty_until)
  where active and warranty_until is not null;

alter table public.home_care_assets enable row level security;

drop policy if exists home_care_assets_select on public.home_care_assets;
create policy home_care_assets_select
on public.home_care_assets for select to authenticated
using (private.has_module_access(household_id,'home_care','read'));

drop policy if exists home_care_assets_insert on public.home_care_assets;
create policy home_care_assets_insert
on public.home_care_assets for insert to authenticated
with check (private.has_module_access(household_id,'home_care','full'));

drop policy if exists home_care_assets_update on public.home_care_assets;
create policy home_care_assets_update
on public.home_care_assets for update to authenticated
using (private.has_module_access(household_id,'home_care','full'))
with check (private.has_module_access(household_id,'home_care','full'));

drop policy if exists home_care_assets_delete on public.home_care_assets;
create policy home_care_assets_delete
on public.home_care_assets for delete to authenticated
using (private.has_module_access(household_id,'home_care','full'));

grant select,insert,update,delete on public.home_care_assets to authenticated;


create table if not exists public.home_care_maintenance (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  asset_id uuid references public.home_care_assets(id) on delete cascade,
  title text not null,
  due_date date not null,
  recurrence_type text not null default 'none',
  recurrence_months smallint,
  responsible_profile_id uuid,
  estimated_cost numeric(12,2),
  notes text,
  sync_calendar boolean not null default false,
  sync_task boolean not null default false,
  linked_event_id uuid references public.calendar_events(id) on delete set null,
  linked_task_id uuid references public.tasks(id) on delete set null,
  last_completed_at timestamptz,
  active boolean not null default true,
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint home_care_maintenance_title_check check (length(trim(title)) between 1 and 180),
  constraint home_care_maintenance_recurrence_check
    check (recurrence_type in ('none','monthly','quarterly','half_yearly','yearly','custom')),
  constraint home_care_maintenance_custom_months_check
    check (
      (recurrence_type='custom' and recurrence_months between 1 and 60)
      or (recurrence_type<>'custom' and recurrence_months is null)
    ),
  constraint home_care_maintenance_cost_check check (estimated_cost is null or estimated_cost >= 0),
  constraint home_care_maintenance_responsible_fk
    foreign key(household_id,responsible_profile_id)
    references public.family_profiles(household_id,id)
);

create index if not exists home_care_maintenance_due_idx
  on public.home_care_maintenance(household_id,due_date)
  where active;

alter table public.home_care_maintenance enable row level security;

drop policy if exists home_care_maintenance_select on public.home_care_maintenance;
create policy home_care_maintenance_select
on public.home_care_maintenance for select to authenticated
using (private.has_module_access(household_id,'home_care','read'));

drop policy if exists home_care_maintenance_insert on public.home_care_maintenance;
create policy home_care_maintenance_insert
on public.home_care_maintenance for insert to authenticated
with check (private.has_module_access(household_id,'home_care','full'));

drop policy if exists home_care_maintenance_update on public.home_care_maintenance;
create policy home_care_maintenance_update
on public.home_care_maintenance for update to authenticated
using (private.has_module_access(household_id,'home_care','full'))
with check (private.has_module_access(household_id,'home_care','full'));

drop policy if exists home_care_maintenance_delete on public.home_care_maintenance;
create policy home_care_maintenance_delete
on public.home_care_maintenance for delete to authenticated
using (private.has_module_access(household_id,'home_care','full'));

grant select,insert,update,delete on public.home_care_maintenance to authenticated;


create table if not exists public.home_care_repairs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  asset_id uuid references public.home_care_assets(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'open',
  appointment_date date,
  service_company text,
  contact_text text,
  location_text text,
  responsible_profile_id uuid,
  expected_cost numeric(12,2),
  actual_cost numeric(12,2),
  notes text,
  sync_calendar boolean not null default false,
  sync_task boolean not null default false,
  linked_event_id uuid references public.calendar_events(id) on delete set null,
  linked_task_id uuid references public.tasks(id) on delete set null,
  completed_at timestamptz,
  household_cost_id uuid references public.household_costs(id) on delete set null,
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint home_care_repairs_title_check check (length(trim(title)) between 1 and 180),
  constraint home_care_repairs_status_check check (status in ('open','scheduled','in_progress','completed','cancelled')),
  constraint home_care_repairs_expected_cost_check check (expected_cost is null or expected_cost >= 0),
  constraint home_care_repairs_actual_cost_check check (actual_cost is null or actual_cost >= 0),
  constraint home_care_repairs_responsible_fk
    foreign key(household_id,responsible_profile_id)
    references public.family_profiles(household_id,id)
);

create index if not exists home_care_repairs_status_idx
  on public.home_care_repairs(household_id,status,appointment_date);

alter table public.home_care_repairs enable row level security;

drop policy if exists home_care_repairs_select on public.home_care_repairs;
create policy home_care_repairs_select
on public.home_care_repairs for select to authenticated
using (private.has_module_access(household_id,'home_care','read'));

drop policy if exists home_care_repairs_insert on public.home_care_repairs;
create policy home_care_repairs_insert
on public.home_care_repairs for insert to authenticated
with check (private.has_module_access(household_id,'home_care','full'));

drop policy if exists home_care_repairs_update on public.home_care_repairs;
create policy home_care_repairs_update
on public.home_care_repairs for update to authenticated
using (private.has_module_access(household_id,'home_care','full'))
with check (private.has_module_access(household_id,'home_care','full'));

drop policy if exists home_care_repairs_delete on public.home_care_repairs;
create policy home_care_repairs_delete
on public.home_care_repairs for delete to authenticated
using (private.has_module_access(household_id,'home_care','full'));

grant select,insert,update,delete on public.home_care_repairs to authenticated;


create table if not exists public.home_care_activity (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  asset_id uuid references public.home_care_assets(id) on delete set null,
  activity_type text not null,
  title text not null,
  activity_date date not null default current_date,
  cost_amount numeric(12,2),
  source_maintenance_id uuid references public.home_care_maintenance(id) on delete set null,
  source_repair_id uuid references public.home_care_repairs(id) on delete set null,
  notes text,
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint home_care_activity_type_check check (activity_type in ('maintenance','repair','asset')),
  constraint home_care_activity_cost_check check (cost_amount is null or cost_amount >= 0)
);

create index if not exists home_care_activity_history_idx
  on public.home_care_activity(household_id,activity_date desc,created_at desc);

alter table public.home_care_activity enable row level security;

drop policy if exists home_care_activity_select on public.home_care_activity;
create policy home_care_activity_select
on public.home_care_activity for select to authenticated
using (private.has_module_access(household_id,'home_care','read'));

drop policy if exists home_care_activity_insert on public.home_care_activity;
create policy home_care_activity_insert
on public.home_care_activity for insert to authenticated
with check (private.has_module_access(household_id,'home_care','full'));

grant select,insert on public.home_care_activity to authenticated;


create table if not exists public.home_care_attachments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  asset_id uuid references public.home_care_assets(id) on delete cascade,
  maintenance_id uuid references public.home_care_maintenance(id) on delete cascade,
  repair_id uuid references public.home_care_repairs(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_size bigint,
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint home_care_attachment_target_check check (
    (case when asset_id is not null then 1 else 0 end)
    + (case when maintenance_id is not null then 1 else 0 end)
    + (case when repair_id is not null then 1 else 0 end)
    = 1
  )
);

create index if not exists home_care_attachments_asset_idx on public.home_care_attachments(asset_id) where asset_id is not null;
create index if not exists home_care_attachments_maintenance_idx on public.home_care_attachments(maintenance_id) where maintenance_id is not null;
create index if not exists home_care_attachments_repair_idx on public.home_care_attachments(repair_id) where repair_id is not null;

alter table public.home_care_attachments enable row level security;

drop policy if exists home_care_attachments_select on public.home_care_attachments;
create policy home_care_attachments_select
on public.home_care_attachments for select to authenticated
using (private.has_module_access(household_id,'home_care','read'));

drop policy if exists home_care_attachments_insert on public.home_care_attachments;
create policy home_care_attachments_insert
on public.home_care_attachments for insert to authenticated
with check (private.has_module_access(household_id,'home_care','full'));

drop policy if exists home_care_attachments_delete on public.home_care_attachments;
create policy home_care_attachments_delete
on public.home_care_attachments for delete to authenticated
using (private.has_module_access(household_id,'home_care','full'));

grant select,insert,delete on public.home_care_attachments to authenticated;


-- Let Household Costs identify Home Care-generated expenses.
alter table public.household_costs
  add column if not exists source_home_care_activity_id uuid
    references public.home_care_activity(id) on delete set null;

alter table public.household_costs
  drop constraint if exists household_costs_source_type_check;

alter table public.household_costs
  add constraint household_costs_source_type_check
  check (source_type in ('manual','shopping','task','home_care'));

create unique index if not exists household_costs_home_care_activity_uidx
  on public.household_costs(source_home_care_activity_id)
  where source_home_care_activity_id is not null;


-- Default category used when Home Care sends something to Calendar or Tasks.
with households_with_category as (
  select h.id as household_id
  from public.households h
)
insert into public.event_categories(
  household_id,name,color_key,icon_key,sort_order,is_system,active,created_by_user_id
)
select
  h.household_id,
  'Home Care',
  'green',
  'home-care-default',
  coalesce((select max(ec.sort_order) from public.event_categories ec where ec.household_id=h.household_id),0)+10,
  true,
  true,
  null
from households_with_category h
where not exists(
  select 1
  from public.event_categories ec
  where ec.household_id=h.household_id
    and lower(ec.name)='home care'
    and ec.active
);

insert into public.module_category_availability(household_id,module_code,category_id,enabled,updated_at)
select ec.household_id,m.code,ec.id,
       case when m.code in ('calendar','tasks') then true else false end,
       now()
from public.event_categories ec
cross join (values ('calendar'),('tasks'),('checklists'),('school')) as m(code)
where ec.active
  and lower(ec.name)='home care'
on conflict(household_id,module_code,category_id)
do update set
  enabled=excluded.enabled,
  updated_at=now();


insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'home-care-attachments',
  'home-care-attachments',
  false,
  15728640,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict(id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists home_care_attachment_objects_select on storage.objects;
create policy home_care_attachment_objects_select
on storage.objects for select to authenticated
using (
  bucket_id='home-care-attachments'
  and exists(
    select 1
    from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'home_care','read')
  )
);

drop policy if exists home_care_attachment_objects_insert on storage.objects;
create policy home_care_attachment_objects_insert
on storage.objects for insert to authenticated
with check (
  bucket_id='home-care-attachments'
  and exists(
    select 1
    from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'home_care','full')
  )
);

drop policy if exists home_care_attachment_objects_delete on storage.objects;
create policy home_care_attachment_objects_delete
on storage.objects for delete to authenticated
using (
  bucket_id='home-care-attachments'
  and exists(
    select 1
    from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'home_care','full')
  )
);


create or replace function private.home_care_category_id(p_household_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_category uuid;
begin
  select id into v_category
  from public.event_categories
  where household_id=p_household_id
    and active
    and lower(name)='home care'
  order by created_at
  limit 1;

  if v_category is null then
    select id into v_category
    from public.event_categories
    where household_id=p_household_id and active
    order by sort_order,name
    limit 1;
  end if;

  return v_category;
end;
$$;

revoke all on function private.home_care_category_id(uuid) from public;


create or replace function private.home_care_participants(p_profile_id uuid)
returns jsonb
language sql
immutable
as $$
  select case
    when p_profile_id is null then '[]'::jsonb
    else jsonb_build_array(
      jsonb_build_object(
        'profile_id',p_profile_id,
        'participant_role','participant',
        'can_edit',false
      )
    )
  end;
$$;

revoke all on function private.home_care_participants(uuid) from public;


create or replace function private.home_care_sync_event(
  p_household_id uuid,
  p_event_id uuid,
  p_title text,
  p_description text,
  p_date date,
  p_location text,
  p_responsible_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_calendar uuid;
  v_event uuid;
begin
  if p_date is null then return null; end if;

  select id into v_calendar
  from public.calendars
  where household_id=p_household_id and active
  order by is_default desc,name
  limit 1;

  if v_calendar is null then raise exception 'No active calendar found'; end if;

  v_event:=public.save_event_v1(
    p_event_id,
    p_household_id,
    v_calendar,
    p_title,
    p_description,
    true,
    null,
    null,
    p_date,
    p_date,
    (select timezone from public.households where id=p_household_id),
    p_location,
    private.home_care_category_id(p_household_id),
    'household',
    private.home_care_participants(p_responsible_profile_id),
    null,
    '[]'::jsonb
  );

  return v_event;
end;
$$;

revoke all on function private.home_care_sync_event(uuid,uuid,text,text,date,text,uuid) from public;


create or replace function private.home_care_sync_task(
  p_household_id uuid,
  p_task_id uuid,
  p_title text,
  p_date date,
  p_location text,
  p_responsible_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_task uuid;
begin
  if p_task_id is null then
    v_task:=public.create_task_v1(
      p_household_id,
      p_title,
      private.home_care_category_id(p_household_id),
      p_date,
      p_location,
      private.home_care_participants(p_responsible_profile_id),
      false,
      false
    );
  else
    v_task:=public.update_task_v1(
      p_task_id,
      p_household_id,
      p_title,
      private.home_care_category_id(p_household_id),
      p_date,
      p_location,
      private.home_care_participants(p_responsible_profile_id),
      false
    );
  end if;

  return v_task;
end;
$$;

revoke all on function private.home_care_sync_task(uuid,uuid,text,date,text,uuid) from public;


create or replace function public.save_home_maintenance_v1(
  p_id uuid,
  p_household_id uuid,
  p_asset_id uuid,
  p_title text,
  p_due_date date,
  p_recurrence_type text,
  p_recurrence_months smallint,
  p_responsible_profile_id uuid,
  p_estimated_cost numeric,
  p_notes text,
  p_sync_calendar boolean,
  p_sync_task boolean
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_id uuid;
  v_event uuid;
  v_task uuid;
  v_asset_name text;
  v_location text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'home_care','full') then
    raise exception 'Home Care write access required';
  end if;
  if nullif(trim(p_title),'') is null then raise exception 'Maintenance name is required'; end if;
  if p_due_date is null then raise exception 'Due date is required'; end if;
  if p_recurrence_type not in ('none','monthly','quarterly','half_yearly','yearly','custom') then
    raise exception 'Invalid recurrence';
  end if;
  if p_recurrence_type='custom' and (p_recurrence_months is null or p_recurrence_months<1 or p_recurrence_months>60) then
    raise exception 'Custom recurrence must be between 1 and 60 months';
  end if;

  if p_asset_id is not null then
    select name,room_location into v_asset_name,v_location
    from public.home_care_assets
    where id=p_asset_id and household_id=p_household_id and active;

    if v_asset_name is null then raise exception 'Asset not found'; end if;
  end if;

  if p_responsible_profile_id is not null and not exists(
    select 1 from public.family_profiles
    where id=p_responsible_profile_id and household_id=p_household_id and active
  ) then
    raise exception 'Responsible household member not found';
  end if;

  if p_sync_calendar and not private.has_module_access(p_household_id,'calendar','full') then
    raise exception 'Calendar write access required';
  end if;

  if p_sync_task and not private.has_module_access(p_household_id,'tasks','full') then
    raise exception 'Tasks write access required';
  end if;

  if p_id is null then
    insert into public.home_care_maintenance(
      household_id,asset_id,title,due_date,recurrence_type,recurrence_months,
      responsible_profile_id,estimated_cost,notes,sync_calendar,sync_task,created_by_user_id
    )
    values(
      p_household_id,p_asset_id,trim(p_title),p_due_date,p_recurrence_type,
      case when p_recurrence_type='custom' then p_recurrence_months else null end,
      p_responsible_profile_id,p_estimated_cost,nullif(trim(p_notes),''),
      p_sync_calendar,p_sync_task,auth.uid()
    )
    returning id into v_id;
  else
    select id,linked_event_id,linked_task_id
      into v_id,v_event,v_task
    from public.home_care_maintenance
    where id=p_id and household_id=p_household_id and active
    for update;

    if v_id is null then raise exception 'Maintenance item not found'; end if;

    update public.home_care_maintenance
    set asset_id=p_asset_id,
        title=trim(p_title),
        due_date=p_due_date,
        recurrence_type=p_recurrence_type,
        recurrence_months=case when p_recurrence_type='custom' then p_recurrence_months else null end,
        responsible_profile_id=p_responsible_profile_id,
        estimated_cost=p_estimated_cost,
        notes=nullif(trim(p_notes),''),
        sync_calendar=p_sync_calendar,
        sync_task=p_sync_task,
        updated_at=now()
    where id=v_id;
  end if;

  if p_sync_calendar then
    v_event:=private.home_care_sync_event(
      p_household_id,v_event,trim(p_title),p_notes,p_due_date,v_location,p_responsible_profile_id
    );
  elsif v_event is not null then
    update public.calendar_events
    set deleted_at=now(),deleted_by_user_id=auth.uid(),updated_at=now()
    where id=v_event and household_id=p_household_id and deleted_at is null;
    v_event:=null;
  end if;

  if p_sync_task then
    v_task:=private.home_care_sync_task(
      p_household_id,v_task,trim(p_title),p_due_date,v_location,p_responsible_profile_id
    );
  elsif v_task is not null then
    update public.tasks
    set status='archived',archived_at=now(),updated_at=now()
    where id=v_task and household_id=p_household_id and status<>'done';
    v_task:=null;
  end if;

  update public.home_care_maintenance
  set linked_event_id=v_event,linked_task_id=v_task,updated_at=now()
  where id=v_id;

  return v_id;
end;
$$;

revoke all on function public.save_home_maintenance_v1(
  uuid,uuid,uuid,text,date,text,smallint,uuid,numeric,text,boolean,boolean
) from public;
grant execute on function public.save_home_maintenance_v1(
  uuid,uuid,uuid,text,date,text,smallint,uuid,numeric,text,boolean,boolean
) to authenticated;


create or replace function public.complete_home_maintenance_v1(
  p_id uuid,
  p_household_id uuid,
  p_actual_cost numeric,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_row public.home_care_maintenance%rowtype;
  v_asset public.home_care_assets%rowtype;
  v_activity uuid;
  v_cost uuid;
  v_next_date date;
  v_months integer;
  v_new_event uuid;
  v_new_task uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'home_care','full') then
    raise exception 'Home Care write access required';
  end if;
  if p_actual_cost is not null and p_actual_cost<0 then raise exception 'Cost cannot be negative'; end if;

  select * into v_row
  from public.home_care_maintenance
  where id=p_id and household_id=p_household_id and active
  for update;

  if v_row.id is null then raise exception 'Maintenance item not found'; end if;

  if v_row.asset_id is not null then
    select * into v_asset from public.home_care_assets where id=v_row.asset_id;
  end if;

  insert into public.home_care_activity(
    household_id,asset_id,activity_type,title,activity_date,cost_amount,
    source_maintenance_id,notes,created_by_user_id
  )
  values(
    p_household_id,v_row.asset_id,'maintenance',v_row.title,current_date,p_actual_cost,
    v_row.id,nullif(trim(p_notes),''),auth.uid()
  )
  returning id into v_activity;

  if p_actual_cost is not null
     and p_actual_cost>0
     and private.has_module_access(p_household_id,'costs','full')
  then
    insert into public.household_costs(
      household_id,title,amount,currency,cost_date,cost_kind,source_type,
      source_home_care_activity_id,notes,created_by_user_id
    )
    values(
      p_household_id,
      'Home Care: '||v_row.title,
      p_actual_cost,
      'EUR',
      current_date,
      'additional',
      'home_care',
      v_activity,
      nullif(trim(p_notes),''),
      auth.uid()
    )
    returning id into v_cost;
  end if;

  if v_row.linked_task_id is not null then
    update public.tasks
    set status='done',
        completed_at=coalesce(completed_at,now()),
        updated_at=now()
    where id=v_row.linked_task_id
      and household_id=p_household_id
      and status='open';
  end if;

  if v_row.recurrence_type='monthly' then v_months:=1;
  elsif v_row.recurrence_type='quarterly' then v_months:=3;
  elsif v_row.recurrence_type='half_yearly' then v_months:=6;
  elsif v_row.recurrence_type='yearly' then v_months:=12;
  elsif v_row.recurrence_type='custom' then v_months:=v_row.recurrence_months;
  else v_months:=null;
  end if;

  if v_months is null then
    update public.home_care_maintenance
    set active=false,last_completed_at=now(),linked_task_id=null,updated_at=now()
    where id=v_row.id;
  else
    v_next_date := (v_row.due_date + make_interval(months=>v_months))::date;

    if v_row.sync_calendar then
      v_new_event:=private.home_care_sync_event(
        p_household_id,null,v_row.title,v_row.notes,v_next_date,v_asset.room_location,v_row.responsible_profile_id
      );
    end if;

    if v_row.sync_task then
      v_new_task:=private.home_care_sync_task(
        p_household_id,null,v_row.title,v_next_date,v_asset.room_location,v_row.responsible_profile_id
      );
    end if;

    update public.home_care_maintenance
    set due_date=v_next_date,
        last_completed_at=now(),
        linked_event_id=v_new_event,
        linked_task_id=v_new_task,
        updated_at=now()
    where id=v_row.id;
  end if;

  return jsonb_build_object(
    'activity_id',v_activity,
    'cost_id',v_cost,
    'next_due_date',v_next_date
  );
end;
$$;

revoke all on function public.complete_home_maintenance_v1(uuid,uuid,numeric,text) from public;
grant execute on function public.complete_home_maintenance_v1(uuid,uuid,numeric,text) to authenticated;


create or replace function public.save_home_repair_v1(
  p_id uuid,
  p_household_id uuid,
  p_asset_id uuid,
  p_title text,
  p_description text,
  p_status text,
  p_appointment_date date,
  p_service_company text,
  p_contact_text text,
  p_location_text text,
  p_responsible_profile_id uuid,
  p_expected_cost numeric,
  p_notes text,
  p_sync_calendar boolean,
  p_sync_task boolean
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_id uuid;
  v_event uuid;
  v_task uuid;
  v_location text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'home_care','full') then
    raise exception 'Home Care write access required';
  end if;
  if nullif(trim(p_title),'') is null then raise exception 'Repair name is required'; end if;
  if p_status not in ('open','scheduled','in_progress','cancelled') then
    raise exception 'Invalid repair status';
  end if;

  if p_asset_id is not null and not exists(
    select 1 from public.home_care_assets
    where id=p_asset_id and household_id=p_household_id and active
  ) then
    raise exception 'Asset not found';
  end if;

  if p_responsible_profile_id is not null and not exists(
    select 1 from public.family_profiles
    where id=p_responsible_profile_id and household_id=p_household_id and active
  ) then
    raise exception 'Responsible household member not found';
  end if;

  if p_sync_calendar and p_appointment_date is null then
    raise exception 'Appointment date is required when adding a repair to Calendar';
  end if;
  if p_sync_task and not private.has_module_access(p_household_id,'tasks','full') then
    raise exception 'Tasks write access required';
  end if;
  if p_sync_calendar and not private.has_module_access(p_household_id,'calendar','full') then
    raise exception 'Calendar write access required';
  end if;

  if p_id is null then
    insert into public.home_care_repairs(
      household_id,asset_id,title,description,status,appointment_date,
      service_company,contact_text,location_text,responsible_profile_id,
      expected_cost,notes,sync_calendar,sync_task,created_by_user_id
    )
    values(
      p_household_id,p_asset_id,trim(p_title),nullif(trim(p_description),''),
      p_status,p_appointment_date,nullif(trim(p_service_company),''),
      nullif(trim(p_contact_text),''),nullif(trim(p_location_text),''),
      p_responsible_profile_id,p_expected_cost,nullif(trim(p_notes),''),
      p_sync_calendar,p_sync_task,auth.uid()
    )
    returning id into v_id;
  else
    select id,linked_event_id,linked_task_id into v_id,v_event,v_task
    from public.home_care_repairs
    where id=p_id and household_id=p_household_id and status<>'completed'
    for update;

    if v_id is null then raise exception 'Repair not found or already completed'; end if;

    update public.home_care_repairs
    set asset_id=p_asset_id,
        title=trim(p_title),
        description=nullif(trim(p_description),''),
        status=p_status,
        appointment_date=p_appointment_date,
        service_company=nullif(trim(p_service_company),''),
        contact_text=nullif(trim(p_contact_text),''),
        location_text=nullif(trim(p_location_text),''),
        responsible_profile_id=p_responsible_profile_id,
        expected_cost=p_expected_cost,
        notes=nullif(trim(p_notes),''),
        sync_calendar=p_sync_calendar,
        sync_task=p_sync_task,
        updated_at=now()
    where id=v_id;
  end if;

  v_location:=nullif(trim(p_location_text),'');

  if p_sync_calendar and p_status<>'cancelled' then
    v_event:=private.home_care_sync_event(
      p_household_id,v_event,trim(p_title),p_description,p_appointment_date,v_location,p_responsible_profile_id
    );
  elsif v_event is not null then
    update public.calendar_events
    set deleted_at=now(),deleted_by_user_id=auth.uid(),updated_at=now()
    where id=v_event and household_id=p_household_id and deleted_at is null;
    v_event:=null;
  end if;

  if p_sync_task and p_status<>'cancelled' then
    v_task:=private.home_care_sync_task(
      p_household_id,v_task,trim(p_title),p_appointment_date,v_location,p_responsible_profile_id
    );
  elsif v_task is not null then
    update public.tasks
    set status='archived',archived_at=now(),updated_at=now()
    where id=v_task and household_id=p_household_id and status<>'done';
    v_task:=null;
  end if;

  update public.home_care_repairs
  set linked_event_id=v_event,linked_task_id=v_task,updated_at=now()
  where id=v_id;

  return v_id;
end;
$$;

revoke all on function public.save_home_repair_v1(
  uuid,uuid,uuid,text,text,text,date,text,text,text,uuid,numeric,text,boolean,boolean
) from public;
grant execute on function public.save_home_repair_v1(
  uuid,uuid,uuid,text,text,text,date,text,text,text,uuid,numeric,text,boolean,boolean
) to authenticated;


create or replace function public.complete_home_repair_v1(
  p_id uuid,
  p_household_id uuid,
  p_actual_cost numeric,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_row public.home_care_repairs%rowtype;
  v_activity uuid;
  v_cost uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'home_care','full') then
    raise exception 'Home Care write access required';
  end if;
  if p_actual_cost is not null and p_actual_cost<0 then raise exception 'Cost cannot be negative'; end if;

  select * into v_row
  from public.home_care_repairs
  where id=p_id and household_id=p_household_id and status<>'completed'
  for update;

  if v_row.id is null then raise exception 'Repair not found or already completed'; end if;

  insert into public.home_care_activity(
    household_id,asset_id,activity_type,title,activity_date,cost_amount,
    source_repair_id,notes,created_by_user_id
  )
  values(
    p_household_id,v_row.asset_id,'repair',v_row.title,current_date,p_actual_cost,
    v_row.id,nullif(trim(p_notes),''),auth.uid()
  )
  returning id into v_activity;

  if p_actual_cost is not null
     and p_actual_cost>0
     and private.has_module_access(p_household_id,'costs','full')
  then
    insert into public.household_costs(
      household_id,title,amount,currency,cost_date,cost_kind,source_type,
      source_home_care_activity_id,notes,created_by_user_id
    )
    values(
      p_household_id,
      'Home Care: '||v_row.title,
      p_actual_cost,
      'EUR',
      current_date,
      'additional',
      'home_care',
      v_activity,
      nullif(trim(p_notes),''),
      auth.uid()
    )
    returning id into v_cost;
  end if;

  if v_row.linked_task_id is not null then
    update public.tasks
    set status='done',
        completed_at=coalesce(completed_at,now()),
        updated_at=now()
    where id=v_row.linked_task_id
      and household_id=p_household_id
      and status='open';
  end if;

  update public.home_care_repairs
  set status='completed',
      actual_cost=p_actual_cost,
      notes=coalesce(nullif(trim(p_notes),''),notes),
      completed_at=now(),
      household_cost_id=v_cost,
      updated_at=now()
  where id=v_row.id;

  return jsonb_build_object(
    'activity_id',v_activity,
    'cost_id',v_cost
  );
end;
$$;

revoke all on function public.complete_home_repair_v1(uuid,uuid,numeric,text) from public;
grant execute on function public.complete_home_repair_v1(uuid,uuid,numeric,text) to authenticated;
