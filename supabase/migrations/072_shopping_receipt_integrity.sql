-- Famioo migration 072
-- Enforce same-household integrity for receipt links and line items.

alter table public.shopping_receipts
  add constraint shopping_receipts_household_id_id_key unique(household_id,id);

alter table public.shopping_receipt_items
  drop constraint if exists shopping_receipt_items_receipt_id_fkey;

alter table public.shopping_receipt_items
  add constraint shopping_receipt_items_household_receipt_fkey
  foreign key(household_id,receipt_id)
  references public.shopping_receipts(household_id,id)
  on delete cascade;

drop policy if exists shopping_receipts_insert on public.shopping_receipts;
create policy shopping_receipts_insert
on public.shopping_receipts for insert to authenticated
with check(
  private.has_module_access(household_id,'shopping','full')
  and created_by_user_id=(select auth.uid())
  and (
    shopping_list_id is null
    or exists(
      select 1
      from public.shopping_lists s
      where s.id=shopping_list_id
        and s.household_id=household_id
    )
  )
  and (
    linked_cost_id is null
    or exists(
      select 1
      from public.household_costs c
      where c.id=linked_cost_id
        and c.household_id=household_id
    )
  )
);

drop policy if exists shopping_receipts_update on public.shopping_receipts;
create policy shopping_receipts_update
on public.shopping_receipts for update to authenticated
using(private.has_module_access(household_id,'shopping','full'))
with check(
  private.has_module_access(household_id,'shopping','full')
  and (
    shopping_list_id is null
    or exists(
      select 1
      from public.shopping_lists s
      where s.id=shopping_list_id
        and s.household_id=household_id
    )
  )
  and (
    linked_cost_id is null
    or exists(
      select 1
      from public.household_costs c
      where c.id=linked_cost_id
        and c.household_id=household_id
    )
  )
);

drop policy if exists shopping_receipt_items_insert on public.shopping_receipt_items;
create policy shopping_receipt_items_insert
on public.shopping_receipt_items for insert to authenticated
with check(
  private.has_module_access(household_id,'shopping','full')
  and exists(
    select 1
    from public.shopping_receipts r
    where r.id=receipt_id
      and r.household_id=household_id
  )
);

drop policy if exists shopping_receipt_items_update on public.shopping_receipt_items;
create policy shopping_receipt_items_update
on public.shopping_receipt_items for update to authenticated
using(private.has_module_access(household_id,'shopping','full'))
with check(
  private.has_module_access(household_id,'shopping','full')
  and exists(
    select 1
    from public.shopping_receipts r
    where r.id=receipt_id
      and r.household_id=household_id
  )
);
