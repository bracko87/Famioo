-- Famioo migration 022
-- Move legacy Shopping-category checklists into the Shopping module.

alter table public.shopping_lists
  add column if not exists source_checklist_id uuid references public.checklists(id) on delete set null;

create unique index if not exists shopping_lists_source_checklist_uidx
  on public.shopping_lists(source_checklist_id)
  where source_checklist_id is not null;

with legacy as (
  select
    c.id as checklist_id,
    c.household_id,
    c.title,
    c.linked_event_id,
    c.category_id,
    c.due_date,
    c.location_text,
    c.created_by_user_id,
    c.created_at
  from public.checklists c
  join public.event_categories ec
    on ec.id=c.category_id
   and ec.household_id=c.household_id
  where c.status='active'
    and lower(trim(ec.name)) in ('shopping','shoping')
),
inserted as (
  insert into public.shopping_lists(
    household_id,title,status,created_by_user_id,created_at,updated_at,
    linked_event_id,category_id,scheduled_date,location_text,source_checklist_id
  )
  select
    l.household_id,l.title,'active',l.created_by_user_id,l.created_at,now(),
    l.linked_event_id,l.category_id,l.due_date,l.location_text,l.checklist_id
  from legacy l
  on conflict(source_checklist_id) where source_checklist_id is not null do nothing
  returning id,source_checklist_id,household_id
)
insert into public.shopping_items(
  household_id,shopping_list_id,item_text,quantity,checked,checked_by_user_id,
  checked_at,sort_order,created_by_user_id,created_at,updated_at
)
select
  i.household_id,
  s.id,
  i.item_text,
  null,
  i.checked,
  i.checked_by_user_id,
  i.checked_at,
  i.sort_order,
  i.created_by_user_id,
  i.created_at,
  i.updated_at
from public.checklist_items i
join public.shopping_lists s
  on s.source_checklist_id=i.checklist_id
where not exists(
  select 1
  from public.shopping_items si
  where si.shopping_list_id=s.id
    and si.item_text=i.item_text
    and si.sort_order=i.sort_order
);

update public.checklists c
set status='archived',
    archived_at=coalesce(c.archived_at,now()),
    updated_at=now()
from public.event_categories ec
where ec.id=c.category_id
  and ec.household_id=c.household_id
  and c.status='active'
  and lower(trim(ec.name)) in ('shopping','shoping');

update public.event_categories ec
set name='Shopping',
    updated_at=now()
where lower(trim(ec.name))='shoping'
  and not exists(
    select 1
    from public.event_categories other
    where other.household_id=ec.household_id
      and other.id<>ec.id
      and lower(trim(other.name))='shopping'
  );
