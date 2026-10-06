-- Famioo migration 052
-- Calendar Connections: optional external calendar add-on with privacy-first import modes.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'calendar_connections',
  'Calendar Connections',
  'Connect Outlook, Google or an external ICS calendar feed',
  'calendar_sync',
  15,
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
  qualifies_for_storage_threshold,sort_order
)
values(
  'module_calendar_connections',
  'Calendar Connections',
  'module',
  'calendar_connections',
  0.99,
  null,
  0,
  0,
  true,
  5
)
on conflict(product_code) do update set
  name=excluded.name,
  product_kind=excluded.product_kind,
  module_code=excluded.module_code,
  first_purchase_price_eur=excluded.first_purchase_price_eur,
  qualifies_for_storage_threshold=true,
  active=true,
  updated_at=now();


create table if not exists public.calendar_connections(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  provider text not null
    check(provider in ('ics','microsoft','google')),
  display_name text not null,
  target_calendar_id uuid not null,
  import_mode text not null default 'busy'
    check(import_mode in ('busy','title','full')),
  feed_url text null,
  external_account_label text null,
  external_calendar_id text null,
  status text not null default 'connected'
    check(status in ('pending','connected','error','disabled','setup_required')),
  sync_enabled boolean not null default true,
  last_synced_at timestamptz null,
  last_error text null,
  created_by_user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_connections_target_fk
    foreign key(household_id,target_calendar_id)
    references public.calendars(household_id,id)
);

create index if not exists calendar_connections_household_idx
  on public.calendar_connections(household_id,provider,status,created_at);

create unique index if not exists calendar_connections_ics_url_uidx
  on public.calendar_connections(household_id,feed_url)
  where provider='ics' and feed_url is not null;

alter table public.calendar_connections enable row level security;

drop policy if exists calendar_connections_select on public.calendar_connections;
create policy calendar_connections_select
on public.calendar_connections
for select to authenticated
using(private.has_module_access(household_id,'calendar_connections','read'));

drop policy if exists calendar_connections_insert on public.calendar_connections;
create policy calendar_connections_insert
on public.calendar_connections
for insert to authenticated
with check(private.has_module_access(household_id,'calendar_connections','full'));

drop policy if exists calendar_connections_update on public.calendar_connections;
create policy calendar_connections_update
on public.calendar_connections
for update to authenticated
using(private.has_module_access(household_id,'calendar_connections','full'))
with check(private.has_module_access(household_id,'calendar_connections','full'));

drop policy if exists calendar_connections_delete on public.calendar_connections;
create policy calendar_connections_delete
on public.calendar_connections
for delete to authenticated
using(private.has_module_access(household_id,'calendar_connections','full'));

grant select,insert,update,delete on public.calendar_connections to authenticated;


alter table public.calendar_events
  add column if not exists external_connection_id uuid null
    references public.calendar_connections(id) on delete set null,
  add column if not exists external_uid text null,
  add column if not exists external_updated_at timestamptz null,
  add column if not exists external_read_only boolean not null default false;

create unique index if not exists calendar_events_external_uid_uidx
  on public.calendar_events(external_connection_id,external_uid)
  where external_connection_id is not null and external_uid is not null;

create index if not exists calendar_events_external_connection_idx
  on public.calendar_events(household_id,external_connection_id,status);


create or replace function public.save_ics_calendar_connection_v1(
  p_connection_id uuid,
  p_household_id uuid,
  p_display_name text,
  p_feed_url text,
  p_target_calendar_id uuid,
  p_import_mode text default 'busy'
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  if not private.has_module_access(p_household_id,'calendar_connections','full') then
    raise exception 'Calendar Connections write access required';
  end if;

  if nullif(trim(p_display_name),'') is null then
    raise exception 'Connection name is required';
  end if;

  if p_feed_url !~* '^https?://' then
    raise exception 'Use a valid http or https ICS URL';
  end if;

  if p_import_mode not in ('busy','title','full') then
    raise exception 'Invalid import mode';
  end if;

  if not exists(
    select 1 from public.calendars
    where household_id=p_household_id
      and id=p_target_calendar_id
      and active
  ) then
    raise exception 'Target calendar not found';
  end if;

  if p_connection_id is null then
    insert into public.calendar_connections(
      household_id,provider,display_name,target_calendar_id,
      import_mode,feed_url,status,sync_enabled,created_by_user_id
    )
    values(
      p_household_id,'ics',trim(p_display_name),p_target_calendar_id,
      p_import_mode,trim(p_feed_url),'connected',true,auth.uid()
    )
    returning id into v_id;
  else
    update public.calendar_connections
    set display_name=trim(p_display_name),
        target_calendar_id=p_target_calendar_id,
        import_mode=p_import_mode,
        feed_url=trim(p_feed_url),
        status='connected',
        sync_enabled=true,
        last_error=null,
        updated_at=now()
    where id=p_connection_id
      and household_id=p_household_id
      and provider='ics'
    returning id into v_id;

    if v_id is null then raise exception 'ICS connection not found'; end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_ics_calendar_connection_v1(uuid,uuid,text,text,uuid,text) from public,anon;
grant execute on function public.save_ics_calendar_connection_v1(uuid,uuid,text,text,uuid,text) to authenticated;


create or replace function public.set_calendar_connection_enabled_v1(
  p_household_id uuid,
  p_connection_id uuid,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  if not private.has_module_access(p_household_id,'calendar_connections','full') then
    raise exception 'Calendar Connections write access required';
  end if;

  update public.calendar_connections
  set sync_enabled=coalesce(p_enabled,false),
      status=case when coalesce(p_enabled,false) then 'connected' else 'disabled' end,
      updated_at=now()
  where id=p_connection_id
    and household_id=p_household_id;

  if not found then raise exception 'Calendar connection not found'; end if;
  return true;
end;
$$;

revoke all on function public.set_calendar_connection_enabled_v1(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_calendar_connection_enabled_v1(uuid,uuid,boolean) to authenticated;


create or replace function public.delete_calendar_connection_v1(
  p_household_id uuid,
  p_connection_id uuid,
  p_remove_imported_events boolean default true
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  if not private.has_module_access(p_household_id,'calendar_connections','full') then
    raise exception 'Calendar Connections write access required';
  end if;

  if coalesce(p_remove_imported_events,true) then
    delete from public.calendar_events
    where household_id=p_household_id
      and external_connection_id=p_connection_id;
  else
    update public.calendar_events
    set external_connection_id=null,
        external_uid=null,
        external_updated_at=null,
        external_read_only=false,
        updated_at=now()
    where household_id=p_household_id
      and external_connection_id=p_connection_id;
  end if;

  delete from public.calendar_connections
  where id=p_connection_id
    and household_id=p_household_id;

  if not found then raise exception 'Calendar connection not found'; end if;
  return true;
end;
$$;

revoke all on function public.delete_calendar_connection_v1(uuid,uuid,boolean) from public,anon;
grant execute on function public.delete_calendar_connection_v1(uuid,uuid,boolean) to authenticated;
