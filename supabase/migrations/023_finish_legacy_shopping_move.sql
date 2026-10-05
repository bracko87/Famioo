-- Famioo migration 023
-- Finish moving legacy Shopping-category checklists into Shopping after archival.

insert into public.shopping_lists(
  household_id,title,status,created_by_user_id,created_at,updated_at,
  linked_event_id,category_id,scheduled_date,location_text,source_checklist_id
)
select
  c.household_id,c.title,'active',c.created_by_user_id,c.created_at,now(),
  c.linked_event_id,c.category_id,c.due_date,c.location_text,c.id
from public.checklists c
join public.event_categories ec
  on ec.id=c.category_id
 and ec.household_id=c.household_id
where lower(trim(ec.name)) in ('shopping','shoping')
  and not exists(
    select 1
    from public.shopping_lists s
    where s.source_checklist_id=c.id
  );

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
