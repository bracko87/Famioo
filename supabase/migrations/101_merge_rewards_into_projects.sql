-- Famioo migration 101
-- Merge Child Rewards into Projects & Chores.

update public.modules
set name='Projects, Chores & Rewards',
    description='Projects, household chores, family points and child rewards in one module',
    icon_key='folder-kanban'
where code='projects';

update public.modules
set name='Child Rewards (merged)',
    description='Merged into Projects, Chores & Rewards',
    is_core=false,
    is_active=false
where code='rewards';
