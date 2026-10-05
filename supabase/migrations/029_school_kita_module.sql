-- Famioo migration 029
-- First functional School & Kita module: entries, category availability, calendar links and attachments.

create table if not exists public.school_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  category_id uuid references public.event_categories(id) on delete set null,
  child_profile_id uuid references public.family_profiles(id) on delete set null,
  entry_date date not null,
  all_day boolean not null default true,
  start_time time,
  end_time time,
  location_text text,
  notes text,
  linked_event_id uuid references public.calendar_events(id) on delete set null,
  status text not null default 'active',
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_entries_title_check check (length(trim(title)) between 1 and 160),
  constraint school_entries_status_check check (status in ('active','archived'))
);

create index if not exists school_entries_household_date_idx
  on public.school_entries(household_id,entry_date,status);

create index if not exists school_entries_child_date_idx
  on public.school_entries(household_id,child_profile_id,entry_date)
  where status='active';

alter table public.school_entries enable row level security;

drop policy if exists school_entries_select on public.school_entries;
create policy school_entries_select
on public.school_entries for select to authenticated
using (private.has_module_access(household_id,'school','read'));

drop policy if exists school_entries_insert on public.school_entries;
create policy school_entries_insert
on public.school_entries for insert to authenticated
with check (private.has_module_access(household_id,'school','full'));

drop policy if exists school_entries_update on public.school_entries;
create policy school_entries_update
on public.school_entries for update to authenticated
using (private.has_module_access(household_id,'school','full'))
with check (private.has_module_access(household_id,'school','full'));

drop policy if exists school_entries_delete on public.school_entries;
create policy school_entries_delete
on public.school_entries for delete to authenticated
using (private.has_module_access(household_id,'school','full'));

grant select,insert,update,delete on public.school_entries to authenticated;

create table if not exists public.school_attachments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  school_entry_id uuid not null references public.school_entries(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_size bigint,
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists school_attachments_entry_idx
  on public.school_attachments(school_entry_id,created_at);

alter table public.school_attachments enable row level security;

drop policy if exists school_attachments_select on public.school_attachments;
create policy school_attachments_select
on public.school_attachments for select to authenticated
using (private.has_module_access(household_id,'school','read'));

drop policy if exists school_attachments_insert on public.school_attachments;
create policy school_attachments_insert
on public.school_attachments for insert to authenticated
with check (private.has_module_access(household_id,'school','full'));

drop policy if exists school_attachments_delete on public.school_attachments;
create policy school_attachments_delete
on public.school_attachments for delete to authenticated
using (private.has_module_access(household_id,'school','full'));

grant select,insert,delete on public.school_attachments to authenticated;

-- School-specific defaults live in the shared category library but are only enabled
-- for School & Kita by default. Existing same-name user categories are preserved.
with household_rows as (
  select id as household_id from public.households
),
defaults(name,color_key,sort_offset) as (
  values
    ('School','blue',10),
    ('Kita','green',20),
    ('Appointments','pink',30),
    ('Kids','orange',40)
)
insert into public.event_categories(
  household_id,name,color_key,icon_key,sort_order,is_system,created_by_user_id
)
select
  h.household_id,
  d.name,
  d.color_key,
  'school-default',
  coalesce((select max(ec.sort_order) from public.event_categories ec where ec.household_id=h.household_id),0)+d.sort_offset,
  true,
  null
from household_rows h
cross join defaults d
where not exists(
  select 1
  from public.event_categories ec
  where ec.household_id=h.household_id
    and lower(ec.name)=lower(d.name)
    and ec.active
);

insert into public.module_category_availability(
  household_id,module_code,category_id,enabled,updated_at
)
select ec.household_id,'school',ec.id,false,now()
from public.event_categories ec
where ec.active
on conflict(household_id,module_code,category_id)
do nothing;

insert into public.module_category_availability(
  household_id,module_code,category_id,enabled,updated_at
)
select ec.household_id,'school',ec.id,true,now()
from public.event_categories ec
where ec.active
  and lower(ec.name) in ('school','kita','appointments','kids')
on conflict(household_id,module_code,category_id)
do update set enabled=true,updated_at=now();

update public.module_category_availability mca
set enabled=false,updated_at=now()
from public.event_categories ec
where mca.household_id=ec.household_id
  and mca.category_id=ec.id
  and mca.module_code in ('calendar','tasks','checklists')
  and ec.icon_key='school-default';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'school-attachments',
  'school-attachments',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict(id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists school_attachment_objects_select on storage.objects;
create policy school_attachment_objects_select
on storage.objects for select to authenticated
using (
  bucket_id='school-attachments'
  and exists(
    select 1
    from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'school','read')
  )
);

drop policy if exists school_attachment_objects_insert on storage.objects;
create policy school_attachment_objects_insert
on storage.objects for insert to authenticated
with check (
  bucket_id='school-attachments'
  and exists(
    select 1
    from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'school','full')
  )
);

drop policy if exists school_attachment_objects_delete on storage.objects;
create policy school_attachment_objects_delete
on storage.objects for delete to authenticated
using (
  bucket_id='school-attachments'
  and exists(
    select 1
    from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'school','full')
  )
);

create or replace function public.save_school_entry_v1(
  p_entry_id uuid,
  p_household_id uuid,
  p_title text,
  p_category_id uuid,
  p_child_profile_id uuid,
  p_entry_date date,
  p_all_day boolean,
  p_start_time time,
  p_end_time time,
  p_location_text text,
  p_notes text,
  p_add_to_calendar boolean
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_entry_id uuid;
  v_event_id uuid;
  v_calendar_id uuid;
  v_timezone text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_participants jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'school','full') then
    raise exception 'School & Kita write access required';
  end if;
  if nullif(trim(p_title),'') is null then raise exception 'Title is required'; end if;
  if p_entry_date is null then raise exception 'Date is required'; end if;

  if p_category_id is not null and not exists(
    select 1 from public.event_categories
    where id=p_category_id
      and household_id=p_household_id
      and active
  ) then
    raise exception 'Invalid category';
  end if;

  if p_child_profile_id is not null and not exists(
    select 1 from public.family_profiles
    where id=p_child_profile_id
      and household_id=p_household_id
      and active
  ) then
    raise exception 'Invalid child profile';
  end if;

  if not p_all_day and p_start_time is null then
    raise exception 'Start time is required for timed entries';
  end if;

  if not p_all_day
     and p_end_time is not null
     and p_end_time <= p_start_time
  then
    raise exception 'End time must be later than start time';
  end if;

  if p_entry_id is null then
    insert into public.school_entries(
      household_id,title,category_id,child_profile_id,entry_date,all_day,
      start_time,end_time,location_text,notes,created_by_user_id
    )
    values(
      p_household_id,trim(p_title),p_category_id,p_child_profile_id,p_entry_date,p_all_day,
      case when p_all_day then null else p_start_time end,
      case when p_all_day then null else p_end_time end,
      nullif(trim(p_location_text),''),
      nullif(trim(p_notes),''),
      auth.uid()
    )
    returning id into v_entry_id;
  else
    select id,linked_event_id
      into v_entry_id,v_event_id
    from public.school_entries
    where id=p_entry_id
      and household_id=p_household_id
      and status='active'
    for update;

    if v_entry_id is null then raise exception 'School entry not found'; end if;

    update public.school_entries
    set title=trim(p_title),
        category_id=p_category_id,
        child_profile_id=p_child_profile_id,
        entry_date=p_entry_date,
        all_day=p_all_day,
        start_time=case when p_all_day then null else p_start_time end,
        end_time=case when p_all_day then null else p_end_time end,
        location_text=nullif(trim(p_location_text),''),
        notes=nullif(trim(p_notes),''),
        updated_at=now()
    where id=v_entry_id;
  end if;

  if p_child_profile_id is not null then
    v_participants:=jsonb_build_array(
      jsonb_build_object(
        'profile_id',p_child_profile_id,
        'participant_role','participant',
        'can_edit',false
      )
    );
  end if;

  select timezone into v_timezone
  from public.households
  where id=p_household_id;

  if p_add_to_calendar then
    if v_event_id is not null then
      select calendar_id
        into v_calendar_id
      from public.calendar_events
      where id=v_event_id
        and household_id=p_household_id
        and deleted_at is null;
    end if;

    if v_calendar_id is null then
      select id
        into v_calendar_id
      from public.calendars
      where household_id=p_household_id
        and active
      order by is_default desc,name
      limit 1;
    end if;

    if v_calendar_id is null then raise exception 'No active calendar found'; end if;

    if not p_all_day then
      v_start_at := (p_entry_date + p_start_time) at time zone v_timezone;
      v_end_at := (p_entry_date + coalesce(p_end_time,p_start_time + interval '1 hour')) at time zone v_timezone;
    end if;

    v_event_id:=public.save_event_v1(
      v_event_id,
      p_household_id,
      v_calendar_id,
      trim(p_title),
      nullif(trim(p_notes),''),
      p_all_day,
      v_start_at,
      v_end_at,
      case when p_all_day then p_entry_date else null end,
      case when p_all_day then p_entry_date else null end,
      v_timezone,
      nullif(trim(p_location_text),''),
      p_category_id,
      'household',
      v_participants,
      null,
      '[]'::jsonb
    );

    update public.school_entries
    set linked_event_id=v_event_id,updated_at=now()
    where id=v_entry_id;
  elsif v_event_id is not null then
    update public.calendar_events
    set deleted_at=now(),
        deleted_by_user_id=auth.uid(),
        updated_at=now()
    where id=v_event_id
      and household_id=p_household_id
      and deleted_at is null;

    update public.school_entries
    set linked_event_id=null,updated_at=now()
    where id=v_entry_id;
  end if;

  return v_entry_id;
end;
$$;

revoke all on function public.save_school_entry_v1(
  uuid,uuid,text,uuid,uuid,date,boolean,time,time,text,text,boolean
) from public;
grant execute on function public.save_school_entry_v1(
  uuid,uuid,text,uuid,uuid,date,boolean,time,time,text,text,boolean
) to authenticated;
