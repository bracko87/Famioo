-- Famioo migration 069
-- Mobile-safe task reordering uses explicit sort_order as a stable tie-breaker.

alter table public.tasks
  add column if not exists sort_order integer not null default 0;

create index if not exists tasks_household_order_idx
  on public.tasks(household_id,due_date,sort_order,created_at);
