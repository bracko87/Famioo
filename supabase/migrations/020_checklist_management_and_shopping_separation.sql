-- Famioo migration 020
-- Checklist editing/archive controls and separation from Shopping.

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
      and lower(trim(ec.name))='shopping'
  ) then
    raise exception 'Shopping lists belong in the Shopping module. Choose another checklist category.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_shopping_checklist_category_v1 on public.checklists;
create trigger prevent_shopping_checklist_category_v1
before insert or update of category_id on public.checklists
for each row execute function private.prevent_shopping_checklist_category_v1();

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
      and lower(trim(ec.name))='shopping'
  ) then
    raise exception 'Use the Shopping module for shopping items.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_shopping_checklist_item_v1 on public.checklist_items;
create trigger prevent_shopping_checklist_item_v1
before insert on public.checklist_items
for each row execute function private.prevent_shopping_checklist_item_v1();

create or replace function public.update_checklist_v1(
  p_checklist_id uuid,
  p_household_id uuid,
  p_title text,
  p_category_id uuid,
  p_due_date date default null,
  p_location_text text default null,
  p_participants jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'checklists','full') then
    raise exception 'Checklists write access required';
  end if;
  if nullif(trim(p_title),'') is null then raise exception 'Checklist name is required'; end if;

  if not exists(
    select 1
    from public.checklists
    where id=p_checklist_id
      and household_id=p_household_id
      and status='active'
  ) then
    raise exception 'Active checklist not found';
  end if;

  if p_category_id is null or not exists(
    select 1
    from public.event_categories
    where id=p_category_id
      and household_id=p_household_id
      and active
  ) then
    raise exception 'A valid category is required';
  end if;

  update public.checklists
  set title=trim(p_title),
      category_id=p_category_id,
      due_date=p_due_date,
      location_text=nullif(trim(p_location_text),''),
      updated_at=now()
  where id=p_checklist_id
    and household_id=p_household_id
    and status='active';

  delete from public.checklist_participants
  where checklist_id=p_checklist_id
    and household_id=p_household_id;

  insert into public.checklist_participants(household_id,checklist_id,profile_id)
  select p_household_id,p_checklist_id,x.profile_id
  from jsonb_to_recordset(coalesce(p_participants,'[]'::jsonb)) as x(profile_id uuid)
  join public.family_profiles fp
    on fp.id=x.profile_id
   and fp.household_id=p_household_id
   and fp.active
  on conflict(checklist_id,profile_id) do nothing;

  return p_checklist_id;
end;
$$;

revoke all on function public.update_checklist_v1(uuid,uuid,text,uuid,date,text,jsonb) from public;
grant execute on function public.update_checklist_v1(uuid,uuid,text,uuid,date,text,jsonb) to authenticated;

create or replace function public.set_checklist_archived_v1(
  p_checklist_id uuid,
  p_household_id uuid,
  p_archived boolean
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'checklists','full') then
    raise exception 'Checklists write access required';
  end if;

  update public.checklists
  set status=case when p_archived then 'archived' else 'active' end,
      archived_at=case when p_archived then now() else null end,
      updated_at=now()
  where id=p_checklist_id
    and household_id=p_household_id;

  if not found then raise exception 'Checklist not found'; end if;

  return true;
end;
$$;

revoke all on function public.set_checklist_archived_v1(uuid,uuid,boolean) from public;
grant execute on function public.set_checklist_archived_v1(uuid,uuid,boolean) to authenticated;
