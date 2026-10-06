-- Famioo migration 046
-- Files as a free core module + storage quotas + configurable commercial catalog.

update public.modules
set is_core=true,
    description='Shared household files, photos and documents'
where code='files';

insert into public.household_modules(household_id,module_code,enabled,source,settings_json,enabled_at,updated_at)
select h.id,'files',true,'core','{}'::jsonb,now(),now()
from public.households h
on conflict(household_id,module_code)
do update set enabled=true,source='core',valid_until=null,updated_at=now();


create table if not exists public.billing_products(
  product_code text primary key,
  name text not null,
  product_kind text not null
    check(product_kind in ('module','assistant_base','assistant_pack','storage_addon')),
  module_code text null references public.modules(code) on delete restrict,
  first_purchase_price_eur numeric(6,2) null check(first_purchase_price_eur is null or first_purchase_price_eur>=0),
  followup_price_eur numeric(6,2) null check(followup_price_eur is null or followup_price_eur>=0),
  included_ai_requests integer not null default 0 check(included_ai_requests>=0),
  extra_storage_bytes bigint not null default 0 check(extra_storage_bytes>=0),
  qualifies_for_storage_threshold boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.billing_products enable row level security;

drop policy if exists billing_products_read on public.billing_products;
create policy billing_products_read
on public.billing_products
for select
to authenticated
using(active);

grant select on public.billing_products to authenticated;

insert into public.billing_products(
  product_code,name,product_kind,module_code,
  first_purchase_price_eur,followup_price_eur,
  included_ai_requests,extra_storage_bytes,
  qualifies_for_storage_threshold,sort_order
)
values
  ('module_shopping','Shopping','module','shopping',0.99,null,0,0,true,10),
  ('module_costs','Household Costs','module','costs',0.99,null,0,0,true,20),
  ('module_school','School & Kita','module','school',0.99,null,0,0,true,30),
  ('module_home_care','Home Care','module','home_care',0.99,null,0,0,true,40),
  ('module_life_admin','Life Admin','module','life_admin',0.99,null,0,0,true,50),
  ('module_projects','Projects & Chores','module','projects',0.99,null,0,0,true,60),
  ('module_meals','Meals & Recipes','module','meals',0.99,null,0,0,true,70),
  ('assistant_base','AI Assistant','assistant_base','assistant',1.69,1.69,150,0,true,80),
  ('assistant_pack_100','AI Assistant +100 requests','assistant_pack','assistant',0.99,0.99,100,0,false,90),
  ('storage_10gb','Keep 10 GB Files storage','storage_addon','files',0.49,0.49,0,9663676416,false,100)
on conflict(product_code) do update set
  name=excluded.name,
  product_kind=excluded.product_kind,
  module_code=excluded.module_code,
  first_purchase_price_eur=excluded.first_purchase_price_eur,
  included_ai_requests=excluded.included_ai_requests,
  extra_storage_bytes=excluded.extra_storage_bytes,
  qualifies_for_storage_threshold=excluded.qualifies_for_storage_threshold,
  active=true,
  updated_at=now();


create table if not exists public.household_billing_items(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  product_code text not null references public.billing_products(product_code) on delete restrict,
  module_code text null references public.modules(code) on delete restrict,
  monthly_price_eur numeric(6,2) not null check(monthly_price_eur>=0),
  status text not null default 'active'
    check(status in ('active','cancelled','past_due')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz null,
  provider text not null default 'manual',
  provider_ref text null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists household_billing_items_household_idx
on public.household_billing_items(household_id,status,product_code);

alter table public.household_billing_items enable row level security;

drop policy if exists household_billing_items_read_admin on public.household_billing_items;
create policy household_billing_items_read_admin
on public.household_billing_items
for select
to authenticated
using(private.is_household_admin_or_owner(household_id));

grant select on public.household_billing_items to authenticated;


create table if not exists public.household_storage_settings(
  household_id uuid primary key references public.households(id) on delete cascade,
  downgrade_grace_until timestamptz null,
  last_qualified_at timestamptz null,
  updated_at timestamptz not null default now()
);

alter table public.household_storage_settings enable row level security;

drop policy if exists household_storage_settings_read on public.household_storage_settings;
create policy household_storage_settings_read
on public.household_storage_settings
for select
to authenticated
using(private.is_household_member(household_id));

grant select on public.household_storage_settings to authenticated;

insert into public.household_storage_settings(household_id)
select id from public.households
on conflict(household_id) do nothing;


create table if not exists public.household_files(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  file_name text not null,
  storage_path text not null unique,
  mime_type text null,
  file_size bigint not null check(file_size>0),
  category text not null default 'other'
    check(category in ('document','photo','receipt','school','home','other')),
  notes text null,
  source_module text null,
  source_record_id uuid null,
  status text not null default 'pending'
    check(status in ('pending','active')),
  archived_at timestamptz null,
  created_by_user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists household_files_household_idx
on public.household_files(household_id,archived_at,created_at desc);

create index if not exists household_files_source_idx
on public.household_files(household_id,source_module,source_record_id);

alter table public.household_files enable row level security;

drop policy if exists household_files_select on public.household_files;
create policy household_files_select
on public.household_files
for select
to authenticated
using(private.has_module_access(household_id,'files','read'));

drop policy if exists household_files_update on public.household_files;
create policy household_files_update
on public.household_files
for update
to authenticated
using(private.has_module_access(household_id,'files','full'))
with check(private.has_module_access(household_id,'files','full'));

drop policy if exists household_files_delete on public.household_files;
create policy household_files_delete
on public.household_files
for delete
to authenticated
using(private.has_module_access(household_id,'files','full'));

grant select,update,delete on public.household_files to authenticated;


create or replace function private.paid_module_monthly_total_v1(p_household_id uuid)
returns numeric
language sql
stable
security definer
set search_path=public,private,pg_temp
as $$
  select coalesce(sum(hbi.monthly_price_eur),0)::numeric(8,2)
  from public.household_billing_items hbi
  join public.billing_products bp on bp.product_code=hbi.product_code
  where hbi.household_id=p_household_id
    and hbi.status='active'
    and hbi.starts_at<=now()
    and (hbi.ends_at is null or hbi.ends_at>now())
    and bp.qualifies_for_storage_threshold;
$$;


create or replace function private.has_active_storage_addon_v1(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public,private,pg_temp
as $$
  select exists(
    select 1
    from public.household_billing_items hbi
    where hbi.household_id=p_household_id
      and hbi.product_code='storage_10gb'
      and hbi.status='active'
      and hbi.starts_at<=now()
      and (hbi.ends_at is null or hbi.ends_at>now())
  );
$$;


create or replace function public.files_storage_entitlement_v1(p_household_id uuid)
returns table(
  used_bytes bigint,
  quota_bytes bigint,
  paid_monthly_eur numeric,
  storage_tier text,
  can_upload boolean,
  needs_storage_offer boolean,
  storage_addon_price_eur numeric,
  downgrade_grace_until timestamptz
)
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_used bigint;
  v_paid numeric;
  v_addon boolean;
  v_grace timestamptz;
  v_quota bigint;
  v_tier text;
  v_can_upload boolean;
  v_offer boolean;
begin
  if auth.uid() is null or not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;

  select coalesce(sum(file_size),0)::bigint
  into v_used
  from public.household_files
  where household_id=p_household_id
    and status in ('pending','active');

  v_paid:=private.paid_module_monthly_total_v1(p_household_id);
  v_addon:=private.has_active_storage_addon_v1(p_household_id);

  select hss.downgrade_grace_until
  into v_grace
  from public.household_storage_settings hss
  where hss.household_id=p_household_id;

  if v_paid>3.00 then
    v_quota:=10737418240;
    v_tier:='paid_10gb';
    v_can_upload:=v_used<v_quota;
    v_offer:=false;
  elsif v_addon then
    v_quota:=10737418240;
    v_tier:='addon_10gb';
    v_can_upload:=v_used<v_quota;
    v_offer:=false;
  elsif v_grace is not null and v_grace>now() and v_used>1073741824 then
    v_quota:=10737418240;
    v_tier:='downgrade_grace';
    v_can_upload:=false;
    v_offer:=true;
  else
    v_quota:=1073741824;
    v_tier:='free_1gb';
    v_can_upload:=v_used<v_quota;
    v_offer:=false;
  end if;

  return query
  select
    v_used,
    v_quota,
    v_paid,
    v_tier,
    v_can_upload,
    v_offer,
    coalesce((select followup_price_eur from public.billing_products where product_code='storage_10gb'),0.49),
    v_grace;
end;
$$;

revoke all on function public.files_storage_entitlement_v1(uuid) from public,anon;
grant execute on function public.files_storage_entitlement_v1(uuid) to authenticated;


create or replace function private.refresh_storage_grace_v1(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_paid numeric;
  v_used bigint;
  v_addon boolean;
begin
  insert into public.household_storage_settings(household_id)
  values(p_household_id)
  on conflict(household_id) do nothing;

  v_paid:=private.paid_module_monthly_total_v1(p_household_id);
  v_addon:=private.has_active_storage_addon_v1(p_household_id);

  select coalesce(sum(file_size),0)::bigint
  into v_used
  from public.household_files
  where household_id=p_household_id
    and status in ('pending','active');

  if v_paid>3.00 or v_addon then
    update public.household_storage_settings
    set downgrade_grace_until=null,
        last_qualified_at=case when v_paid>3.00 then now() else last_qualified_at end,
        updated_at=now()
    where household_id=p_household_id;
  elsif v_used>1073741824 then
    update public.household_storage_settings
    set downgrade_grace_until=coalesce(downgrade_grace_until,now()+interval '30 days'),
        updated_at=now()
    where household_id=p_household_id;
  else
    update public.household_storage_settings
    set downgrade_grace_until=null,
        updated_at=now()
    where household_id=p_household_id;
  end if;
end;
$$;


create or replace function private.billing_item_storage_refresh_trg()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  perform private.refresh_storage_grace_v1(coalesce(new.household_id,old.household_id));
  return coalesce(new,old);
end;
$$;

drop trigger if exists household_billing_items_storage_refresh on public.household_billing_items;
create trigger household_billing_items_storage_refresh
after insert or update or delete on public.household_billing_items
for each row execute function private.billing_item_storage_refresh_trg();


create or replace function public.reserve_household_file_v1(
  p_household_id uuid,
  p_title text,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_category text,
  p_notes text
)
returns table(file_id uuid,storage_path text)
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_ent record;
  v_id uuid:=gen_random_uuid();
  v_safe_name text;
  v_path text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'files','full') then
    raise exception 'Files write access required';
  end if;
  if coalesce(trim(p_title),'')='' then raise exception 'File title is required'; end if;
  if coalesce(trim(p_file_name),'')='' then raise exception 'File name is required'; end if;
  if p_file_size is null or p_file_size<=0 then raise exception 'File size is required'; end if;
  if p_file_size>52428800 then raise exception 'Files can be up to 50 MB each'; end if;
  if p_category not in ('document','photo','receipt','school','home','other') then
    raise exception 'Invalid file category';
  end if;

  select * into v_ent
  from public.files_storage_entitlement_v1(p_household_id);

  if not v_ent.can_upload then
    if v_ent.needs_storage_offer then
      raise exception 'Storage is in downgrade grace. Keep 10 GB storage or reduce usage below 1 GB before uploading.';
    end if;
    raise exception 'Files storage limit reached';
  end if;

  if v_ent.used_bytes+p_file_size>v_ent.quota_bytes then
    raise exception 'This upload would exceed the Files storage limit';
  end if;

  v_safe_name:=regexp_replace(trim(p_file_name),'[^A-Za-z0-9._-]+','-','g');
  if v_safe_name='' then v_safe_name:='file'; end if;
  v_path:=p_household_id::text||'/'||v_id::text||'/'||v_safe_name;

  insert into public.household_files(
    id,household_id,title,file_name,storage_path,mime_type,file_size,category,notes,status,created_by_user_id
  )
  values(
    v_id,p_household_id,trim(p_title),trim(p_file_name),v_path,nullif(trim(p_mime_type),''),
    p_file_size,p_category,nullif(trim(p_notes),''),'pending',auth.uid()
  );

  return query select v_id,v_path;
end;
$$;

revoke all on function public.reserve_household_file_v1(uuid,text,text,text,bigint,text,text) from public,anon;
grant execute on function public.reserve_household_file_v1(uuid,text,text,text,bigint,text,text) to authenticated;


create or replace function public.complete_household_file_v1(
  p_household_id uuid,
  p_file_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'files','full') then
    raise exception 'Files write access required';
  end if;

  update public.household_files
  set status='active',updated_at=now()
  where id=p_file_id
    and household_id=p_household_id
    and status='pending'
    and created_by_user_id=auth.uid();

  if not found then raise exception 'Pending file not found'; end if;
  return true;
end;
$$;

revoke all on function public.complete_household_file_v1(uuid,uuid) from public,anon;
grant execute on function public.complete_household_file_v1(uuid,uuid) to authenticated;


create or replace function public.cancel_household_file_v1(
  p_household_id uuid,
  p_file_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  delete from public.household_files
  where id=p_file_id
    and household_id=p_household_id
    and status='pending'
    and created_by_user_id=auth.uid();

  return true;
end;
$$;

revoke all on function public.cancel_household_file_v1(uuid,uuid) from public,anon;
grant execute on function public.cancel_household_file_v1(uuid,uuid) to authenticated;


insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('famioo-files','famioo-files',false,52428800,null)
on conflict(id) do update set
  public=false,
  file_size_limit=52428800;

drop policy if exists famioo_files_objects_select on storage.objects;
create policy famioo_files_objects_select
on storage.objects
for select
to authenticated
using(
  bucket_id='famioo-files'
  and private.has_module_access(
    nullif(split_part(name,'/',1),'')::uuid,
    'files',
    'read'
  )
);

drop policy if exists famioo_files_objects_insert on storage.objects;
create policy famioo_files_objects_insert
on storage.objects
for insert
to authenticated
with check(
  bucket_id='famioo-files'
  and exists(
    select 1
    from public.household_files hf
    where hf.storage_path=storage.objects.name
      and hf.household_id=nullif(split_part(storage.objects.name,'/',1),'')::uuid
      and hf.status='pending'
      and hf.created_by_user_id=auth.uid()
      and private.has_module_access(hf.household_id,'files','full')
  )
);

drop policy if exists famioo_files_objects_delete on storage.objects;
create policy famioo_files_objects_delete
on storage.objects
for delete
to authenticated
using(
  bucket_id='famioo-files'
  and private.has_module_access(
    nullif(split_part(name,'/',1),'')::uuid,
    'files',
    'full'
  )
);


-- Price quote helper. The first non-AI paid module is always €0.99.
-- Follow-up prices stay configurable until the final per-module prices are supplied.
create or replace function public.module_purchase_quote_v1(
  p_household_id uuid,
  p_module_code text
)
returns numeric
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_core boolean;
  v_first numeric;
  v_follow numeric;
  v_count integer;
begin
  if auth.uid() is null or not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;

  select is_core into v_core
  from public.modules
  where code=p_module_code and is_active;

  if v_core then return 0; end if;

  if p_module_code='assistant' then return 1.69; end if;

  select first_purchase_price_eur,followup_price_eur
  into v_first,v_follow
  from public.billing_products
  where module_code=p_module_code
    and product_kind='module'
    and active
  limit 1;

  select count(*) into v_count
  from public.household_billing_items hbi
  join public.billing_products bp on bp.product_code=hbi.product_code
  where hbi.household_id=p_household_id
    and hbi.status='active'
    and bp.product_kind in ('module','assistant_base');

  if v_count=0 then return coalesce(v_first,0.99); end if;
  return v_follow;
end;
$$;

revoke all on function public.module_purchase_quote_v1(uuid,text) from public,anon;
grant execute on function public.module_purchase_quote_v1(uuid,text) to authenticated;
