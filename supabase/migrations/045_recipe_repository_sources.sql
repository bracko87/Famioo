-- Famioo migration 045
-- Recipe repository source metadata for own and website-imported recipes.

alter table public.recipes
  add column if not exists source_type text not null default 'own'
    check(source_type in ('own','imported')),
  add column if not exists source_url text null,
  add column if not exists source_site text null,
  add column if not exists source_author text null,
  add column if not exists source_image_url text null,
  add column if not exists imported_at timestamptz null;

create index if not exists recipes_household_source_idx
  on public.recipes(household_id,source_type,archived_at,created_at desc);
