-- Famioo migration 033
-- Configurable module types, Life Admin finance/task integration,
-- and Projects & Chores with family points.

-- ---------------------------------------------------------------------------
-- Configurable types
-- ---------------------------------------------------------------------------

create table if not exists public.household_module_types (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  module_code text not null references public.modules(code) on delete cascade,
  group_code text not null,
  type_key text not null,
  label text not null,
  base_type text,
  sort_order integer not null default 0,
  active boolean not null default true,
  is_default boolean not null default false,
  created_by_user_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint household_module_types_group_check check (length(trim(group_code)) between 1 and 60),
  constraint household_module_types_key_check check (length(trim(type_key)) between 1 and 120),
  constraint household_module_types_label_check check (length(trim(label)) between 1 and 120)
);

create unique index if not exists household_module_types_key_uidx
  on public.household_module_types(household_id,module_code,group_code,lower(type_key));

create index if not exists household_module_types_lookup_idx
  on public.household_module_types(household_id,module_code,group_code,active,sort_order);

alter table public.household_module_types enable row level security;

drop policy if exists household_module_types_select on public.household_module_types;
create policy household_module_types_select
on public.household_module_types for select to authenticated
using (
  exists(
    select 1 from public.household_members hm
    where hm.household_id=household_module_types.household_id
      and hm.user_id=auth.uid()
      and hm.status='active'
  )
);

drop policy if exists household_module_types_insert on public.household_module_types;
create policy household_module_types_insert
on public.household_module_types for insert to authenticated
with check (
  exists(
    select 1 from public.household_members hm
    where hm.household_id=household_module_types.household_id
      and hm.user_id=auth.uid()
      and hm.status='active'
      and hm.role in ('owner','admin')
  )
);

drop policy if exists household_module_types_update on public.household_module_types;
create policy household_module_types_update
on public.household_module_types for update to authenticated
using (
  exists(
    select 1 from public.household_members hm
    where hm.household_id=household_module_types.household_id
      and hm.user_id=auth.uid()
      and hm.status='active'
      and hm.role in ('owner','admin')
  )
)
with check (
  exists(
    select 1 from public.household_members hm
    where hm.household_id=household_module_types.household_id
      and hm.user_id=auth.uid()
      and hm.status='active'
      and hm.role in ('owner','admin')
  )
);

grant select,insert,update on public.household_module_types to authenticated;

insert into public.household_module_types(
  household_id,module_code,group_code,type_key,label,base_type,sort_order,active,is_default,created_by_user_id
)
select h.id,'home_care','asset_type',v.type_key,v.label,null,v.sort_order,true,true,null
from public.households h
cross join (values
  ('Appliance','Appliance',10),
  ('Heating','Heating',20),
  ('Electronics','Electronics',30),
  ('Furniture','Furniture',40),
  ('Garden','Garden',50),
  ('Vehicle','Vehicle',60),
  ('Safety','Safety',70),
  ('Plumbing','Plumbing',80),
  ('Other','Other',90)
) as v(type_key,label,sort_order)
on conflict do nothing;

insert into public.household_module_types(
  household_id,module_code,group_code,type_key,label,base_type,sort_order,active,is_default,created_by_user_id
)
select h.id,'life_admin','item_type',v.type_key,v.label,v.base_type,v.sort_order,true,true,null
from public.households h
cross join (values
  ('document','Document','document',10),
  ('contract','Contract','contract',20),
  ('insurance','Insurance','insurance',30),
  ('subscription','Subscription','subscription',40),
  ('deadline','Deadline','deadline',50)
) as v(type_key,label,base_type,sort_order)
on conflict do nothing;

create or replace function public.save_household_module_type_v1(
  p_household_id uuid,
  p_module_code text,
  p_group_code text,
  p_label text,
  p_base_type text default null
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
    household_id,module_code,group_code,type_key,label,base_type,sort_order,active,is_default,created_by_user_id
  )
  values(
    p_household_id,p_module_code,p_group_code,v_key,trim(p_label),
    case when p_module_code='life_admin' then p_base_type else null end,
    v_sort,true,false,auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.save_household_module_type_v1(uuid,text,text,text,text) from public;
grant execute on function public.save_household_module_type_v1(uuid,text,text,text,text) to authenticated;

create or replace function public.set_household_module_type_active_v1(
  p_id uuid,
  p_household_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
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

  update public.household_module_types
  set active=coalesce(p_active,false),updated_at=now()
  where id=p_id and household_id=p_household_id;

  if not found then raise exception 'Type not found'; end if;
end;
$$;

revoke all on function public.set_household_module_type_active_v1(uuid,uuid,boolean) from public;
grant execute on function public.set_household_module_type_active_v1(uuid,uuid,boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- Household finance directions and richer recurring intervals
-- ---------------------------------------------------------------------------

alter table public.household_costs
  add column if not exists flow_type text not null default 'expense',
  add column if not exists schedule_interval_months smallint not null default 1,
  add column if not exists source_life_admin_item_id uuid references public.life_admin_items(id) on delete set null;

alter table public.household_costs
  drop constraint if exists household_costs_flow_type_check;
alter table public.household_costs
  add constraint household_costs_flow_type_check
  check (flow_type in ('expense','income'));

alter table public.household_costs
  drop constraint if exists household_costs_schedule_interval_months_check;
alter table public.household_costs
  add constraint household_costs_schedule_interval_months_check
  check (schedule_interval_months between 1 and 120);

alter table public.household_costs
  drop constraint if exists household_costs_source_type_check;
alter table public.household_costs
  add constraint household_costs_source_type_check
  check (source_type in ('manual','shopping','task','home_care','life_admin','projects'));

create unique index if not exists household_costs_life_admin_item_uidx
  on public.household_costs(source_life_admin_item_id)
  where source_life_admin_item_id is not null;


-- ---------------------------------------------------------------------------
-- Life Admin: configurable types + expense/income + finance + Tasks
-- ---------------------------------------------------------------------------

alter table public.life_admin_items
  drop constraint if exists life_admin_items_type_check;

alter table public.life_admin_items
  add column if not exists flow_type text not null default 'expense',
  add column if not exists include_in_finance boolean not null default false,
  add column if not exists household_cost_id uuid references public.household_costs(id) on delete set null,
  add column if not exists sync_task boolean not null default false,
  add column if not exists linked_task_id uuid references public.tasks(id) on delete set null;

alter table public.life_admin_items
  drop constraint if exists life_admin_items_flow_type_check;
alter table public.life_admin_items
  add constraint life_admin_items_flow_type_check
  check (flow_type in ('expense','income'));

create or replace function public.save_life_admin_item_v2(
  p_id uuid,
  p_household_id uuid,
  p_item_type text,
  p_title text,
  p_provider text,
  p_reference_number text,
  p_start_date date,
  p_due_date date,
  p_renewal_date date,
  p_expiry_date date,
  p_amount numeric,
  p_currency text,
  p_frequency text,
  p_auto_renew boolean,
  p_cancellation_notice_days smallint,
  p_responsible_profile_id uuid,
  p_notes text,
  p_add_to_calendar boolean,
  p_flow_type text,
  p_include_in_finance boolean,
  p_sync_task boolean
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_id uuid;
  v_event_id uuid;
  v_task_id uuid;
  v_cost_id uuid;
  v_calendar_id uuid;
  v_action_date date;
  v_event_title text;
  v_description text;
  v_timezone text;
  v_participants jsonb:='[]'::jsonb;
  v_schedule text;
  v_interval smallint:=1;
  v_category uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  if not private.has_module_access(p_household_id,'life_admin','full') then
    raise exception 'Life Admin write access required';
  end if;

  if not exists(
    select 1 from public.household_module_types t
    where t.household_id=p_household_id
      and t.module_code='life_admin'
      and t.group_code='item_type'
      and t.type_key=p_item_type
      and t.active
  ) then
    raise exception 'Choose an active Life Admin type';
  end if;

  if nullif(trim(p_title),'') is null then raise exception 'Title is required'; end if;
  if p_amount is not null and p_amount < 0 then raise exception 'Amount cannot be negative'; end if;
  if p_frequency not in ('none','monthly','quarterly','yearly') then raise exception 'Invalid frequency'; end if;
  if p_flow_type not in ('expense','income') then raise exception 'Choose cost or income'; end if;

  if p_cancellation_notice_days is not null
     and (p_cancellation_notice_days < 0 or p_cancellation_notice_days > 3650)
  then raise exception 'Cancellation notice must be between 0 and 3650 days'; end if;

  if p_responsible_profile_id is not null and not exists(
    select 1 from public.family_profiles
    where id=p_responsible_profile_id and household_id=p_household_id and active
  ) then raise exception 'Responsible household member not found'; end if;

  v_action_date:=coalesce(p_due_date,p_renewal_date,p_expiry_date,p_start_date);

  if p_add_to_calendar and v_action_date is null then
    raise exception 'Add a due, renewal, expiry or start date before adding this item to Calendar';
  end if;

  if p_add_to_calendar and not private.has_module_access(p_household_id,'calendar','full') then
    raise exception 'Calendar write access required';
  end if;

  if p_sync_task and not private.has_module_access(p_household_id,'tasks','full') then
    raise exception 'Tasks write access required';
  end if;

  if p_include_in_finance then
    if p_amount is null or p_amount <= 0 then
      raise exception 'Enter an amount before adding this item to Household Costs';
    end if;
    if not private.has_module_access(p_household_id,'costs','full') then
      raise exception 'Household Costs write access required';
    end if;
  end if;

  if p_id is null then
    insert into public.life_admin_items(
      household_id,item_type,title,provider,reference_number,start_date,due_date,
      renewal_date,expiry_date,amount,currency,frequency,auto_renew,
      cancellation_notice_days,responsible_profile_id,notes,add_to_calendar,
      flow_type,include_in_finance,sync_task,created_by_user_id
    )
    values(
      p_household_id,p_item_type,trim(p_title),nullif(trim(p_provider),''),
      nullif(trim(p_reference_number),''),p_start_date,p_due_date,p_renewal_date,
      p_expiry_date,p_amount,coalesce(nullif(trim(p_currency),''),'EUR'),
      p_frequency,coalesce(p_auto_renew,false),p_cancellation_notice_days,
      p_responsible_profile_id,nullif(trim(p_notes),''),
      coalesce(p_add_to_calendar,false),p_flow_type,
      coalesce(p_include_in_finance,false),coalesce(p_sync_task,false),auth.uid()
    )
    returning id into v_id;
  else
    select id,linked_event_id,linked_task_id,household_cost_id
      into v_id,v_event_id,v_task_id,v_cost_id
    from public.life_admin_items
    where id=p_id and household_id=p_household_id and status='active'
    for update;

    if v_id is null then raise exception 'Life Admin item not found'; end if;

    update public.life_admin_items
    set item_type=p_item_type,
        title=trim(p_title),
        provider=nullif(trim(p_provider),''),
        reference_number=nullif(trim(p_reference_number),''),
        start_date=p_start_date,
        due_date=p_due_date,
        renewal_date=p_renewal_date,
        expiry_date=p_expiry_date,
        amount=p_amount,
        currency=coalesce(nullif(trim(p_currency),''),'EUR'),
        frequency=p_frequency,
        auto_renew=coalesce(p_auto_renew,false),
        cancellation_notice_days=p_cancellation_notice_days,
        responsible_profile_id=p_responsible_profile_id,
        notes=nullif(trim(p_notes),''),
        add_to_calendar=coalesce(p_add_to_calendar,false),
        flow_type=p_flow_type,
        include_in_finance=coalesce(p_include_in_finance,false),
        sync_task=coalesce(p_sync_task,false),
        updated_at=now()
    where id=v_id;
  end if;

  if p_responsible_profile_id is not null then
    v_participants:=jsonb_build_array(jsonb_build_object('profile_id',p_responsible_profile_id));
  end if;

  v_category:=private.life_admin_category_id(p_household_id);

  if p_add_to_calendar then
    if v_event_id is not null then
      select calendar_id into v_calendar_id
      from public.calendar_events
      where id=v_event_id and household_id=p_household_id and deleted_at is null;
    end if;

    if v_calendar_id is null then
      select id into v_calendar_id
      from public.calendars
      where household_id=p_household_id and active
      order by is_default desc,name
      limit 1;
    end if;

    if v_calendar_id is null then raise exception 'No active calendar found'; end if;

    select timezone into v_timezone from public.households where id=p_household_id;

    v_event_title:='Life Admin: '||trim(p_title);
    v_description:=concat_ws(
      E'\n',
      case when nullif(trim(p_provider),'') is not null then 'Provider: '||trim(p_provider) end,
      case when nullif(trim(p_reference_number),'') is not null then 'Reference: '||trim(p_reference_number) end,
      nullif(trim(p_notes),'')
    );

    v_event_id:=public.save_event_v1(
      v_event_id,p_household_id,v_calendar_id,v_event_title,nullif(v_description,''),
      true,null,null,v_action_date,v_action_date,v_timezone,null,v_category,
      'household',v_participants,null,'[]'::jsonb
    );

    update public.life_admin_items
    set linked_event_id=v_event_id,updated_at=now()
    where id=v_id;
  elsif v_event_id is not null then
    update public.calendar_events
    set deleted_at=now(),deleted_by_user_id=auth.uid(),updated_at=now()
    where id=v_event_id and household_id=p_household_id and deleted_at is null;

    update public.life_admin_items
    set linked_event_id=null,updated_at=now()
    where id=v_id;
    v_event_id:=null;
  end if;

  if p_sync_task then
    if v_task_id is null then
      v_task_id:=public.create_task_v1(
        p_household_id,
        trim(p_title),
        v_category,
        v_action_date,
        null,
        v_participants,
        false,
        false
      );
    else
      perform public.update_task_v1(
        v_task_id,
        p_household_id,
        trim(p_title),
        v_category,
        v_action_date,
        null,
        v_participants,
        false
      );
    end if;

    update public.life_admin_items
    set linked_task_id=v_task_id,updated_at=now()
    where id=v_id;
  elsif v_task_id is not null then
    update public.tasks
    set status='archived',archived_at=coalesce(archived_at,now()),updated_at=now()
    where id=v_task_id and household_id=p_household_id and status<>'done';

    update public.life_admin_items
    set linked_task_id=null,updated_at=now()
    where id=v_id;
    v_task_id:=null;
  end if;

  if p_include_in_finance then
    if p_frequency='monthly' then
      v_schedule:='scheduled'; v_interval:=1;
    elsif p_frequency='quarterly' then
      v_schedule:='scheduled'; v_interval:=3;
    elsif p_frequency='yearly' then
      v_schedule:='scheduled'; v_interval:=12;
    else
      v_schedule:='one_time'; v_interval:=1;
    end if;

    if v_cost_id is null then
      select id into v_cost_id
      from public.household_costs
      where household_id=p_household_id
        and source_life_admin_item_id=v_id
      limit 1;
    end if;

    if v_cost_id is null then
      insert into public.household_costs(
        household_id,title,amount,currency,cost_date,cost_kind,source_type,
        schedule_type,schedule_day,schedule_interval_months,flow_type,
        source_life_admin_item_id,notes,created_by_user_id
      )
      values(
        p_household_id,
        'Life Admin: '||trim(p_title),
        p_amount,
        coalesce(nullif(trim(p_currency),''),'EUR'),
        coalesce(v_action_date,current_date),
        case when v_schedule='scheduled' then 'regular' else 'additional' end,
        'life_admin',
        v_schedule,
        case when v_schedule='scheduled' then extract(day from coalesce(v_action_date,current_date))::smallint else null end,
        v_interval,
        p_flow_type,
        v_id,
        'Linked from Life Admin',
        auth.uid()
      )
      returning id into v_cost_id;
    else
      update public.household_costs
      set title='Life Admin: '||trim(p_title),
          amount=p_amount,
          currency=coalesce(nullif(trim(p_currency),''),'EUR'),
          cost_date=coalesce(v_action_date,current_date),
          cost_kind=case when v_schedule='scheduled' then 'regular' else 'additional' end,
          source_type='life_admin',
          schedule_type=v_schedule,
          schedule_day=case when v_schedule='scheduled' then extract(day from coalesce(v_action_date,current_date))::smallint else null end,
          schedule_interval_months=v_interval,
          flow_type=p_flow_type,
          source_life_admin_item_id=v_id,
          notes='Linked from Life Admin',
          updated_at=now()
      where id=v_cost_id and household_id=p_household_id;
    end if;

    update public.life_admin_items
    set household_cost_id=v_cost_id,updated_at=now()
    where id=v_id;
  elsif v_cost_id is not null then
    if not private.has_module_access(p_household_id,'costs','full') then
      raise exception 'Household Costs write access required to remove the linked finance entry';
    end if;

    delete from public.household_costs
    where id=v_cost_id and household_id=p_household_id;

    update public.life_admin_items
    set household_cost_id=null,updated_at=now()
    where id=v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_life_admin_item_v2(
  uuid,uuid,text,text,text,text,date,date,date,date,numeric,text,text,boolean,smallint,uuid,text,boolean,text,boolean,boolean
) from public;

grant execute on function public.save_life_admin_item_v2(
  uuid,uuid,text,text,text,text,date,date,date,date,numeric,text,text,boolean,smallint,uuid,text,boolean,text,boolean,boolean
) to authenticated;


-- ---------------------------------------------------------------------------
-- Projects & Chores
-- ---------------------------------------------------------------------------

create table if not exists public.household_projects (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  description text,
  category_id uuid references public.event_categories(id) on delete set null,
  start_date date,
  due_date date,
  owner_profile_id uuid,
  status text not null default 'active',
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint household_projects_title_check check (length(trim(title)) between 1 and 180),
  constraint household_projects_status_check check (status in ('active','completed','archived')),
  constraint household_projects_owner_fk
    foreign key(household_id,owner_profile_id)
    references public.family_profiles(household_id,id)
);

create index if not exists household_projects_household_idx
  on public.household_projects(household_id,status,due_date);

alter table public.household_projects enable row level security;

drop policy if exists household_projects_select on public.household_projects;
create policy household_projects_select
on public.household_projects for select to authenticated
using (private.has_module_access(household_id,'projects','read'));

drop policy if exists household_projects_insert on public.household_projects;
create policy household_projects_insert
on public.household_projects for insert to authenticated
with check (private.has_module_access(household_id,'projects','full'));

drop policy if exists household_projects_update on public.household_projects;
create policy household_projects_update
on public.household_projects for update to authenticated
using (private.has_module_access(household_id,'projects','full'))
with check (private.has_module_access(household_id,'projects','full'));

grant select,insert,update on public.household_projects to authenticated;


create table if not exists public.project_work_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  project_id uuid references public.household_projects(id) on delete cascade,
  item_kind text not null default 'chore',
  title text not null,
  category_id uuid references public.event_categories(id) on delete set null,
  due_date date,
  location_text text,
  assigned_profile_id uuid,
  points smallint not null default 0,
  notes text,
  sync_task boolean not null default true,
  sync_calendar boolean not null default false,
  linked_task_id uuid references public.tasks(id) on delete set null,
  linked_event_id uuid references public.calendar_events(id) on delete set null,
  status text not null default 'open',
  completed_at timestamptz,
  completed_by_profile_id uuid,
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_work_items_kind_check check (item_kind in ('project_task','chore')),
  constraint project_work_items_title_check check (length(trim(title)) between 1 and 200),
  constraint project_work_items_points_check check (points between 0 and 10000),
  constraint project_work_items_status_check check (status in ('open','done','archived')),
  constraint project_work_items_assigned_fk
    foreign key(household_id,assigned_profile_id)
    references public.family_profiles(household_id,id),
  constraint project_work_items_completed_fk
    foreign key(household_id,completed_by_profile_id)
    references public.family_profiles(household_id,id)
);

create index if not exists project_work_items_household_idx
  on public.project_work_items(household_id,status,item_kind,due_date);

create index if not exists project_work_items_project_idx
  on public.project_work_items(project_id,status,due_date);

alter table public.project_work_items enable row level security;

drop policy if exists project_work_items_select on public.project_work_items;
create policy project_work_items_select
on public.project_work_items for select to authenticated
using (private.has_module_access(household_id,'projects','read'));

drop policy if exists project_work_items_insert on public.project_work_items;
create policy project_work_items_insert
on public.project_work_items for insert to authenticated
with check (private.has_module_access(household_id,'projects','full'));

drop policy if exists project_work_items_update on public.project_work_items;
create policy project_work_items_update
on public.project_work_items for update to authenticated
using (private.has_module_access(household_id,'projects','full'))
with check (private.has_module_access(household_id,'projects','full'));

grant select,insert,update on public.project_work_items to authenticated;


create table if not exists public.family_points_ledger (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  profile_id uuid not null,
  source_work_item_id uuid not null references public.project_work_items(id) on delete cascade,
  points smallint not null,
  awarded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint family_points_ledger_points_check check (points >= 0),
  constraint family_points_ledger_profile_fk
    foreign key(household_id,profile_id)
    references public.family_profiles(household_id,id),
  unique(source_work_item_id)
);

create index if not exists family_points_ledger_household_idx
  on public.family_points_ledger(household_id,awarded_at desc);

alter table public.family_points_ledger enable row level security;

drop policy if exists family_points_ledger_select on public.family_points_ledger;
create policy family_points_ledger_select
on public.family_points_ledger for select to authenticated
using (private.has_module_access(household_id,'projects','read'));

grant select on public.family_points_ledger to authenticated;


insert into public.event_categories(
  household_id,name,color_key,icon_key,sort_order,is_system,active,created_by_user_id
)
select
  h.id,
  'Projects & Chores',
  'indigo',
  'projects-default',
  coalesce((select max(ec.sort_order) from public.event_categories ec where ec.household_id=h.id),0)+10,
  true,
  true,
  null
from public.households h
where not exists(
  select 1 from public.event_categories ec
  where ec.household_id=h.id
    and lower(ec.name)='projects & chores'
    and ec.active
);

insert into public.module_category_availability(
  household_id,module_code,category_id,enabled,updated_at
)
select ec.household_id,m.code,ec.id,true,now()
from public.event_categories ec
cross join (values ('calendar'),('tasks')) as m(code)
where ec.active
  and lower(ec.name)='projects & chores'
on conflict(household_id,module_code,category_id)
do update set enabled=excluded.enabled,updated_at=now();


create or replace function public.save_household_project_v1(
  p_id uuid,
  p_household_id uuid,
  p_title text,
  p_description text,
  p_category_id uuid,
  p_start_date date,
  p_due_date date,
  p_owner_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'projects','full') then
    raise exception 'Projects & Chores write access required';
  end if;
  if nullif(trim(p_title),'') is null then raise exception 'Project name is required'; end if;

  if p_category_id is not null and not exists(
    select 1 from public.event_categories
    where id=p_category_id and household_id=p_household_id and active
  ) then raise exception 'Invalid project category'; end if;

  if p_owner_profile_id is not null and not exists(
    select 1 from public.family_profiles
    where id=p_owner_profile_id and household_id=p_household_id and active
  ) then raise exception 'Project owner not found'; end if;

  if p_id is null then
    insert into public.household_projects(
      household_id,title,description,category_id,start_date,due_date,owner_profile_id,created_by_user_id
    )
    values(
      p_household_id,trim(p_title),nullif(trim(p_description),''),
      p_category_id,p_start_date,p_due_date,p_owner_profile_id,auth.uid()
    )
    returning id into v_id;
  else
    update public.household_projects
    set title=trim(p_title),
        description=nullif(trim(p_description),''),
        category_id=p_category_id,
        start_date=p_start_date,
        due_date=p_due_date,
        owner_profile_id=p_owner_profile_id,
        updated_at=now()
    where id=p_id and household_id=p_household_id and status='active'
    returning id into v_id;

    if v_id is null then raise exception 'Project not found'; end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_household_project_v1(uuid,uuid,text,text,uuid,date,date,uuid) from public;
grant execute on function public.save_household_project_v1(uuid,uuid,text,text,uuid,date,date,uuid) to authenticated;


create or replace function public.save_project_work_item_v1(
  p_id uuid,
  p_household_id uuid,
  p_project_id uuid,
  p_item_kind text,
  p_title text,
  p_category_id uuid,
  p_due_date date,
  p_location_text text,
  p_assigned_profile_id uuid,
  p_points smallint,
  p_notes text,
  p_sync_task boolean,
  p_sync_calendar boolean
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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'projects','full') then
    raise exception 'Projects & Chores write access required';
  end if;

  if p_item_kind not in ('project_task','chore') then raise exception 'Invalid responsibility type'; end if;
  if nullif(trim(p_title),'') is null then raise exception 'Name is required'; end if;
  if coalesce(p_points,0) < 0 or coalesce(p_points,0) > 10000 then raise exception 'Points must be between 0 and 10000'; end if;

  if p_project_id is not null and not exists(
    select 1 from public.household_projects
    where id=p_project_id and household_id=p_household_id and status='active'
  ) then raise exception 'Project not found'; end if;

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
      assigned_profile_id,points,notes,sync_task,sync_calendar,created_by_user_id
    )
    values(
      p_household_id,p_project_id,p_item_kind,trim(p_title),p_category_id,p_due_date,
      nullif(trim(p_location_text),''),p_assigned_profile_id,coalesce(p_points,0),
      nullif(trim(p_notes),''),coalesce(p_sync_task,false),coalesce(p_sync_calendar,false),auth.uid()
    )
    returning id into v_id;
  else
    select id,linked_task_id,linked_event_id
      into v_id,v_task,v_event
    from public.project_work_items
    where id=p_id and household_id=p_household_id and status='open'
    for update;

    if v_id is null then raise exception 'Responsibility not found'; end if;

    update public.project_work_items
    set project_id=p_project_id,
        item_kind=p_item_kind,
        title=trim(p_title),
        category_id=p_category_id,
        due_date=p_due_date,
        location_text=nullif(trim(p_location_text),''),
        assigned_profile_id=p_assigned_profile_id,
        points=coalesce(p_points,0),
        notes=nullif(trim(p_notes),''),
        sync_task=coalesce(p_sync_task,false),
        sync_calendar=coalesce(p_sync_calendar,false),
        updated_at=now()
    where id=v_id;
  end if;

  if p_sync_task then
    if v_task is null then
      v_task:=public.create_task_v1(
        p_household_id,trim(p_title),p_category_id,p_due_date,p_location_text,
        v_participants,p_sync_calendar,false
      );
    else
      perform public.update_task_v1(
        v_task,p_household_id,trim(p_title),p_category_id,p_due_date,p_location_text,
        v_participants,p_sync_calendar
      );
    end if;

    select linked_event_id into v_event from public.tasks where id=v_task;

    update public.project_work_items
    set linked_task_id=v_task,linked_event_id=v_event,updated_at=now()
    where id=v_id;
  else
    if v_task is not null then
      update public.tasks
      set status='archived',archived_at=coalesce(archived_at,now()),updated_at=now()
      where id=v_task and household_id=p_household_id and status<>'done';

      update public.project_work_items set linked_task_id=null where id=v_id;
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

revoke all on function public.save_project_work_item_v1(
  uuid,uuid,uuid,text,text,uuid,date,text,uuid,smallint,text,boolean,boolean
) from public;

grant execute on function public.save_project_work_item_v1(
  uuid,uuid,uuid,text,text,uuid,date,text,uuid,smallint,text,boolean,boolean
) to authenticated;


create or replace function public.set_project_work_item_done_v1(
  p_id uuid,
  p_household_id uuid,
  p_done boolean
)
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_item public.project_work_items%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'projects','full') then
    raise exception 'Projects & Chores write access required';
  end if;

  select * into v_item
  from public.project_work_items
  where id=p_id and household_id=p_household_id
  for update;

  if not found then raise exception 'Responsibility not found'; end if;

  if p_done then
    update public.project_work_items
    set status='done',
        completed_at=coalesce(completed_at,now()),
        completed_by_profile_id=coalesce(completed_by_profile_id,assigned_profile_id),
        updated_at=now()
    where id=p_id;

    if v_item.linked_task_id is not null then
      update public.tasks
      set status='done',
          completed_at=coalesce(completed_at,now()),
          completed_by_profile_id=coalesce(completed_by_profile_id,v_item.assigned_profile_id),
          updated_at=now()
      where id=v_item.linked_task_id
        and household_id=p_household_id
        and archived_at is null;
    end if;

    if v_item.assigned_profile_id is not null and v_item.points > 0 then
      insert into public.family_points_ledger(
        household_id,profile_id,source_work_item_id,points,awarded_at
      )
      values(
        p_household_id,v_item.assigned_profile_id,p_id,v_item.points,now()
      )
      on conflict(source_work_item_id)
      do update set
        profile_id=excluded.profile_id,
        points=excluded.points,
        awarded_at=excluded.awarded_at;
    end if;
  else
    update public.project_work_items
    set status='open',
        completed_at=null,
        completed_by_profile_id=null,
        updated_at=now()
    where id=p_id;

    delete from public.family_points_ledger
    where source_work_item_id=p_id and household_id=p_household_id;

    if v_item.linked_task_id is not null then
      update public.tasks
      set status='open',
          completed_at=null,
          completed_by_profile_id=null,
          updated_at=now()
      where id=v_item.linked_task_id
        and household_id=p_household_id
        and archived_at is null;
    end if;
  end if;
end;
$$;

revoke all on function public.set_project_work_item_done_v1(uuid,uuid,boolean) from public;
grant execute on function public.set_project_work_item_done_v1(uuid,uuid,boolean) to authenticated;


-- Enable Projects & Chores for the existing household used during the current build.
update public.household_modules
set enabled=true,
    source='admin',
    enabled_at=coalesce(enabled_at,now()),
    updated_at=now()
where household_id='7dc78248-8600-4d66-b42d-0179c6cc7028'::uuid
  and module_code='projects';
