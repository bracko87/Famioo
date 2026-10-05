-- Famioo migration 028
-- Two expanded list slots, drag/drop persistence and six-month archive retention.

alter table public.checklists
  add column if not exists expanded_slot smallint;

alter table public.shopping_lists
  add column if not exists expanded_slot smallint;

alter table public.checklists
  drop constraint if exists checklists_expanded_slot_check;
alter table public.checklists
  add constraint checklists_expanded_slot_check
    check (expanded_slot is null or expanded_slot in (1,2));

alter table public.shopping_lists
  drop constraint if exists shopping_lists_expanded_slot_check;
alter table public.shopping_lists
  add constraint shopping_lists_expanded_slot_check
    check (expanded_slot is null or expanded_slot in (1,2));

with ranked as (
  select id,
         row_number() over (
           partition by household_id
           order by created_at desc, id
         ) as rn
  from public.checklists
  where status='active'
)
update public.checklists c
set expanded_slot=case when r.rn <= 2 then r.rn::smallint else null end
from ranked r
where c.id=r.id;

with ranked as (
  select id,
         row_number() over (
           partition by household_id
           order by created_at desc, id
         ) as rn
  from public.shopping_lists
  where status='active'
)
update public.shopping_lists s
set expanded_slot=case when r.rn <= 2 then r.rn::smallint else null end
from ranked r
where s.id=r.id;

create unique index if not exists checklists_two_expanded_slots_uidx
  on public.checklists(household_id, expanded_slot)
  where status='active' and expanded_slot is not null;

create unique index if not exists shopping_lists_two_expanded_slots_uidx
  on public.shopping_lists(household_id, expanded_slot)
  where status='active' and expanded_slot is not null;

create index if not exists checklists_archive_retention_idx
  on public.checklists(household_id, archived_at)
  where status='archived' and archived_at is not null;

create index if not exists shopping_lists_archive_retention_idx
  on public.shopping_lists(household_id, archived_at)
  where status='archived' and archived_at is not null;

create or replace function private.normalize_checklist_layout_v1()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if new.status <> 'active' then
    new.expanded_slot := null;
    return new;
  end if;

  if new.expanded_slot is null
     and (
       tg_op='INSERT'
       or (tg_op='UPDATE' and old.status is distinct from 'active')
     )
  then
    if not exists(
      select 1 from public.checklists
      where household_id=new.household_id
        and status='active'
        and expanded_slot=1
        and id is distinct from new.id
    ) then
      new.expanded_slot := 1;
    elsif not exists(
      select 1 from public.checklists
      where household_id=new.household_id
        and status='active'
        and expanded_slot=2
        and id is distinct from new.id
    ) then
      new.expanded_slot := 2;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_checklist_layout on public.checklists;
create trigger trg_normalize_checklist_layout
before insert or update of status,expanded_slot
on public.checklists
for each row
execute function private.normalize_checklist_layout_v1();

create or replace function private.normalize_shopping_layout_v1()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if new.status <> 'active' then
    new.expanded_slot := null;
    return new;
  end if;

  if new.expanded_slot is null
     and (
       tg_op='INSERT'
       or (tg_op='UPDATE' and old.status is distinct from 'active')
     )
  then
    if not exists(
      select 1 from public.shopping_lists
      where household_id=new.household_id
        and status='active'
        and expanded_slot=1
        and id is distinct from new.id
    ) then
      new.expanded_slot := 1;
    elsif not exists(
      select 1 from public.shopping_lists
      where household_id=new.household_id
        and status='active'
        and expanded_slot=2
        and id is distinct from new.id
    ) then
      new.expanded_slot := 2;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_shopping_layout on public.shopping_lists;
create trigger trg_normalize_shopping_layout
before insert or update of status,expanded_slot
on public.shopping_lists
for each row
execute function private.normalize_shopping_layout_v1();

create or replace function public.set_list_expanded_slot_v1(
  p_household_id uuid,
  p_list_type text,
  p_list_id uuid,
  p_slot smallint
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_old_slot smallint;
  v_other_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_slot is not null and p_slot not in (1,2) then
    raise exception 'Expanded slot must be 1 or 2';
  end if;

  if p_list_type='checklist' then
    if not private.has_module_access(p_household_id,'checklists','full') then
      raise exception 'Checklist write access required';
    end if;

    select expanded_slot
      into v_old_slot
    from public.checklists
    where id=p_list_id
      and household_id=p_household_id
      and status='active'
    for update;

    if not found then raise exception 'Checklist not found'; end if;

    if p_slot is null then
      update public.checklists
      set expanded_slot=null,updated_at=now()
      where id=p_list_id;
      return true;
    end if;

    if v_old_slot=p_slot then return true; end if;

    select id
      into v_other_id
    from public.checklists
    where household_id=p_household_id
      and status='active'
      and expanded_slot=p_slot
      and id<>p_list_id
    for update;

    update public.checklists
    set expanded_slot=null,updated_at=now()
    where id=p_list_id;

    if v_other_id is not null then
      update public.checklists
      set expanded_slot=null,updated_at=now()
      where id=v_other_id;
    end if;

    update public.checklists
    set expanded_slot=p_slot,updated_at=now()
    where id=p_list_id;

    if v_other_id is not null and v_old_slot is not null then
      update public.checklists
      set expanded_slot=v_old_slot,updated_at=now()
      where id=v_other_id;
    end if;

    return true;
  end if;

  if p_list_type='shopping' then
    if not private.has_module_access(p_household_id,'shopping','full') then
      raise exception 'Shopping write access required';
    end if;

    select expanded_slot
      into v_old_slot
    from public.shopping_lists
    where id=p_list_id
      and household_id=p_household_id
      and status='active'
    for update;

    if not found then raise exception 'Shopping list not found'; end if;

    if p_slot is null then
      update public.shopping_lists
      set expanded_slot=null,updated_at=now()
      where id=p_list_id;
      return true;
    end if;

    if v_old_slot=p_slot then return true; end if;

    select id
      into v_other_id
    from public.shopping_lists
    where household_id=p_household_id
      and status='active'
      and expanded_slot=p_slot
      and id<>p_list_id
    for update;

    update public.shopping_lists
    set expanded_slot=null,updated_at=now()
    where id=p_list_id;

    if v_other_id is not null then
      update public.shopping_lists
      set expanded_slot=null,updated_at=now()
      where id=v_other_id;
    end if;

    update public.shopping_lists
    set expanded_slot=p_slot,updated_at=now()
    where id=p_list_id;

    if v_other_id is not null and v_old_slot is not null then
      update public.shopping_lists
      set expanded_slot=v_old_slot,updated_at=now()
      where id=v_other_id;
    end if;

    return true;
  end if;

  raise exception 'Unsupported list type';
end;
$$;

revoke all on function public.set_list_expanded_slot_v1(uuid,text,uuid,smallint) from public;
grant execute on function public.set_list_expanded_slot_v1(uuid,text,uuid,smallint) to authenticated;

create or replace function public.purge_old_archives_v1(
  p_household_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_checklists integer:=0;
  v_shopping integer:=0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;

  delete from public.checklists
  where household_id=p_household_id
    and status='archived'
    and archived_at is not null
    and archived_at < now() - interval '6 months';
  get diagnostics v_checklists=row_count;

  delete from public.shopping_lists
  where household_id=p_household_id
    and status='archived'
    and archived_at is not null
    and archived_at < now() - interval '6 months';
  get diagnostics v_shopping=row_count;

  return jsonb_build_object(
    'checklists_deleted',v_checklists,
    'shopping_lists_deleted',v_shopping
  );
end;
$$;

revoke all on function public.purge_old_archives_v1(uuid) from public;
grant execute on function public.purge_old_archives_v1(uuid) to authenticated;
