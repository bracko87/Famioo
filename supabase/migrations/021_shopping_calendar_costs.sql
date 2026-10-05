-- Famioo migration 021
-- Calendar-linked Shopping, Shopping archive costs, and Household Costs foundation.

alter table public.shopping_lists
  add column if not exists linked_event_id uuid references public.calendar_events(id) on delete set null,
  add column if not exists category_id uuid references public.event_categories(id) on delete set null,
  add column if not exists scheduled_date date,
  add column if not exists location_text text,
  add column if not exists total_cost numeric(12,2),
  add column if not exists currency text not null default 'EUR';

create table if not exists public.household_costs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'EUR',
  cost_date date not null default current_date,
  cost_kind text not null default 'additional' check (cost_kind in ('regular','additional')),
  source_type text not null default 'manual' check (source_type in ('manual','shopping')),
  source_shopping_list_id uuid references public.shopping_lists(id) on delete set null,
  notes text,
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.household_costs enable row level security;

drop policy if exists household_costs_select_module_read on public.household_costs;
create policy household_costs_select_module_read
on public.household_costs for select to authenticated
using (private.has_module_access(household_id,'costs','read'));

drop policy if exists household_costs_insert_module_full on public.household_costs;
create policy household_costs_insert_module_full
on public.household_costs for insert to authenticated
with check (
  private.has_module_access(household_id,'costs','full')
  and created_by_user_id=auth.uid()
);

drop policy if exists household_costs_update_module_full on public.household_costs;
create policy household_costs_update_module_full
on public.household_costs for update to authenticated
using (private.has_module_access(household_id,'costs','full'))
with check (private.has_module_access(household_id,'costs','full'));

drop policy if exists household_costs_delete_module_full on public.household_costs;
create policy household_costs_delete_module_full
on public.household_costs for delete to authenticated
using (private.has_module_access(household_id,'costs','full'));

grant select,insert,update,delete on public.household_costs to authenticated;

create index if not exists household_costs_household_date_idx
  on public.household_costs(household_id,cost_date desc,created_at desc);

create index if not exists shopping_lists_linked_event_idx
  on public.shopping_lists(linked_event_id)
  where linked_event_id is not null;

-- Costs is now the next development module.
update public.household_modules
set enabled=true,
    source=case when source='default' then 'admin' else source end,
    enabled_at=coalesce(enabled_at,now()),
    updated_at=now()
where module_code='costs';

create or replace function public.create_shopping_list_v1(
  p_household_id uuid,
  p_title text default null,
  p_linked_event_id uuid default null,
  p_scheduled_date date default null
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_id uuid;
  v_title text;
  v_category uuid;
  v_location text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'shopping','full') then
    raise exception 'Shopping write access required';
  end if;

  if p_linked_event_id is not null then
    select e.title,e.category_id,e.location_text
    into v_title,v_category,v_location
    from public.calendar_events e
    where e.id=p_linked_event_id
      and e.household_id=p_household_id
      and e.deleted_at is null
      and e.status='active';

    if not found then raise exception 'Calendar event not found'; end if;
  else
    v_title:=nullif(trim(p_title),'');
    if v_title is null then raise exception 'Shopping list name is required'; end if;
  end if;

  insert into public.shopping_lists(
    household_id,title,linked_event_id,category_id,scheduled_date,location_text,
    status,created_by_user_id
  )
  values(
    p_household_id,v_title,p_linked_event_id,v_category,p_scheduled_date,
    nullif(trim(v_location),''),'active',v_user
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_shopping_list_v1(uuid,text,uuid,date) from public;
grant execute on function public.create_shopping_list_v1(uuid,text,uuid,date) to authenticated;

create or replace function public.archive_shopping_list_v1(
  p_shopping_list_id uuid,
  p_household_id uuid,
  p_total_cost numeric default null,
  p_currency text default 'EUR'
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_title text;
  v_date date;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'shopping','full') then
    raise exception 'Shopping write access required';
  end if;

  if p_total_cost is not null and p_total_cost < 0 then
    raise exception 'Cost cannot be negative';
  end if;

  select title,coalesce(scheduled_date,current_date)
  into v_title,v_date
  from public.shopping_lists
  where id=p_shopping_list_id
    and household_id=p_household_id
    and status='active';

  if not found then raise exception 'Active shopping list not found'; end if;

  update public.shopping_lists
  set status='archived',
      archived_at=now(),
      total_cost=p_total_cost,
      currency=coalesce(nullif(trim(p_currency),''),'EUR'),
      updated_at=now()
  where id=p_shopping_list_id
    and household_id=p_household_id;

  if p_total_cost is not null and p_total_cost > 0 then
    insert into public.household_costs(
      household_id,title,amount,currency,cost_date,cost_kind,source_type,
      source_shopping_list_id,created_by_user_id
    )
    values(
      p_household_id,'Shopping · '||v_title,p_total_cost,
      coalesce(nullif(trim(p_currency),''),'EUR'),
      v_date,'additional','shopping',p_shopping_list_id,v_user
    );
  end if;

  return true;
end;
$$;

revoke all on function public.archive_shopping_list_v1(uuid,uuid,numeric,text) from public;
grant execute on function public.archive_shopping_list_v1(uuid,uuid,numeric,text) to authenticated;

create or replace function public.restore_shopping_list_v1(
  p_shopping_list_id uuid,
  p_household_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'shopping','full') then
    raise exception 'Shopping write access required';
  end if;

  update public.shopping_lists
  set status='active',
      archived_at=null,
      total_cost=null,
      updated_at=now()
  where id=p_shopping_list_id
    and household_id=p_household_id
    and status='archived';

  if not found then raise exception 'Archived shopping list not found'; end if;

  update public.shopping_items
  set checked=false,
      checked_at=null,
      checked_by_user_id=null,
      updated_at=now()
  where shopping_list_id=p_shopping_list_id
    and household_id=p_household_id;

  return true;
end;
$$;

revoke all on function public.restore_shopping_list_v1(uuid,uuid) from public;
grant execute on function public.restore_shopping_list_v1(uuid,uuid) to authenticated;

-- Treat the existing misspelling "Shoping" the same as "Shopping" for checklist separation.
create or replace function private.prevent_shopping_checklist_category_v1()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if new.category_id is not null and exists(
    select 1
    from public.event_categories ec
    where ec.id=new.category_id
      and ec.household_id=new.household_id
      and lower(trim(ec.name)) in ('shopping','shoping')
  ) then
    raise exception 'Shopping lists belong in the Shopping module. Choose another checklist category.';
  end if;

  return new;
end;
$$;

create or replace function private.prevent_shopping_checklist_item_v1()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if exists(
    select 1
    from public.checklists c
    join public.event_categories ec
      on ec.id=c.category_id
     and ec.household_id=c.household_id
    where c.id=new.checklist_id
      and c.household_id=new.household_id
      and lower(trim(ec.name)) in ('shopping','shoping')
  ) then
    raise exception 'Use the Shopping module for shopping items.';
  end if;

  return new;
end;
$$;
