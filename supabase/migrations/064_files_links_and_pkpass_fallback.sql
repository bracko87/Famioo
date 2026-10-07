-- Famioo migration 064
-- Add saved web links to Files and accept iOS/browser octet-stream .pkpass uploads safely.

create table if not exists public.household_links(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  url text not null,
  notes text null,
  source_module text null,
  archived_at timestamptz null,
  created_by_user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint household_links_http_url_check
    check(url ~* '^https?://')
);

create index if not exists household_links_household_idx
on public.household_links(household_id,archived_at,created_at desc);

alter table public.household_links enable row level security;

drop policy if exists household_links_select on public.household_links;
create policy household_links_select
on public.household_links
for select
to authenticated
using(private.has_module_access(household_id,'files','read'));

drop policy if exists household_links_insert on public.household_links;
create policy household_links_insert
on public.household_links
for insert
to authenticated
with check(
  private.has_module_access(household_id,'files','full')
  and created_by_user_id=auth.uid()
);

drop policy if exists household_links_update on public.household_links;
create policy household_links_update
on public.household_links
for update
to authenticated
using(private.has_module_access(household_id,'files','full'))
with check(private.has_module_access(household_id,'files','full'));

drop policy if exists household_links_delete on public.household_links;
create policy household_links_delete
on public.household_links
for delete
to authenticated
using(private.has_module_access(household_id,'files','full'));

revoke all on table public.household_links from anon,public;
grant select,insert,update,delete on table public.household_links to authenticated;

update storage.buckets
set allowed_mime_types=array[
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/vnd.apple.pkpass',
  'application/octet-stream'
]
where id='ticket-wallet';

drop policy if exists ticket_wallet_objects_insert on storage.objects;
create policy ticket_wallet_objects_insert
on storage.objects for insert to authenticated
with check(
  bucket_id='ticket-wallet'
  and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','pdf','pkpass')
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
  and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','pdf','pkpass')
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
  and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','pdf','pkpass')
  and exists(
    select 1
    from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'tickets','full')
  )
);
