-- Famioo migration 065
-- Avoid per-row auth.uid() re-evaluation on Files link inserts.

drop policy if exists household_links_insert on public.household_links;
create policy household_links_insert
on public.household_links
for insert
to authenticated
with check(
  private.has_module_access(household_id,'files','full')
  and created_by_user_id=(select auth.uid())
);
