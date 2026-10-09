-- Famioo migration 103
-- Persistent QR repository with AI classification into Links / Events / Digital Tickets.

create table if not exists public.qr_scan_items(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  qr_value text not null,
  source_url text,
  item_type text not null default 'link' check(item_type in ('link','event','ticket')),
  title text not null,
  summary text,
  page_description text,
  image_url text,
  event_date date,
  event_end_date date,
  event_start_time time,
  event_end_time time,
  event_all_day boolean not null default false,
  location_text text,
  ai_model text,
  ai_confidence numeric(4,3) check(ai_confidence is null or (ai_confidence>=0 and ai_confidence<=1)),
  analysis_status text not null default 'pending' check(analysis_status in ('pending','analyzed','metadata','unreadable','not_applicable')),
  status text not null default 'active' check(status in ('active','archived')),
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists qr_scan_items_household_type_idx
  on public.qr_scan_items(household_id,status,item_type,created_at desc);
create index if not exists qr_scan_items_creator_idx
  on public.qr_scan_items(created_by_user_id);
create index if not exists qr_scan_items_event_date_idx
  on public.qr_scan_items(household_id,event_date)
  where event_date is not null;

alter table public.qr_scan_items enable row level security;

drop policy if exists qr_scan_items_read on public.qr_scan_items;
create policy qr_scan_items_read on public.qr_scan_items for select to authenticated
using(private.has_module_access(household_id,'tickets','read'));

drop policy if exists qr_scan_items_insert on public.qr_scan_items;
create policy qr_scan_items_insert on public.qr_scan_items for insert to authenticated
with check(private.has_module_access(household_id,'tickets','full'));

drop policy if exists qr_scan_items_update on public.qr_scan_items;
create policy qr_scan_items_update on public.qr_scan_items for update to authenticated
using(private.has_module_access(household_id,'tickets','full'))
with check(private.has_module_access(household_id,'tickets','full'));

drop policy if exists qr_scan_items_delete on public.qr_scan_items;
create policy qr_scan_items_delete on public.qr_scan_items for delete to authenticated
using(private.has_module_access(household_id,'tickets','full'));

revoke all on table public.qr_scan_items from anon,public;
grant select,insert,update,delete on table public.qr_scan_items to authenticated;
