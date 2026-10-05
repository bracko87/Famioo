-- Famioo migration 035
-- Type colors, Projects & Chores point calculator, importing existing Tasks,
-- task completion sync and Projects & Chores templates.

-- ---------------------------------------------------------------------------
-- Type colors
-- ---------------------------------------------------------------------------

alter table public.household_module_types
  add column if not exists color_key text not null default 'slate';

alter table public.household_module_types
  drop constraint if exists household_module_types_color_key_check;

alter table public.household_module_types
  add constraint household_module_types_color_key_check
  check (color_key in (
    'purple','violet','lavender','blue','sky','cyan','indigo','navy','teal','mint',
    'green','olive','lime','yellow','gold','amber','orange','coral','peach','red',
    'rose','pink','magenta','plum','brown','taupe','slate','steel','graphite','aqua'
  ));

update public.household_module_types
set color_key = case
  when module_code='home_care' and lower(type_key)='appliance' then 'purple'
  when module_code='home_care' and lower(type_key)='heating' then 'orange'
  when module_code='home_care' and lower(type_key)='electronics' then 'blue'
  when module_code='home_care' and lower(type_key)='furniture' then 'brown'
  when module_code='home_care' and lower(type_key)='garden' then 'green'
  when module_code='home_care' and lower(type_key)='vehicle' then 'steel'
  when module_code='home_care' and lower(type_key)='safety' then 'red'
  when module_code='home_care' and lower(type_key)='plumbing' then 'cyan'
  when module_code='home_care' and lower(type_key)='other' then 'graphite'
  when module_code='life_admin' and lower(type_key)='document' then 'purple'
  when module_code='life_admin' and lower(type_key)='contract' then 'blue'
  when module_code='life_admin' and lower(type_key)='insurance' then 'green'
  when module_code='life_admin' and lower(type_key)='subscription' then 'orange'
  when module_code='life_admin' and lower(type_key)='deadline' then 'red'
  else color_key
end
where color_key='slate' or is_default;

create or replace function public.save_household_module_type_v2(
  p_household_id uuid,
  p_module_code text,
  p_group_code text,
  p_label text,
  p_base_type text default null,
  p_color_key text default 'slate'
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_id uuid;
  v_key text;
  v_sort integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  if not exists(
    select 1 from public.household_members hm
    where hm.household_id=p_household_id
      and hm.user_id=auth.uid()
      and hm.status='active'
      and hm.role in ('owner','admin')
  ) then
    raise exception 'Owner or admin access required';
  end if;

  if p_module_code not in ('home_care','life_admin') then
    raise exception 'Types are not configurable for this module yet';
  end if;

  if p_group_code not in ('asset_type','item_type') then
    raise exception 'Invalid type group';
  end if;

  if nullif(trim(p_label),'') is null then
    raise exception 'Type name is required';
  end if;

  if p_color_key not in (
    'purple','violet','lavender','blue','sky','cyan','indigo','navy','teal','mint',
    'green','olive','lime','yellow','gold','amber','orange','coral','peach','red',
    'rose','pink','magenta','plum','brown','taupe','slate','steel','graphite','aqua'
  ) then
    raise exception 'Invalid type color';
  end if;

  if p_module_code='life_admin'
     and coalesce(p_base_type,'') not in ('document','contract','insurance','subscription','deadline')
  then
    raise exception 'Choose where this Life Admin type belongs';
  end if;

  select id into v_id
  from public.household_module_types
  where household_id=p_household_id
    and module_code=p_module_code
    and group_code=p_group_code
    and lower(label)=lower(trim(p_label))
  order by created_at
  limit 1;

  if v_id is not null then
    update public.household_module_types
    set active=true,
        label=trim(p_label),
        base_type=case when p_module_code='life_admin' then p_base_type else base_type end,
        color_key=p_color_key,
        updated_at=now()
    where id=v_id;
    return v_id;
  end if;

  select coalesce(max(sort_order),0)+10 into v_sort
  from public.household_module_types
  where household_id=p_household_id
    and module_code=p_module_code
    and group_code=p_group_code;

  if p_module_code='home_care' then
    v_key:=trim(p_label);
  else
    v_key:=lower(regexp_replace(trim(p_label),'[^a-zA-Z0-9]+','_','g'))
      || '_' || substr(gen_random_uuid()::text,1,8);
  end if;

  insert into public.household_module_types(
    household_id,module_code,group_code,type_key,label,base_type,color_key,
    sort_order,active,is_default,created_by_user_id
  )
  values(
    p_household_id,p_module_code,p_group_code,v_key,trim(p_label),
    case when p_module_code='life_admin' then p_base_type else null end,
    p_color_key,v_sort,true,false,auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.save_household_module_type_v2(uuid,text,text,text,text,text) from public;
grant execute on function public.save_household_module_type_v2(uuid,text,text,text,text,text) to authenticated;


-- ---------------------------------------------------------------------------
-- Projects & Chores point calculator
-- ---------------------------------------------------------------------------

alter table public.project_work_items
  add column if not exists score_duration text not null default '15_30',
  add column if not exists score_effort text not null default 'medium',
  add column if not exists score_execution text not null default 'manual',
  add column if not exists score_responsibility text not null default 'normal',
  add column if not exists task_link_origin text;

alter table public.project_work_items
  drop constraint if exists project_work_items_duration_check;
alter table public.project_work_items
  add constraint project_work_items_duration_check
  check (score_duration in (
    'under_15','15_30','30_45','45_60','1_2h','2_3h','3_5h','over_5h'
  ));

alter table public.project_work_items
  drop constraint if exists project_work_items_effort_check;
alter table public.project_work_items
  add constraint project_work_items_effort_check
  check (score_effort in ('very_low','low','medium','high','very_high','extreme'));

alter table public.project_work_items
  drop constraint if exists project_work_items_execution_check;
alter table public.project_work_items
  add constraint project_work_items_execution_check
  check (score_execution in ('automated','assisted','mixed','manual'));

alter table public.project_work_items
  drop constraint if exists project_work_items_responsibility_check;
alter table public.project_work_items
  add constraint project_work_items_responsibility_check
  check (score_responsibility in ('routine','normal','important','high'));

alter table public.project_work_items
  drop constraint if exists project_work_items_task_link_origin_check;
alter table public.project_work_items
  add constraint project_work_items_task_link_origin_check
  check (task_link_origin is null or task_link_origin in ('created','imported'));

update public.project_work_items
set task_link_origin='created'
where linked_task_id is not null
  and task_link_origin is null;

create or replace function private.project_points_for_v1(
  p_duration text,
  p_effort text,
  p_execution text,
  p_responsibility text
)
returns smallint
language plpgsql
immutable
set search_path=pg_catalog,public
as $$
declare
  v_points integer:=0;
begin
  v_points:=v_points + case p_duration
    when 'under_15' then 1
    when '15_30' then 2
    when '30_45' then 3
    when '45_60' then 4
    when '1_2h' then 6
    when '2_3h' then 8
    when '3_5h' then 11
    when 'over_5h' then 15
    else -1000 end;

  v_points:=v_points + case p_effort
    when 'very_low' then 0
    when 'low' then 1
    when 'medium' then 3
    when 'high' then 5
    when 'very_high' then 8
    when 'extreme' then 11
    else -1000 end;

  v_points:=v_points + case p_execution
    when 'automated' then 0
    when 'assisted' then 1
    when 'mixed' then 3
    when 'manual' then 5
    else -1000 end;

  v_points:=v_points + case p_responsibility
    when 'routine' then 0
    when 'normal' then 2
    when 'important' then 4
    when 'high' then 7
    else -1000 end;

  if v_points < 0 then
    raise exception 'Invalid Projects & Chores point-calculator selection';
  end if;

  return greatest(1,v_points)::smallint;
end;
$$;

revoke all on function private.project_points_for_v1(text,text,text,text) from public;


-- ---------------------------------------------------------------------------
-- Projects & Chores reusable templates
-- ---------------------------------------------------------------------------

create table if not exists public.project_work_templates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  item_kind text not null default 'chore',
  title text not null,
  category_id uuid references public.event_categories(id) on delete set null,
  location_text text,
  default_assigned_profile_id uuid,
  notes text,
  score_duration text not null default '15_30',
  score_effort text not null default 'medium',
  score_execution text not null default 'manual',
  score_responsibility text not null default 'normal',
  active boolean not null default true,
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_work_templates_name_check check (length(trim(name)) between 1 and 120),
  constraint project_work_templates_title_check check (length(trim(title)) between 1 and 200),
  constraint project_work_templates_kind_check check (item_kind in ('project_task','chore')),
  constraint project_work_templates_duration_check check (score_duration in ('under_15','15_30','30_45','45_60','1_2h','2_3h','3_5h','over_5h')),
  constraint project_work_templates_effort_check check (score_effort in ('very_low','low','medium','high','very_high','extreme')),
  constraint project_work_templates_execution_check check (score_execution in ('automated','assisted','mixed','manual')),
  constraint project_work_templates_responsibility_check check (score_responsibility in ('routine','normal','important','high')),
  constraint project_work_templates_profile_fk
    foreign key(household_id,default_assigned_profile_id)
    references public.family_profiles(household_id,id)
);

create index if not exists project_work_templates_household_idx
  on public.project_work_templates(household_id,active,name);

alter table public.project_work_templates enable row level security;

drop policy if exists project_work_templates_select on public.project_work_templates;
create policy project_work_templates_select
on public.project_work_templates for select to authenticated
using (private.has_module_access(household_id,'projects','read'));

drop policy if exists project_work_templates_insert on public.project_work_templates;
create policy project_work_templates_insert
on public.project_work_templates for insert to authenticated
with check (private.has_module_access(household_id,'projects','full'));

drop policy if exists project_work_templates_update on public.project_work_templates;
create policy project_work_templates_update
on public.project_work_templates for update to authenticated
using (private.has_module_access(household_id,'projects','full'))
with check (private.has_module_access(household_id,'projects','full'));

grant select,insert,update on public.project_work_templates to authenticated;


-- ---------------------------------------------------------------------------
-- Save/import Projects & Chores responsibility
-- ---------------------------------------------------------------------------

create or replace function public.save_project_work_item_v2(
  p_id uuid,
  p_household_id uuid,
  p_project_id uuid,
  p_item_kind text,
  p_title text,
  p_category_id uuid,
  p_due_date date,
  p_location_text text,
  p_assigned_profile_id uuid,
  p_notes text,
  p_sync_task boolean,
  p_sync_calendar boolean,
  p_score_duration text,
  p_score_effort text,
  p_score_execution text,
  p_score_responsibility text,
  p_existing_task_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_id uuid;
  v_task uuid;
  v_event uuid;
  v_calendar uuid;
  v_timezone text;
  v_participants jsonb:='[]'::jsonb;
  v_points smallint;
  v_origin text;
  v_task_row public.tasks%rowtype;
  v_title text;
  v_category uuid;
  v_due date;
  v_location text;
  v_assignee uuid;
  v_status text:='open';
  v_completed_at timestamptz;
  v_completed_by uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  if not private.has_module_access(p_household_id,'projects','full') then
    raise exception 'Projects & Chores write access required';
  end if;

  if p_item_kind not in ('project_task','chore') then
    raise exception 'Invalid responsibility type';
  end if;

  if p_project_id is not null and not exists(
    select 1 from public.household_projects
    where id=p_project_id and household_id=p_household_id and status='active'
  ) then
    raise exception 'Project not found';
  end if;

  v_points:=private.project_points_for_v1(
    p_score_duration,p_score_effort,p_score_execution,p_score_responsibility
  );

  if p_existing_task_id is not null and p_id is null then
    if not private.has_module_access(p_household_id,'tasks','read') then
      raise exception 'Tasks access required to import an existing Task';
    end if;

    select * into v_task_row
    from public.tasks
    where id=p_existing_task_id
      and household_id=p_household_id
      and archived_at is null
      and status in ('open','done')
    for update;

    if not found then raise exception 'Task not found or no longer available'; end if;

    if exists(
      select 1 from public.project_work_items
      where household_id=p_household_id
        and linked_task_id=p_existing_task_id
        and status<>'archived'
    ) then
      raise exception 'This Task is already part of Projects & Chores';
    end if;

    v_title:=v_task_row.title;
    v_category:=coalesce(v_task_row.category_id,p_category_id);
    v_due:=v_task_row.due_date;
    v_location:=v_task_row.location_text;
    v_assignee:=coalesce(
      v_task_row.assigned_profile_id,
      (select tp.profile_id from public.task_participants tp where tp.task_id=v_task_row.id order by tp.created_at limit 1)
    );
    v_task:=v_task_row.id;
    v_event:=v_task_row.linked_event_id;
    v_origin:='imported';
    v_status:=case when v_task_row.status='done' then 'done' else 'open' end;
    v_completed_at:=v_task_row.completed_at;
    v_completed_by:=coalesce(v_task_row.completed_by_profile_id,v_assignee);

    if v_category is null then
      raise exception 'The imported Task needs a category before it can enter Projects & Chores';
    end if;

    insert into public.project_work_items(
      household_id,project_id,item_kind,title,category_id,due_date,location_text,
      assigned_profile_id,points,notes,sync_task,sync_calendar,linked_task_id,
      linked_event_id,status,completed_at,completed_by_profile_id,created_by_user_id,
      score_duration,score_effort,score_execution,score_responsibility,task_link_origin
    )
    values(
      p_household_id,p_project_id,p_item_kind,v_title,v_category,v_due,v_location,
      v_assignee,v_points,nullif(trim(p_notes),''),true,(v_event is not null),
      v_task,v_event,v_status,v_completed_at,v_completed_by,auth.uid(),
      p_score_duration,p_score_effort,p_score_execution,p_score_responsibility,'imported'
    )
    returning id into v_id;

    if v_status='done' and v_assignee is not null and v_points>0 then
      insert into public.family_points_ledger(
        household_id,profile_id,source_work_item_id,points,awarded_at
      )
      values(
        p_household_id,v_assignee,v_id,v_points,coalesce(v_completed_at,now())
      )
      on conflict(source_work_item_id)
      do update set
        profile_id=excluded.profile_id,
        points=excluded.points,
        awarded_at=excluded.awarded_at;
    end if;

    return v_id;
  end if;

  if nullif(trim(p_title),'') is null then raise exception 'Name is required'; end if;

  if p_category_id is null or not exists(
    select 1 from public.event_categories
    where id=p_category_id and household_id=p_household_id and active
  ) then raise exception 'A category is required'; end if;

  if p_assigned_profile_id is not null and not exists(
    select 1 from public.family_profiles
    where id=p_assigned_profile_id and household_id=p_household_id and active
  ) then raise exception 'Assigned household member not found'; end if;

  if p_sync_task and not private.has_module_access(p_household_id,'tasks','full') then
    raise exception 'Tasks write access required';
  end if;

  if p_sync_calendar and p_due_date is null then
    raise exception 'A due date is required when adding this item to Calendar';
  end if;

  if p_sync_calendar and not private.has_module_access(p_household_id,'calendar','full') then
    raise exception 'Calendar write access required';
  end if;

  if p_assigned_profile_id is not null then
    v_participants:=jsonb_build_array(jsonb_build_object('profile_id',p_assigned_profile_id));
  end if;

  if p_id is null then
    insert into public.project_work_items(
      household_id,project_id,item_kind,title,category_id,due_date,location_text,
      assigned_profile_id,points,notes,sync_task,sync_calendar,created_by_user_id,
      score_duration,score_effort,score_execution,score_responsibility
    )
    values(
      p_household_id,p_project_id,p_item_kind,trim(p_title),p_category_id,p_due_date,
      nullif(trim(p_location_text),''),p_assigned_profile_id,v_points,
      nullif(trim(p_notes),''),coalesce(p_sync_task,false),coalesce(p_sync_calendar,false),
      auth.uid(),p_score_duration,p_score_effort,p_score_execution,p_score_responsibility
    )
    returning id into v_id;
  else
    select id,linked_task_id,linked_event_id,task_link_origin
      into v_id,v_task,v_event,v_origin
    from public.project_work_items
    where id=p_id and household_id=p_household_id and status='open'
    for update;

    if v_id is null then raise exception 'Responsibility not found'; end if;

    if v_origin='imported' and not p_sync_task then
      raise exception 'An imported Task remains linked to its Projects & Chores responsibility';
    end if;

    update public.project_work_items
    set project_id=p_project_id,
        item_kind=p_item_kind,
        title=trim(p_title),
        category_id=p_category_id,
        due_date=p_due_date,
        location_text=nullif(trim(p_location_text),''),
        assigned_profile_id=p_assigned_profile_id,
        points=v_points,
        notes=nullif(trim(p_notes),''),
        sync_task=coalesce(p_sync_task,false),
        sync_calendar=coalesce(p_sync_calendar,false),
        score_duration=p_score_duration,
        score_effort=p_score_effort,
        score_execution=p_score_execution,
        score_responsibility=p_score_responsibility,
        updated_at=now()
    where id=v_id;
  end if;

  if p_sync_task then
    if v_task is null then
      v_task:=public.create_task_v1(
        p_household_id,trim(p_title),p_category_id,p_due_date,p_location_text,
        v_participants,p_sync_calendar,false
      );
      v_origin:='created';
    else
      perform public.update_task_v1(
        v_task,p_household_id,trim(p_title),p_category_id,p_due_date,p_location_text,
        v_participants,p_sync_calendar
      );
    end if;

    select linked_event_id into v_event from public.tasks where id=v_task;

    update public.project_work_items
    set linked_task_id=v_task,
        linked_event_id=v_event,
        task_link_origin=coalesce(v_origin,'created'),
        sync_task=true,
        sync_calendar=(v_event is not null),
        updated_at=now()
    where id=v_id;
  else
    if v_task is not null then
      if v_origin='imported' then
        raise exception 'Imported Tasks cannot be detached from Projects & Chores';
      end if;

      update public.tasks
      set status='archived',archived_at=coalesce(archived_at,now()),updated_at=now()
      where id=v_task and household_id=p_household_id and status<>'done';

      update public.project_work_items
      set linked_task_id=null,task_link_origin=null
      where id=v_id;
      v_task:=null;
    end if;

    if p_sync_calendar then
      if v_event is not null then
        select calendar_id into v_calendar
        from public.calendar_events
        where id=v_event and household_id=p_household_id and deleted_at is null;
      end if;

      if v_calendar is null then
        select id into v_calendar
        from public.calendars
        where household_id=p_household_id and active
        order by is_default desc,name
        limit 1;
      end if;

      select timezone into v_timezone from public.households where id=p_household_id;

      v_event:=public.save_event_v1(
        v_event,p_household_id,v_calendar,trim(p_title),nullif(trim(p_notes),''),
        true,null,null,p_due_date,p_due_date,v_timezone,p_location_text,p_category_id,
        'household',v_participants,null,'[]'::jsonb
      );

      update public.project_work_items
      set linked_event_id=v_event,updated_at=now()
      where id=v_id;
    elsif v_event is not null then
      update public.calendar_events
      set deleted_at=now(),deleted_by_user_id=auth.uid(),updated_at=now()
      where id=v_event and household_id=p_household_id and deleted_at is null;

      update public.project_work_items
      set linked_event_id=null,updated_at=now()
      where id=v_id;
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_project_work_item_v2(
  uuid,uuid,uuid,text,text,uuid,date,text,uuid,text,boolean,boolean,text,text,text,text,uuid
) from public;

grant execute on function public.save_project_work_item_v2(
  uuid,uuid,uuid,text,text,uuid,date,text,uuid,text,boolean,boolean,text,text,text,text,uuid
) to authenticated;


-- ---------------------------------------------------------------------------
-- If a linked Task is completed/reopened elsewhere, keep Projects & Chores
-- status and points in sync. Only linked Projects & Chores work can award points.
-- ---------------------------------------------------------------------------

create or replace function public.sync_project_work_from_task_v1()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_work record;
  v_profile uuid;
begin
  for v_work in
    select pwi.id,pwi.household_id,pwi.assigned_profile_id,pwi.points
    from public.project_work_items pwi
    where pwi.linked_task_id=new.id
      and pwi.household_id=new.household_id
      and pwi.status<>'archived'
  loop
    if new.archived_at is not null or new.status='archived' then
      update public.project_work_items
      set status='archived',updated_at=now()
      where id=v_work.id;

      delete from public.family_points_ledger
      where source_work_item_id=v_work.id;
    elsif new.status='done' then
      v_profile:=coalesce(new.completed_by_profile_id,new.assigned_profile_id,v_work.assigned_profile_id);

      update public.project_work_items
      set title=new.title,
          category_id=new.category_id,
          due_date=new.due_date,
          location_text=new.location_text,
          assigned_profile_id=coalesce(new.assigned_profile_id,v_work.assigned_profile_id),
          linked_event_id=new.linked_event_id,
          status='done',
          completed_at=coalesce(new.completed_at,now()),
          completed_by_profile_id=v_profile,
          updated_at=now()
      where id=v_work.id;

      if v_profile is not null and v_work.points>0 then
        insert into public.family_points_ledger(
          household_id,profile_id,source_work_item_id,points,awarded_at
        )
        values(
          v_work.household_id,v_profile,v_work.id,v_work.points,coalesce(new.completed_at,now())
        )
        on conflict(source_work_item_id)
        do update set
          profile_id=excluded.profile_id,
          points=excluded.points,
          awarded_at=excluded.awarded_at;
      end if;
    else
      update public.project_work_items
      set title=new.title,
          category_id=new.category_id,
          due_date=new.due_date,
          location_text=new.location_text,
          assigned_profile_id=coalesce(new.assigned_profile_id,v_work.assigned_profile_id),
          linked_event_id=new.linked_event_id,
          status='open',
          completed_at=null,
          completed_by_profile_id=null,
          updated_at=now()
      where id=v_work.id;

      delete from public.family_points_ledger
      where source_work_item_id=v_work.id;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists task_project_work_sync on public.tasks;
create trigger task_project_work_sync
after update of
  title,category_id,due_date,location_text,assigned_profile_id,linked_event_id,
  status,completed_at,completed_by_profile_id,archived_at
on public.tasks
for each row
execute function public.sync_project_work_from_task_v1();


-- ---------------------------------------------------------------------------
-- Projects & Chores uses Categories, so expose it in Category availability.
-- ---------------------------------------------------------------------------

insert into public.module_category_availability(
  household_id,module_code,category_id,enabled,updated_at
)
select ec.household_id,'projects',ec.id,true,now()
from public.event_categories ec
where ec.active
on conflict(household_id,module_code,category_id) do nothing;
