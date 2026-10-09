-- Famioo migration 105
-- Pets RLS/performance hardening.

create index if not exists family_pets_created_by_idx
  on public.family_pets(created_by_user_id);

drop policy if exists family_pets_write on public.family_pets;
drop policy if exists family_pets_insert on public.family_pets;
drop policy if exists family_pets_update on public.family_pets;
drop policy if exists family_pets_delete on public.family_pets;

create policy family_pets_insert
on public.family_pets for insert to authenticated
with check(
  private.has_module_access(household_id,'pets','full')
  and created_by_user_id=(select auth.uid())
);

create policy family_pets_update
on public.family_pets for update to authenticated
using(private.has_module_access(household_id,'pets','full'))
with check(private.has_module_access(household_id,'pets','full'));

create policy family_pets_delete
on public.family_pets for delete to authenticated
using(private.has_module_access(household_id,'pets','full'));
