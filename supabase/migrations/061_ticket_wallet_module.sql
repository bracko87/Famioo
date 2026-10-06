-- Famioo migration 061
-- Ticket Wallet: private family tickets, QR/barcode data and Calendar synchronization.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'tickets',
  'Ticket Wallet',
  'Store family tickets, QR codes and travel/event passes with Calendar sync',
  'ticket',
  68,
  false,
  true
)
on conflict(code) do update set
  name=excluded.name,
  description=excluded.description,
  icon_key=excluded.icon_key,
  sort_order=excluded.sort_order,
  is_core=false,
  is_active=true;

insert into public.billing_products(
  product_code,name,product_kind,module_code,
  first_purchase_price_eur,followup_price_eur,
  included_ai_requests,extra_storage_bytes,
  qualifies_for_storage_threshold,active,sort_order
)
values(
  'module_tickets',
  'Ticket Wallet',
  'module',
  'tickets',
  0.99,
  null,
  0,
  0,
  true,
  true,
  68
)
on conflict(product_code) do update set
  name=excluded.name,
  product_kind=excluded.product_kind,
  module_code=excluded.module_code,
  first_purchase_price_eur=excluded.first_purchase_price_eur,
  followup_price_eur=excluded.followup_price_eur,
  qualifies_for_storage_threshold=excluded.qualifies_for_storage_threshold,
  active=true,
  sort_order=excluded.sort_order,
  updated_at=now();

-- Keep the current development household enabled for testing.
insert into public.household_modules(
  household_id,module_code,enabled,source,enabled_at,updated_at
)
select id,'tickets',true,'admin',now(),now()
from public.households
on conflict(household_id,module_code)
do update set
  enabled=true,
  source=case
    when public.household_modules.source='purchase' then public.household_modules.source
    else 'admin'
  end,
  enabled_at=coalesce(public.household_modules.enabled_at,now()),
  updated_at=now();


create table if not exists public.ticket_wallet_entries(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  ticket_type text not null default 'other',
  holder_profile_id uuid,
  start_date date,
  start_time time,
  end_date date,
  end_time time,
  location_text text,
  provider_text text,
  booking_reference text,
  qr_value text,
  notes text,
  status text not null default 'active',
  calendar_id uuid references public.calendars(id) on delete set null,
  linked_event_id uuid references public.calendar_events(id) on delete set null,
  file_path text,
  file_name text,
  file_mime_type text,
  file_size bigint,
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_wallet_title_check check(length(trim(title)) between 1 and 180),
  constraint ticket_wallet_type_check check(ticket_type in (
    'flight','train','bus','concert','cinema','sports','event','attraction','parking','other'
  )),
  constraint ticket_wallet_status_check check(status in ('active','used','archived')),
  constraint ticket_wallet_file_size_check check(file_size is null or file_size>=0),
  constraint ticket_wallet_holder_fk
    foreign key(household_id,holder_profile_id)
    references public.family_profiles(household_id,id)
    on delete set null
);

create index if not exists ticket_wallet_entries_household_date_idx
  on public.ticket_wallet_entries(household_id,start_date,status);

create index if not exists ticket_wallet_entries_holder_idx
  on public.ticket_wallet_entries(household_id,holder_profile_id)
  where holder_profile_id is not null;

create index if not exists ticket_wallet_entries_calendar_idx
  on public.ticket_wallet_entries(calendar_id)
  where calendar_id is not null;

create index if not exists ticket_wallet_entries_event_idx
  on public.ticket_wallet_entries(linked_event_id)
  where linked_event_id is not null;

create index if not exists ticket_wallet_entries_creator_idx
  on public.ticket_wallet_entries(created_by_user_id);

alter table public.ticket_wallet_entries enable row level security;

drop policy if exists ticket_wallet_entries_select on public.ticket_wallet_entries;
create policy ticket_wallet_entries_select
on public.ticket_wallet_entries
for select to authenticated
using(private.has_module_access(household_id,'tickets','read'));

drop policy if exists ticket_wallet_entries_insert on public.ticket_wallet_entries;
create policy ticket_wallet_entries_insert
on public.ticket_wallet_entries
for insert to authenticated
with check(private.has_module_access(household_id,'tickets','full'));

drop policy if exists ticket_wallet_entries_update on public.ticket_wallet_entries;
create policy ticket_wallet_entries_update
on public.ticket_wallet_entries
for update to authenticated
using(private.has_module_access(household_id,'tickets','full'))
with check(private.has_module_access(household_id,'tickets','full'));

drop policy if exists ticket_wallet_entries_delete on public.ticket_wallet_entries;
create policy ticket_wallet_entries_delete
on public.ticket_wallet_entries
for delete to authenticated
using(private.has_module_access(household_id,'tickets','full'));

revoke all on table public.ticket_wallet_entries from anon,public;
grant select,insert,update,delete on table public.ticket_wallet_entries to authenticated;


-- Calendar category used by tickets.
insert into public.event_categories(
  household_id,name,color_key,icon_key,sort_order,is_system,active,created_by_user_id
)
select
  h.id,
  'Tickets',
  'purple',
  'ticket-wallet-default',
  coalesce((select max(ec.sort_order) from public.event_categories ec where ec.household_id=h.id),0)+10,
  true,
  true,
  null
from public.households h
where not exists(
  select 1
  from public.event_categories ec
  where ec.household_id=h.id
    and lower(ec.name)='tickets'
    and ec.active
);

insert into public.module_category_availability(
  household_id,module_code,category_id,enabled,updated_at
)
select ec.household_id,m.code,ec.id,true,now()
from public.event_categories ec
cross join (values ('calendar'),('tickets')) as m(code)
where ec.active and lower(ec.name)='tickets'
on conflict(household_id,module_code,category_id)
do update set enabled=true,updated_at=now();


insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'ticket-wallet',
  'ticket-wallet',
  false,
  15728640,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists ticket_wallet_objects_select on storage.objects;
create policy ticket_wallet_objects_select
on storage.objects for select to authenticated
using(
  bucket_id='ticket-wallet'
  and exists(
    select 1
    from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'tickets','read')
  )
);

drop policy if exists ticket_wallet_objects_insert on storage.objects;
create policy ticket_wallet_objects_insert
on storage.objects for insert to authenticated
with check(
  bucket_id='ticket-wallet'
  and exists(
    select 1
    from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'tickets','full')
  )
);

drop policy if exists ticket_wallet_objects_update on storage.objects;
create policy ticket_wallet_objects_update
on storage.objects for update to authenticated
using(
  bucket_id='ticket-wallet'
  and exists(
    select 1
    from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'tickets','full')
  )
)
with check(
  bucket_id='ticket-wallet'
  and exists(
    select 1
    from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'tickets','full')
  )
);

drop policy if exists ticket_wallet_objects_delete on storage.objects;
create policy ticket_wallet_objects_delete
on storage.objects for delete to authenticated
using(
  bucket_id='ticket-wallet'
  and exists(
    select 1
    from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'tickets','full')
  )
);


create or replace function private.ticket_wallet_category_id(p_household_id uuid)
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
    and lower(name)='tickets'
  order by created_at
  limit 1;

  if v_category is null then
    insert into public.event_categories(
      household_id,name,color_key,icon_key,sort_order,is_system,active,created_by_user_id
    )
    values(
      p_household_id,'Tickets','purple','ticket-wallet-default',
      coalesce((select max(sort_order) from public.event_categories where household_id=p_household_id),0)+10,
      true,true,null
    )
    returning id into v_category;
  end if;

  return v_category;
end;
$$;

revoke all on function private.ticket_wallet_category_id(uuid) from public,anon,authenticated;


create or replace function public.save_ticket_wallet_entry_v1(
  p_id uuid,
  p_household_id uuid,
  p_title text,
  p_ticket_type text,
  p_holder_profile_id uuid,
  p_start_date date,
  p_start_time time,
  p_end_date date,
  p_end_time time,
  p_location_text text,
  p_provider_text text,
  p_booking_reference text,
  p_qr_value text,
  p_notes text,
  p_status text,
  p_calendar_id uuid,
  p_sync_calendar boolean,
  p_file_path text,
  p_file_name text,
  p_file_mime_type text,
  p_file_size bigint
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_id uuid;
  v_event uuid;
  v_calendar uuid;
  v_timezone text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_participants jsonb:='[]'::jsonb;
  v_description text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'tickets','full') then
    raise exception 'Ticket Wallet write access required';
  end if;
  if nullif(trim(p_title),'') is null then raise exception 'Ticket title is required'; end if;
  if p_ticket_type not in ('flight','train','bus','concert','cinema','sports','event','attraction','parking','other') then
    raise exception 'Invalid ticket type';
  end if;
  if p_status not in ('active','used','archived') then
    raise exception 'Invalid ticket status';
  end if;
  if p_holder_profile_id is not null and not exists(
    select 1 from public.family_profiles
    where id=p_holder_profile_id
      and household_id=p_household_id
      and active
  ) then
    raise exception 'Ticket holder not found';
  end if;
  if p_end_date is not null and p_start_date is not null and p_end_date<p_start_date then
    raise exception 'End date cannot be before start date';
  end if;
  if p_sync_calendar and p_start_date is null then
    raise exception 'Date is required before adding the ticket to Calendar';
  end if;
  if p_sync_calendar and not private.has_module_access(p_household_id,'calendar','full') then
    raise exception 'Calendar write access required';
  end if;

  if p_id is null then
    insert into public.ticket_wallet_entries(
      household_id,title,ticket_type,holder_profile_id,
      start_date,start_time,end_date,end_time,
      location_text,provider_text,booking_reference,qr_value,notes,status,
      calendar_id,file_path,file_name,file_mime_type,file_size,created_by_user_id
    )
    values(
      p_household_id,trim(p_title),p_ticket_type,p_holder_profile_id,
      p_start_date,p_start_time,p_end_date,p_end_time,
      nullif(trim(p_location_text),''),
      nullif(trim(p_provider_text),''),
      nullif(trim(p_booking_reference),''),
      nullif(trim(p_qr_value),''),
      nullif(trim(p_notes),''),
      p_status,
      p_calendar_id,
      nullif(trim(p_file_path),''),
      nullif(trim(p_file_name),''),
      nullif(trim(p_file_mime_type),''),
      p_file_size,
      auth.uid()
    )
    returning id into v_id;
  else
    select id,linked_event_id into v_id,v_event
    from public.ticket_wallet_entries
    where id=p_id
      and household_id=p_household_id
    for update;

    if v_id is null then raise exception 'Ticket not found'; end if;

    update public.ticket_wallet_entries
    set title=trim(p_title),
        ticket_type=p_ticket_type,
        holder_profile_id=p_holder_profile_id,
        start_date=p_start_date,
        start_time=p_start_time,
        end_date=p_end_date,
        end_time=p_end_time,
        location_text=nullif(trim(p_location_text),''),
        provider_text=nullif(trim(p_provider_text),''),
        booking_reference=nullif(trim(p_booking_reference),''),
        qr_value=nullif(trim(p_qr_value),''),
        notes=nullif(trim(p_notes),''),
        status=p_status,
        calendar_id=p_calendar_id,
        file_path=nullif(trim(p_file_path),''),
        file_name=nullif(trim(p_file_name),''),
        file_mime_type=nullif(trim(p_file_mime_type),''),
        file_size=p_file_size,
        updated_at=now()
    where id=v_id;
  end if;

  if p_holder_profile_id is not null then
    v_participants:=jsonb_build_array(
      jsonb_build_object(
        'profile_id',p_holder_profile_id,
        'participant_role','participant',
        'can_edit',false
      )
    );
  end if;

  if p_sync_calendar and p_status<>'archived' then
    if p_calendar_id is not null then
      select id into v_calendar
      from public.calendars
      where id=p_calendar_id
        and household_id=p_household_id
        and active;
    end if;

    if v_calendar is null then
      select id into v_calendar
      from public.calendars
      where household_id=p_household_id
        and active
      order by is_default desc,name
      limit 1;
    end if;

    if v_calendar is null then raise exception 'No active calendar found'; end if;

    select timezone into v_timezone
    from public.households
    where id=p_household_id;

    if p_start_time is not null then
      v_start_at:=(p_start_date+p_start_time) at time zone v_timezone;

      if p_end_time is not null then
        v_end_at:=(
          coalesce(p_end_date,p_start_date)+p_end_time
        ) at time zone v_timezone;
      else
        v_end_at:=v_start_at+interval '2 hours';
      end if;

      if v_end_at<=v_start_at then v_end_at:=v_start_at+interval '2 hours'; end if;
    end if;

    v_description:='Ticket Wallet · '||initcap(replace(p_ticket_type,'_',' '))
      ||case when nullif(trim(p_provider_text),'') is not null
        then E'\nProvider: '||trim(p_provider_text)
        else ''
      end
      ||case when nullif(trim(p_booking_reference),'') is not null
        then E'\nBooking reference: '||trim(p_booking_reference)
        else ''
      end
      ||case when nullif(trim(p_notes),'') is not null
        then E'\n'||trim(p_notes)
        else ''
      end;

    v_event:=public.save_event_v1(
      v_event,
      p_household_id,
      v_calendar,
      trim(p_title),
      v_description,
      p_start_time is null,
      case when p_start_time is null then null else v_start_at end,
      case when p_start_time is null then null else v_end_at end,
      case when p_start_time is null then p_start_date else null end,
      case when p_start_time is null then coalesce(p_end_date,p_start_date) else null end,
      v_timezone,
      nullif(trim(p_location_text),''),
      private.ticket_wallet_category_id(p_household_id),
      'household',
      v_participants,
      null,
      '[]'::jsonb
    );

    update public.ticket_wallet_entries
    set linked_event_id=v_event,
        calendar_id=v_calendar,
        updated_at=now()
    where id=v_id;
  elsif v_event is not null then
    update public.calendar_events
    set deleted_at=now(),
        deleted_by_user_id=auth.uid(),
        updated_at=now()
    where id=v_event
      and household_id=p_household_id
      and deleted_at is null;

    update public.ticket_wallet_entries
    set linked_event_id=null,
        calendar_id=null,
        updated_at=now()
    where id=v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_ticket_wallet_entry_v1(
  uuid,uuid,text,text,uuid,date,time,date,time,text,text,text,text,text,text,uuid,boolean,text,text,text,bigint
) from public,anon;
grant execute on function public.save_ticket_wallet_entry_v1(
  uuid,uuid,text,text,uuid,date,time,date,time,text,text,text,text,text,text,uuid,boolean,text,text,text,bigint
) to authenticated;


create or replace function public.archive_ticket_wallet_entry_v1(
  p_id uuid,
  p_household_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_event uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'tickets','full') then
    raise exception 'Ticket Wallet write access required';
  end if;

  select linked_event_id into v_event
  from public.ticket_wallet_entries
  where id=p_id and household_id=p_household_id
  for update;

  if not found then raise exception 'Ticket not found'; end if;

  if v_event is not null then
    update public.calendar_events
    set deleted_at=now(),
        deleted_by_user_id=auth.uid(),
        updated_at=now()
    where id=v_event
      and household_id=p_household_id
      and deleted_at is null;
  end if;

  update public.ticket_wallet_entries
  set status='archived',
      linked_event_id=null,
      calendar_id=null,
      updated_at=now()
  where id=p_id and household_id=p_household_id;

  return true;
end;
$$;

revoke all on function public.archive_ticket_wallet_entry_v1(uuid,uuid) from public,anon;
grant execute on function public.archive_ticket_wallet_entry_v1(uuid,uuid) to authenticated;
