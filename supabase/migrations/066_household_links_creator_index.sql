-- Famioo migration 066
-- Cover household_links creator foreign key for deletes/maintenance.

create index if not exists household_links_created_by_idx
on public.household_links(created_by_user_id);
