-- Famioo migration 062
-- Add a neutral Life Admin destination for useful information captured from QR codes.

insert into public.household_module_types(
  household_id,module_code,group_code,type_key,label,base_type,
  sort_order,active,is_default,created_by_user_id,color_key
)
select
  h.id,
  'life_admin',
  'item_type',
  'reference',
  'Reference',
  'document',
  15,
  true,
  true,
  null,
  'teal'
from public.households h
where not exists(
  select 1
  from public.household_module_types t
  where t.household_id=h.id
    and t.module_code='life_admin'
    and t.group_code='item_type'
    and lower(t.type_key)='reference'
);

-- Keep Reference available if a previous row exists but was disabled.
update public.household_module_types
set label='Reference',
    base_type='document',
    color_key='teal',
    active=true,
    updated_at=now()
where module_code='life_admin'
  and group_code='item_type'
  and lower(type_key)='reference';
