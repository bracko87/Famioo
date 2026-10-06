-- Famioo migration 044
-- Meals & Recipes module.

create table if not exists public.recipes(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  description text null,
  meal_type text not null default 'dinner'
    check(meal_type in ('breakfast','lunch','dinner','snack','other')),
  prep_minutes integer null check(prep_minutes is null or prep_minutes between 0 and 1440),
  servings integer null check(servings is null or servings between 1 and 100),
  instructions text null,
  created_by_user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recipe_ingredients(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  item_text text not null,
  quantity text null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.meal_plan_entries(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  recipe_id uuid null references public.recipes(id) on delete set null,
  title text not null,
  meal_date date not null,
  meal_type text not null default 'dinner'
    check(meal_type in ('breakfast','lunch','dinner','snack','other')),
  notes text null,
  linked_event_id uuid null references public.calendar_events(id) on delete set null,
  created_by_user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recipes_household_idx
  on public.recipes(household_id,archived_at,created_at desc);

create index if not exists recipe_ingredients_recipe_idx
  on public.recipe_ingredients(recipe_id,sort_order,id);

create index if not exists meal_plan_entries_household_date_idx
  on public.meal_plan_entries(household_id,meal_date,meal_type);

alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.meal_plan_entries enable row level security;

drop policy if exists recipes_select on public.recipes;
create policy recipes_select on public.recipes
for select using(private.has_module_access(household_id,'meals','read'));

drop policy if exists recipes_insert on public.recipes;
create policy recipes_insert on public.recipes
for insert with check(private.has_module_access(household_id,'meals','full'));

drop policy if exists recipes_update on public.recipes;
create policy recipes_update on public.recipes
for update using(private.has_module_access(household_id,'meals','full'))
with check(private.has_module_access(household_id,'meals','full'));

drop policy if exists recipes_delete on public.recipes;
create policy recipes_delete on public.recipes
for delete using(private.has_module_access(household_id,'meals','full'));

drop policy if exists recipe_ingredients_select on public.recipe_ingredients;
create policy recipe_ingredients_select on public.recipe_ingredients
for select using(private.has_module_access(household_id,'meals','read'));

drop policy if exists recipe_ingredients_insert on public.recipe_ingredients;
create policy recipe_ingredients_insert on public.recipe_ingredients
for insert with check(private.has_module_access(household_id,'meals','full'));

drop policy if exists recipe_ingredients_update on public.recipe_ingredients;
create policy recipe_ingredients_update on public.recipe_ingredients
for update using(private.has_module_access(household_id,'meals','full'))
with check(private.has_module_access(household_id,'meals','full'));

drop policy if exists recipe_ingredients_delete on public.recipe_ingredients;
create policy recipe_ingredients_delete on public.recipe_ingredients
for delete using(private.has_module_access(household_id,'meals','full'));

drop policy if exists meal_plan_entries_select on public.meal_plan_entries;
create policy meal_plan_entries_select on public.meal_plan_entries
for select using(private.has_module_access(household_id,'meals','read'));

drop policy if exists meal_plan_entries_insert on public.meal_plan_entries;
create policy meal_plan_entries_insert on public.meal_plan_entries
for insert with check(private.has_module_access(household_id,'meals','full'));

drop policy if exists meal_plan_entries_update on public.meal_plan_entries;
create policy meal_plan_entries_update on public.meal_plan_entries
for update using(private.has_module_access(household_id,'meals','full'))
with check(private.has_module_access(household_id,'meals','full'));

drop policy if exists meal_plan_entries_delete on public.meal_plan_entries;
create policy meal_plan_entries_delete on public.meal_plan_entries
for delete using(private.has_module_access(household_id,'meals','full'));

grant select,insert,update,delete on public.recipes to authenticated;
grant select,insert,update,delete on public.recipe_ingredients to authenticated;
grant select,insert,update,delete on public.meal_plan_entries to authenticated;

insert into public.module_category_availability(
  household_id,module_code,category_id,enabled,updated_at
)
select ec.household_id,'meals',ec.id,true,now()
from public.event_categories ec
where ec.active
on conflict(household_id,module_code,category_id) do nothing;
