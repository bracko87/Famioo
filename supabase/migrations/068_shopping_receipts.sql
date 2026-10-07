-- Famioo migration 068
-- Persist receipt summaries and line items for Shopping / Household Cost analytics.

create table if not exists public.shopping_receipts(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  shopping_list_id uuid null references public.shopping_lists(id) on delete set null,
  linked_cost_id uuid null references public.household_costs(id) on delete set null,
  store_name text null,
  purchase_date date not null default current_date,
  total_amount numeric(12,2) null,
  currency text not null default 'EUR',
  file_path text null,
  file_name text null,
  mime_type text null,
  file_size bigint null,
  extraction_status text not null default 'manual',
  ai_model text null,
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shopping_receipts_total_check check(total_amount is null or total_amount >= 0),
  constraint shopping_receipts_file_size_check check(file_size is null or file_size >= 0),
  constraint shopping_receipts_status_check check(extraction_status in ('manual','pending','reviewed','failed'))
);

create table if not exists public.shopping_receipt_items(
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.shopping_receipts(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  product_name text not null,
  normalized_name text not null,
  quantity numeric(12,3) null,
  unit text null,
  unit_price numeric(12,4) null,
  line_total numeric(12,2) null,
  category text null,
  created_at timestamptz not null default now(),
  constraint shopping_receipt_items_quantity_check check(quantity is null or quantity >= 0),
  constraint shopping_receipt_items_unit_price_check check(unit_price is null or unit_price >= 0),
  constraint shopping_receipt_items_line_total_check check(line_total is null or line_total >= 0)
);

create index if not exists shopping_receipts_household_date_idx
  on public.shopping_receipts(household_id,purchase_date desc);
create index if not exists shopping_receipts_household_store_idx
  on public.shopping_receipts(household_id,lower(store_name),purchase_date desc)
  where store_name is not null;
create index if not exists shopping_receipts_list_idx
  on public.shopping_receipts(shopping_list_id)
  where shopping_list_id is not null;
create index if not exists shopping_receipts_cost_idx
  on public.shopping_receipts(linked_cost_id)
  where linked_cost_id is not null;
create index if not exists shopping_receipts_creator_idx
  on public.shopping_receipts(created_by_user_id);
create index if not exists shopping_receipt_items_receipt_idx
  on public.shopping_receipt_items(receipt_id);
create index if not exists shopping_receipt_items_household_product_idx
  on public.shopping_receipt_items(household_id,normalized_name);

alter table public.shopping_receipts enable row level security;
alter table public.shopping_receipt_items enable row level security;

drop policy if exists shopping_receipts_select on public.shopping_receipts;
create policy shopping_receipts_select
on public.shopping_receipts for select to authenticated
using(private.has_module_access(household_id,'shopping','read'));

drop policy if exists shopping_receipts_insert on public.shopping_receipts;
create policy shopping_receipts_insert
on public.shopping_receipts for insert to authenticated
with check(
  private.has_module_access(household_id,'shopping','full')
  and created_by_user_id=(select auth.uid())
);

drop policy if exists shopping_receipts_update on public.shopping_receipts;
create policy shopping_receipts_update
on public.shopping_receipts for update to authenticated
using(private.has_module_access(household_id,'shopping','full'))
with check(private.has_module_access(household_id,'shopping','full'));

drop policy if exists shopping_receipts_delete on public.shopping_receipts;
create policy shopping_receipts_delete
on public.shopping_receipts for delete to authenticated
using(private.has_module_access(household_id,'shopping','full'));

drop policy if exists shopping_receipt_items_select on public.shopping_receipt_items;
create policy shopping_receipt_items_select
on public.shopping_receipt_items for select to authenticated
using(private.has_module_access(household_id,'shopping','read'));

drop policy if exists shopping_receipt_items_insert on public.shopping_receipt_items;
create policy shopping_receipt_items_insert
on public.shopping_receipt_items for insert to authenticated
with check(private.has_module_access(household_id,'shopping','full'));

drop policy if exists shopping_receipt_items_update on public.shopping_receipt_items;
create policy shopping_receipt_items_update
on public.shopping_receipt_items for update to authenticated
using(private.has_module_access(household_id,'shopping','full'))
with check(private.has_module_access(household_id,'shopping','full'));

drop policy if exists shopping_receipt_items_delete on public.shopping_receipt_items;
create policy shopping_receipt_items_delete
on public.shopping_receipt_items for delete to authenticated
using(private.has_module_access(household_id,'shopping','full'));

revoke all on table public.shopping_receipts from anon,public;
revoke all on table public.shopping_receipt_items from anon,public;
grant select,insert,update,delete on table public.shopping_receipts to authenticated;
grant select,insert,update,delete on table public.shopping_receipt_items to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'shopping-receipts',
  'shopping-receipts',
  false,
  15728640,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists shopping_receipts_objects_select on storage.objects;
create policy shopping_receipts_objects_select
on storage.objects for select to authenticated
using(
  bucket_id='shopping-receipts'
  and exists(
    select 1 from public.household_members hm
    where hm.user_id=(select auth.uid())
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'shopping','read')
  )
);

drop policy if exists shopping_receipts_objects_insert on storage.objects;
create policy shopping_receipts_objects_insert
on storage.objects for insert to authenticated
with check(
  bucket_id='shopping-receipts'
  and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','pdf')
  and exists(
    select 1 from public.household_members hm
    where hm.user_id=(select auth.uid())
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'shopping','full')
  )
);

drop policy if exists shopping_receipts_objects_update on storage.objects;
create policy shopping_receipts_objects_update
on storage.objects for update to authenticated
using(
  bucket_id='shopping-receipts'
  and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','pdf')
  and exists(
    select 1 from public.household_members hm
    where hm.user_id=(select auth.uid())
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'shopping','full')
  )
)
with check(
  bucket_id='shopping-receipts'
  and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','pdf')
  and exists(
    select 1 from public.household_members hm
    where hm.user_id=(select auth.uid())
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'shopping','full')
  )
);

drop policy if exists shopping_receipts_objects_delete on storage.objects;
create policy shopping_receipts_objects_delete
on storage.objects for delete to authenticated
using(
  bucket_id='shopping-receipts'
  and exists(
    select 1 from public.household_members hm
    where hm.user_id=(select auth.uid())
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'shopping','full')
  )
);
