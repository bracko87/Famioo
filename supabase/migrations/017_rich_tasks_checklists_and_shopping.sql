-- Famioo migration 017
-- Rich tasks/checklists and first Shopping module foundation.

alter table public.tasks
  add column if not exists category_id uuid references public.event_categories(id) on delete set null,
  add column if not exists location_text text,
  add column if not exists linked_event_id uuid references public.calendar_events(id) on delete set null;

alter table public.task_templates
  add column if not exists category_id uuid references public.event_categories(id) on delete set null,
  add column if not exists location_text text;

create table if not exists public.task_participants (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  profile_id uuid not null references public.family_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(task_id,profile_id)
);

alter table public.task_participants enable row level security;

drop policy if exists task_participants_select_module_read on public.task_participants;
create policy task_participants_select_module_read
on public.task_participants for select to authenticated
using (private.has_module_access(household_id,'tasks','read'));

drop policy if exists task_participants_insert_module_full on public.task_participants;
create policy task_participants_insert_module_full
on public.task_participants for insert to authenticated
with check (private.has_module_access(household_id,'tasks','full'));

drop policy if exists task_participants_delete_module_full on public.task_participants;
create policy task_participants_delete_module_full
on public.task_participants for delete to authenticated
using (private.has_module_access(household_id,'tasks','full'));

grant select,insert,delete on public.task_participants to authenticated;

alter table public.checklists
  add column if not exists category_id uuid references public.event_categories(id) on delete set null,
  add column if not exists due_date date,
  add column if not exists location_text text,
  add column if not exists linked_task_id uuid references public.tasks(id) on delete set null,
  add column if not exists template_id uuid;

create table if not exists public.checklist_participants (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  profile_id uuid not null references public.family_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(checklist_id,profile_id)
);

alter table public.checklist_participants enable row level security;

drop policy if exists checklist_participants_select_module_read on public.checklist_participants;
create policy checklist_participants_select_module_read
on public.checklist_participants for select to authenticated
using (private.has_module_access(household_id,'checklists','read'));

drop policy if exists checklist_participants_insert_module_full on public.checklist_participants;
create policy checklist_participants_insert_module_full
on public.checklist_participants for insert to authenticated
with check (private.has_module_access(household_id,'checklists','full'));

drop policy if exists checklist_participants_delete_module_full on public.checklist_participants;
create policy checklist_participants_delete_module_full
on public.checklist_participants for delete to authenticated
using (private.has_module_access(household_id,'checklists','full'));

grant select,insert,delete on public.checklist_participants to authenticated;

create table if not exists public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  title text not null,
  category_id uuid references public.event_categories(id) on delete set null,
  location_text text,
  active boolean not null default true,
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.checklists
  drop constraint if exists checklists_template_id_fkey;
alter table public.checklists
  add constraint checklists_template_id_fkey
  foreign key (template_id) references public.checklist_templates(id) on delete set null;

alter table public.checklist_templates enable row level security;

drop policy if exists checklist_templates_select_module_read on public.checklist_templates;
create policy checklist_templates_select_module_read
on public.checklist_templates for select to authenticated
using (private.has_module_access(household_id,'checklists','read'));

drop policy if exists checklist_templates_insert_module_full on public.checklist_templates;
create policy checklist_templates_insert_module_full
on public.checklist_templates for insert to authenticated
with check (
  private.has_module_access(household_id,'checklists','full')
  and created_by_user_id=auth.uid()
);

drop policy if exists checklist_templates_update_module_full on public.checklist_templates;
create policy checklist_templates_update_module_full
on public.checklist_templates for update to authenticated
using (private.has_module_access(household_id,'checklists','full'))
with check (private.has_module_access(household_id,'checklists','full'));

drop policy if exists checklist_templates_delete_module_full on public.checklist_templates;
create policy checklist_templates_delete_module_full
on public.checklist_templates for delete to authenticated
using (private.has_module_access(household_id,'checklists','full'));

grant select,insert,update,delete on public.checklist_templates to authenticated;

create table if not exists public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  status text not null default 'active' check (status in ('active','archived')),
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  shopping_list_id uuid not null references public.shopping_lists(id) on delete cascade,
  item_text text not null,
  quantity text,
  checked boolean not null default false,
  checked_by_user_id uuid references auth.users(id) on delete set null,
  checked_at timestamptz,
  sort_order integer not null default 0,
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;

drop policy if exists shopping_lists_select_module_read on public.shopping_lists;
create policy shopping_lists_select_module_read
on public.shopping_lists for select to authenticated
using (private.has_module_access(household_id,'shopping','read'));

drop policy if exists shopping_lists_insert_module_full on public.shopping_lists;
create policy shopping_lists_insert_module_full
on public.shopping_lists for insert to authenticated
with check (
  private.has_module_access(household_id,'shopping','full')
  and created_by_user_id=auth.uid()
);

drop policy if exists shopping_lists_update_module_full on public.shopping_lists;
create policy shopping_lists_update_module_full
on public.shopping_lists for update to authenticated
using (private.has_module_access(household_id,'shopping','full'))
with check (private.has_module_access(household_id,'shopping','full'));

drop policy if exists shopping_lists_delete_module_full on public.shopping_lists;
create policy shopping_lists_delete_module_full
on public.shopping_lists for delete to authenticated
using (private.has_module_access(household_id,'shopping','full'));

drop policy if exists shopping_items_select_module_read on public.shopping_items;
create policy shopping_items_select_module_read
on public.shopping_items for select to authenticated
using (private.has_module_access(household_id,'shopping','read'));

drop policy if exists shopping_items_insert_module_full on public.shopping_items;
create policy shopping_items_insert_module_full
on public.shopping_items for insert to authenticated
with check (
  private.has_module_access(household_id,'shopping','full')
  and created_by_user_id=auth.uid()
);

drop policy if exists shopping_items_update_module_full on public.shopping_items;
create policy shopping_items_update_module_full
on public.shopping_items for update to authenticated
using (private.has_module_access(household_id,'shopping','full'))
with check (private.has_module_access(household_id,'shopping','full'));

drop policy if exists shopping_items_delete_module_full on public.shopping_items;
create policy shopping_items_delete_module_full
on public.shopping_items for delete to authenticated
using (private.has_module_access(household_id,'shopping','full'));

grant select,insert,update,delete on public.shopping_lists to authenticated;
grant select,insert,update,delete on public.shopping_items to authenticated;

create index if not exists task_participants_task_idx on public.task_participants(task_id);
create index if not exists checklist_participants_list_idx on public.checklist_participants(checklist_id);
create index if not exists shopping_lists_household_active_idx on public.shopping_lists(household_id,status,created_at desc);
create index if not exists shopping_items_list_idx on public.shopping_items(shopping_list_id,sort_order,created_at);

-- Shopping is the next development module. Unlock it for existing development households.
update public.household_modules
set enabled=true,
    source=case when source='default' then 'admin' else source end,
    enabled_at=coalesce(enabled_at,now()),
    updated_at=now()
where module_code='shopping';

create or replace function public.create_task_v1(
  p_household_id uuid,
  p_title text,
  p_category_id uuid,
  p_due_date date default null,
  p_location_text text default null,
  p_participants jsonb default '[]'::jsonb,
  p_add_to_calendar boolean default false,
  p_create_template boolean default false
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_task uuid;
  v_template uuid;
  v_event uuid;
  v_calendar uuid;
  v_first_profile uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'tasks','full') then
    raise exception 'Tasks write access required';
  end if;
  if nullif(trim(p_title),'') is null then raise exception 'Task name is required'; end if;
  if p_category_id is null or not exists(
    select 1 from public.event_categories
    where id=p_category_id and household_id=p_household_id and active
  ) then
    raise exception 'A valid category is required';
  end if;

  select x.profile_id into v_first_profile
  from jsonb_to_recordset(coalesce(p_participants,'[]'::jsonb)) as x(profile_id uuid)
  join public.family_profiles fp
    on fp.id=x.profile_id and fp.household_id=p_household_id and fp.active
  limit 1;

  if p_create_template then
    insert into public.task_templates(
      household_id,name,title,category_id,location_text,default_assigned_profile_id,created_by_user_id
    )
    values(
      p_household_id,trim(p_title),trim(p_title),p_category_id,
      nullif(trim(p_location_text),''),v_first_profile,v_user
    )
    returning id into v_template;
  end if;

  insert into public.tasks(
    household_id,template_id,title,category_id,due_date,location_text,
    assigned_profile_id,created_by_user_id
  )
  values(
    p_household_id,v_template,trim(p_title),p_category_id,p_due_date,
    nullif(trim(p_location_text),''),v_first_profile,v_user
  )
  returning id into v_task;

  insert into public.task_participants(household_id,task_id,profile_id)
  select p_household_id,v_task,x.profile_id
  from jsonb_to_recordset(coalesce(p_participants,'[]'::jsonb)) as x(profile_id uuid)
  join public.family_profiles fp
    on fp.id=x.profile_id and fp.household_id=p_household_id and fp.active
  on conflict(task_id,profile_id) do nothing;

  if p_add_to_calendar then
    if p_due_date is null then
      raise exception 'A date is required when adding a task to Calendar';
    end if;

    select id into v_calendar
    from public.calendars
    where household_id=p_household_id and active
    order by is_default desc,name
    limit 1;

    if v_calendar is null then raise exception 'No active calendar found'; end if;

    v_event:=public.save_event_v1(
      null,p_household_id,v_calendar,trim(p_title),null,true,
      null,null,p_due_date,p_due_date,
      (select timezone from public.households where id=p_household_id),
      p_location_text,p_category_id,'household',
      coalesce(p_participants,'[]'::jsonb),null,'[]'::jsonb
    );

    update public.tasks set linked_event_id=v_event,updated_at=now() where id=v_task;
  end if;

  return v_task;
end;
$$;

revoke all on function public.create_task_v1(uuid,text,uuid,date,text,jsonb,boolean,boolean) from public;
grant execute on function public.create_task_v1(uuid,text,uuid,date,text,jsonb,boolean,boolean) to authenticated;

create or replace function public.create_checklist_v1(
  p_household_id uuid,
  p_title text,
  p_category_id uuid,
  p_due_date date default null,
  p_location_text text default null,
  p_participants jsonb default '[]'::jsonb,
  p_linked_event_id uuid default null,
  p_linked_task_id uuid default null,
  p_add_to_calendar boolean default false,
  p_add_to_task boolean default false,
  p_create_template boolean default false
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_checklist uuid;
  v_template uuid;
  v_event uuid:=p_linked_event_id;
  v_task uuid:=p_linked_task_id;
  v_calendar uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'checklists','full') then
    raise exception 'Checklists write access required';
  end if;
  if nullif(trim(p_title),'') is null then raise exception 'Checklist name is required'; end if;
  if p_category_id is null or not exists(
    select 1 from public.event_categories
    where id=p_category_id and household_id=p_household_id and active
  ) then
    raise exception 'A valid category is required';
  end if;
  if p_linked_event_id is not null and p_linked_task_id is not null then
    raise exception 'Choose either an existing event or an existing task';
  end if;

  if p_linked_event_id is not null then
    if not exists(
      select 1 from public.calendar_events
      where id=p_linked_event_id and household_id=p_household_id and deleted_at is null
    ) then raise exception 'Calendar event not found'; end if;
    p_add_to_calendar:=false;
    p_add_to_task:=false;
    p_create_template:=false;
  elsif p_linked_task_id is not null then
    if not exists(
      select 1 from public.tasks
      where id=p_linked_task_id and household_id=p_household_id and archived_at is null
    ) then raise exception 'Task not found'; end if;
    p_add_to_calendar:=false;
    p_add_to_task:=false;
    p_create_template:=false;
  end if;

  if p_create_template then
    insert into public.checklist_templates(
      household_id,name,title,category_id,location_text,created_by_user_id
    )
    values(
      p_household_id,trim(p_title),trim(p_title),p_category_id,
      nullif(trim(p_location_text),''),v_user
    )
    returning id into v_template;
  end if;

  if p_add_to_task then
    v_task:=public.create_task_v1(
      p_household_id,p_title,p_category_id,p_due_date,p_location_text,
      p_participants,false,false
    );
  end if;

  if p_add_to_calendar then
    if p_due_date is null then
      raise exception 'A date is required when adding a checklist to Calendar';
    end if;

    select id into v_calendar
    from public.calendars
    where household_id=p_household_id and active
    order by is_default desc,name
    limit 1;

    if v_calendar is null then raise exception 'No active calendar found'; end if;

    v_event:=public.save_event_v1(
      null,p_household_id,v_calendar,trim(p_title),null,true,
      null,null,p_due_date,p_due_date,
      (select timezone from public.households where id=p_household_id),
      p_location_text,p_category_id,'household',
      coalesce(p_participants,'[]'::jsonb),null,'[]'::jsonb
    );

    if v_task is not null then
      update public.tasks set linked_event_id=v_event,updated_at=now() where id=v_task;
    end if;
  end if;

  insert into public.checklists(
    household_id,title,category_id,due_date,location_text,
    linked_event_id,linked_task_id,template_id,created_by_user_id
  )
  values(
    p_household_id,trim(p_title),p_category_id,p_due_date,
    nullif(trim(p_location_text),''),v_event,v_task,v_template,v_user
  )
  returning id into v_checklist;

  insert into public.checklist_participants(household_id,checklist_id,profile_id)
  select p_household_id,v_checklist,x.profile_id
  from jsonb_to_recordset(coalesce(p_participants,'[]'::jsonb)) as x(profile_id uuid)
  join public.family_profiles fp
    on fp.id=x.profile_id and fp.household_id=p_household_id and fp.active
  on conflict(checklist_id,profile_id) do nothing;

  return v_checklist;
end;
$$;

revoke all on function public.create_checklist_v1(uuid,text,uuid,date,text,jsonb,uuid,uuid,boolean,boolean,boolean) from public;
grant execute on function public.create_checklist_v1(uuid,text,uuid,date,text,jsonb,uuid,uuid,boolean,boolean,boolean) to authenticated;
