-- Famioo migration 092
-- Family Inbox / Scan V1.
-- Scans are stored through existing Famioo Files; this layer stores extraction
-- and suggested Calendar / Task / File / School actions.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'inbox_scan',
  'Family Inbox / Scan',
  'Scan letters, flyers, invitations and school notices and turn them into useful family actions',
  'scan-line',
  44,
  true,
  true
)
on conflict(code) do update set
  name=excluded.name,
  description=excluded.description,
  icon_key=excluded.icon_key,
  sort_order=excluded.sort_order,
  is_core=true,
  is_active=true;

insert into public.module_role_permissions(household_id,module_code,role,access_level)
select h.id,'inbox_scan',r.role,'full'
from public.households h
cross join (values ('owner'::text),('admin'::text),('user'::text)) as r(role)
on conflict(household_id,module_code,role)
do update set access_level='full',updated_at=now();

create table if not exists public.family_inbox_items(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  file_id uuid not null references public.household_files(id) on delete cascade,
  source_kind text not null default 'upload' check(source_kind in ('camera','upload')),
  status text not null default 'new' check(status in ('new','reviewed','archived')),
  document_type text,
  title text,
  summary text,
  sender text,
  event_date date,
  deadline_date date,
  location_text text,
  confidence numeric(4,3) check(confidence is null or (confidence>=0 and confidence<=1)),
  extraction_json jsonb not null default '{}'::jsonb,
  extracted_at timestamptz,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(file_id)
);

create index if not exists family_inbox_items_household_idx
  on public.family_inbox_items(household_id,status,created_at desc);

create table if not exists public.family_inbox_actions(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  inbox_item_id uuid not null references public.family_inbox_items(id) on delete cascade,
  action_type text not null check(action_type in ('calendar','task','file','school')),
  title text not null check(length(trim(title)) between 1 and 200),
  action_date date,
  start_time time,
  end_time time,
  location_text text,
  notes text,
  file_category text check(file_category is null or file_category in ('document','photo','receipt','school','home','other')),
  status text not null default 'suggested' check(status in ('suggested','applied','dismissed')),
  result_id uuid,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  dismissed_at timestamptz
);

create index if not exists family_inbox_actions_item_idx
  on public.family_inbox_actions(inbox_item_id,status,action_type,created_at);

alter table public.family_inbox_items enable row level security;
alter table public.family_inbox_actions enable row level security;

drop policy if exists family_inbox_items_read on public.family_inbox_items;
create policy family_inbox_items_read on public.family_inbox_items for select to authenticated
using(private.has_module_access(household_id,'inbox_scan','read'));
drop policy if exists family_inbox_items_write on public.family_inbox_items;
create policy family_inbox_items_write on public.family_inbox_items for all to authenticated
using(private.has_module_access(household_id,'inbox_scan','full'))
with check(private.has_module_access(household_id,'inbox_scan','full'));

drop policy if exists family_inbox_actions_read on public.family_inbox_actions;
create policy family_inbox_actions_read on public.family_inbox_actions for select to authenticated
using(private.has_module_access(household_id,'inbox_scan','read'));
drop policy if exists family_inbox_actions_write on public.family_inbox_actions;
create policy family_inbox_actions_write on public.family_inbox_actions for all to authenticated
using(private.has_module_access(household_id,'inbox_scan','full'))
with check(private.has_module_access(household_id,'inbox_scan','full'));

grant select,insert,update,delete on public.family_inbox_items,public.family_inbox_actions to authenticated;

create or replace function public.create_family_inbox_item_v1(
  p_household_id uuid,
  p_file_id uuid,
  p_source_kind text default 'upload'
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'inbox_scan','full') then
    raise exception 'Family Inbox write access required';
  end if;
  if p_source_kind not in ('camera','upload') then raise exception 'Invalid source kind'; end if;

  if not exists(
    select 1 from public.household_files hf
    where hf.id=p_file_id and hf.household_id=p_household_id
      and hf.status='active' and hf.archived_at is null
  ) then raise exception 'File not found'; end if;

  insert into public.family_inbox_items(
    household_id,file_id,source_kind,created_by_user_id
  )
  values(p_household_id,p_file_id,p_source_kind,auth.uid())
  on conflict(file_id) do update set updated_at=now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.dismiss_family_inbox_action_v1(
  p_household_id uuid,
  p_action_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'inbox_scan','full') then
    raise exception 'Family Inbox write access required';
  end if;

  update public.family_inbox_actions
  set status='dismissed',dismissed_at=now()
  where id=p_action_id and household_id=p_household_id and status='suggested';

  return found;
end;
$$;

create or replace function public.apply_family_inbox_action_v1(
  p_household_id uuid,
  p_action_id uuid,
  p_child_profile_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_action public.family_inbox_actions%rowtype;
  v_item public.family_inbox_items%rowtype;
  v_file public.household_files%rowtype;
  v_calendar uuid;
  v_timezone text;
  v_result uuid;
  v_start timestamptz;
  v_end timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'inbox_scan','full') then
    raise exception 'Family Inbox write access required';
  end if;

  select * into v_action
  from public.family_inbox_actions
  where id=p_action_id and household_id=p_household_id
  for update;

  if not found then raise exception 'Suggested action not found'; end if;
  if v_action.status='applied' then return v_action.result_id; end if;
  if v_action.status<>'suggested' then raise exception 'Action is no longer available'; end if;

  select * into v_item from public.family_inbox_items
  where id=v_action.inbox_item_id and household_id=p_household_id;

  if v_action.action_type='calendar' then
    if not private.has_module_access(p_household_id,'calendar','full') then
      raise exception 'Calendar write access required';
    end if;

    select id into v_calendar from public.calendars
    where household_id=p_household_id and active
    order by is_default desc,name limit 1;
    if v_calendar is null then raise exception 'No active calendar found'; end if;

    select timezone into v_timezone from public.households where id=p_household_id;

    if v_action.action_date is null then raise exception 'Calendar suggestion needs a date'; end if;

    if v_action.start_time is not null then
      v_start := (v_action.action_date::timestamp + v_action.start_time) at time zone v_timezone;
      if v_action.end_time is not null then
        v_end := (v_action.action_date::timestamp + v_action.end_time) at time zone v_timezone;
      else
        v_end := v_start + interval '1 hour';
      end if;
    end if;

    v_result:=public.save_event_v1(
      null,p_household_id,v_calendar,v_action.title,v_action.notes,
      v_action.start_time is null,
      v_start,v_end,
      case when v_action.start_time is null then v_action.action_date else null end,
      case when v_action.start_time is null then v_action.action_date else null end,
      v_timezone,v_action.location_text,null,'household','[]'::jsonb,null,'[]'::jsonb
    );

  elsif v_action.action_type='task' then
    if not private.has_module_access(p_household_id,'tasks','full') then
      raise exception 'Tasks write access required';
    end if;

    insert into public.tasks(
      household_id,title,description,status,priority,due_date,location_text,created_by_user_id
    )
    values(
      p_household_id,v_action.title,v_action.notes,'open','normal',
      v_action.action_date,v_action.location_text,auth.uid()
    )
    returning id into v_result;

  elsif v_action.action_type='school' then
    if not private.has_module_access(p_household_id,'school','full') then
      raise exception 'School & Kita write access required';
    end if;
    if v_action.action_date is null then raise exception 'School suggestion needs a date'; end if;

    if p_child_profile_id is not null and not exists(
      select 1 from public.family_profiles fp
      where fp.id=p_child_profile_id and fp.household_id=p_household_id
        and fp.active and fp.profile_type in ('child','profile_only')
    ) then raise exception 'Child profile not found'; end if;

    v_result:=public.save_school_entry_v2(
      null,p_household_id,v_action.title,null,p_child_profile_id,
      v_action.action_date,v_action.start_time is null,
      v_action.start_time,v_action.end_time,v_action.location_text,v_action.notes,
      true,false
    );

  elsif v_action.action_type='file' then
    if not private.has_module_access(p_household_id,'files','full') then
      raise exception 'Files write access required';
    end if;

    select * into v_file from public.household_files
    where id=v_item.file_id and household_id=p_household_id
    for update;

    update public.household_files
    set title=v_action.title,
        category=coalesce(v_action.file_category,category),
        notes=coalesce(v_action.notes,notes),
        source_module='inbox_scan',
        source_record_id=v_item.id,
        updated_at=now()
    where id=v_file.id;

    v_result:=v_file.id;
  else
    raise exception 'Unsupported action type';
  end if;

  update public.family_inbox_actions
  set status='applied',result_id=v_result,applied_at=now()
  where id=v_action.id;

  update public.family_inbox_items
  set status='reviewed',updated_at=now()
  where id=v_item.id;

  return v_result;
end;
$$;

revoke all on function public.create_family_inbox_item_v1(uuid,uuid,text) from public,anon;
revoke all on function public.dismiss_family_inbox_action_v1(uuid,uuid) from public,anon;
revoke all on function public.apply_family_inbox_action_v1(uuid,uuid,uuid) from public,anon;
grant execute on function public.create_family_inbox_item_v1(uuid,uuid,text) to authenticated;
grant execute on function public.dismiss_family_inbox_action_v1(uuid,uuid) to authenticated;
grant execute on function public.apply_family_inbox_action_v1(uuid,uuid,uuid) to authenticated;
