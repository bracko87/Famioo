-- Famioo migration 026
-- Calendar templates and per-module category availability.

create or replace function private.is_household_admin_or_owner(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists(
    select 1
    from public.household_members hm
    where hm.household_id=p_household_id
      and hm.user_id=auth.uid()
      and hm.status='active'
      and hm.role in ('owner','admin')
  );
$$;

revoke all on function private.is_household_admin_or_owner(uuid) from public;

create table if not exists public.event_templates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  title text not null,
  category_id uuid references public.event_categories(id) on delete set null,
  all_day boolean not null default true,
  start_time time,
  end_time time,
  location_text text,
  active boolean not null default true,
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.event_templates enable row level security;

drop policy if exists event_templates_select_module_read on public.event_templates;
create policy event_templates_select_module_read
on public.event_templates for select to authenticated
using (private.has_module_access(household_id,'calendar','read'));

drop policy if exists event_templates_insert_module_full on public.event_templates;
create policy event_templates_insert_module_full
on public.event_templates for insert to authenticated
with check (
  private.has_module_access(household_id,'calendar','full')
  and created_by_user_id=auth.uid()
);

drop policy if exists event_templates_update_module_full on public.event_templates;
create policy event_templates_update_module_full
on public.event_templates for update to authenticated
using (private.has_module_access(household_id,'calendar','full'))
with check (private.has_module_access(household_id,'calendar','full'));

drop policy if exists event_templates_delete_module_full on public.event_templates;
create policy event_templates_delete_module_full
on public.event_templates for delete to authenticated
using (private.has_module_access(household_id,'calendar','full'));

grant select,insert,update,delete on public.event_templates to authenticated;

create index if not exists event_templates_household_idx
  on public.event_templates(household_id,active,name);

create table if not exists public.module_category_availability (
  household_id uuid not null references public.households(id) on delete cascade,
  module_code text not null references public.modules(code) on delete cascade,
  category_id uuid not null references public.event_categories(id) on delete cascade,
  enabled boolean not null default true,
  updated_by_user_id uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key(household_id,module_code,category_id)
);

alter table public.module_category_availability enable row level security;

drop policy if exists module_category_availability_select on public.module_category_availability;
create policy module_category_availability_select
on public.module_category_availability for select to authenticated
using (private.is_household_member(household_id));

drop policy if exists module_category_availability_insert on public.module_category_availability;
create policy module_category_availability_insert
on public.module_category_availability for insert to authenticated
with check (private.is_household_admin_or_owner(household_id));

drop policy if exists module_category_availability_update on public.module_category_availability;
create policy module_category_availability_update
on public.module_category_availability for update to authenticated
using (private.is_household_admin_or_owner(household_id))
with check (private.is_household_admin_or_owner(household_id));

drop policy if exists module_category_availability_delete on public.module_category_availability;
create policy module_category_availability_delete
on public.module_category_availability for delete to authenticated
using (private.is_household_admin_or_owner(household_id));

grant select,insert,update,delete on public.module_category_availability to authenticated;

insert into public.module_category_availability(household_id,module_code,category_id,enabled)
select ec.household_id,m.code,ec.id,true
from public.event_categories ec
cross join public.modules m
where ec.active
  and m.code in ('calendar','tasks','checklists')
on conflict(household_id,module_code,category_id) do nothing;

create or replace function private.seed_category_availability_v1()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if new.active then
    insert into public.module_category_availability(
      household_id,module_code,category_id,enabled
    )
    select new.household_id,m.code,new.id,true
    from public.modules m
    where m.code in ('calendar','tasks','checklists')
    on conflict(household_id,module_code,category_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_seed_category_availability on public.event_categories;
create trigger trg_seed_category_availability
after insert or update of active
on public.event_categories
for each row
execute function private.seed_category_availability_v1();
