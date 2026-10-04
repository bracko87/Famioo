-- Famioo migration 012
-- Consolidate household roles, general preferences, and module-level role permissions.

alter table public.households
  add column if not exists default_language text not null default 'en',
  add column if not exists week_starts_on smallint not null default 1,
  add column if not exists date_format text not null default 'DD.MM.YYYY',
  add column if not exists time_format text not null default '24h';

alter table public.households
  drop constraint if exists households_default_language_check,
  drop constraint if exists households_week_starts_on_check,
  drop constraint if exists households_date_format_check,
  drop constraint if exists households_time_format_check;

alter table public.households
  add constraint households_default_language_check
    check (default_language in ('en','de','sr')),
  add constraint households_week_starts_on_check
    check (week_starts_on in (0,1)),
  add constraint households_date_format_check
    check (date_format in ('DD.MM.YYYY','MM/DD/YYYY','YYYY-MM-DD')),
  add constraint households_time_format_check
    check (time_format in ('24h','12h'));

alter table public.household_members
  drop constraint if exists household_members_role_check;

update public.household_members
set role='user'
where role in ('adult','member');

alter table public.household_members
  add constraint household_members_role_check
  check (role in ('owner','admin','user'));

alter table public.household_invitations
  drop constraint if exists household_invitations_role_check;

update public.household_invitations
set role='user'
where role in ('adult','member');

alter table public.household_invitations
  alter column role set default 'user',
  add constraint household_invitations_role_check
  check (role in ('admin','user'));

create table if not exists public.module_role_permissions (
  household_id uuid not null references public.households(id) on delete cascade,
  module_code text not null references public.modules(code) on delete cascade,
  role text not null,
  access_level text not null,
  updated_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id,module_code,role),
  constraint module_role_permissions_role_check
    check (role in ('owner','admin','user')),
  constraint module_role_permissions_access_check
    check (access_level in ('full','read','restricted')),
  constraint module_role_permissions_owner_full_check
    check (role <> 'owner' or access_level='full')
);

alter table public.module_role_permissions enable row level security;

insert into public.module_role_permissions(
  household_id,module_code,role,access_level
)
select h.id,m.code,r.role,r.access_level
from public.households h
cross join public.modules m
cross join (
  values
    ('owner'::text,'full'::text),
    ('admin'::text,'full'::text),
    ('user'::text,'read'::text)
) as r(role,access_level)
where m.is_active
on conflict (household_id,module_code,role) do nothing;

create index if not exists idx_module_role_permissions_household
  on public.module_role_permissions(household_id);

create index if not exists idx_module_role_permissions_module
  on public.module_role_permissions(module_code);

drop policy if exists module_role_permissions_select_member on public.module_role_permissions;
create policy module_role_permissions_select_member
on public.module_role_permissions
for select
to authenticated
using (private.is_household_member(household_id));

drop policy if exists module_role_permissions_insert_owner on public.module_role_permissions;
create policy module_role_permissions_insert_owner
on public.module_role_permissions
for insert
to authenticated
with check (private.is_household_owner(household_id));

drop policy if exists module_role_permissions_update_owner on public.module_role_permissions;
create policy module_role_permissions_update_owner
on public.module_role_permissions
for update
to authenticated
using (private.is_household_owner(household_id))
with check (private.is_household_owner(household_id));

drop policy if exists module_role_permissions_delete_owner on public.module_role_permissions;
create policy module_role_permissions_delete_owner
on public.module_role_permissions
for delete
to authenticated
using (private.is_household_owner(household_id));

create or replace function private.has_module_access(
  p_household_id uuid,
  p_module_code text,
  p_required_access text default 'read'
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_role text;
  v_access text;
  v_entitled boolean;
begin
  if p_required_access not in ('read','full') then
    return false;
  end if;

  select hm.role
  into v_role
  from public.household_members hm
  where hm.household_id=p_household_id
    and hm.user_id=auth.uid()
    and hm.status='active'
  limit 1;

  if v_role is null then
    return false;
  end if;

  select coalesce(
    m.is_core
    or (
      hm.enabled
      and (hm.valid_until is null or hm.valid_until>now())
    ),
    false
  )
  into v_entitled
  from public.modules m
  left join public.household_modules hm
    on hm.household_id=p_household_id
   and hm.module_code=m.code
  where m.code=p_module_code
    and m.is_active;

  if not coalesce(v_entitled,false) then
    return false;
  end if;

  if v_role='owner' then
    return true;
  end if;

  select mrp.access_level
  into v_access
  from public.module_role_permissions mrp
  where mrp.household_id=p_household_id
    and mrp.module_code=p_module_code
    and mrp.role=v_role;

  v_access := coalesce(
    v_access,
    case when v_role='admin' then 'full' else 'read' end
  );

  if p_required_access='full' then
    return v_access='full';
  end if;

  return v_access in ('full','read');
end;
$$;

revoke all on function private.has_module_access(uuid,text,text) from public;

drop policy if exists household_members_update_admin on public.household_members;
drop policy if exists household_members_update_owner on public.household_members;
create policy household_members_update_owner
on public.household_members
for update
to authenticated
using (
  private.is_household_owner(household_id)
  and role <> 'owner'
)
with check (
  private.is_household_owner(household_id)
  and role in ('admin','user')
);

drop policy if exists household_invitations_select_admin on public.household_invitations;
drop policy if exists household_invitations_insert_admin on public.household_invitations;
drop policy if exists household_invitations_update_admin on public.household_invitations;
drop policy if exists household_invitations_delete_admin on public.household_invitations;

create policy household_invitations_select_owner
on public.household_invitations
for select to authenticated
using (private.is_household_owner(household_id));

create policy household_invitations_insert_owner
on public.household_invitations
for insert to authenticated
with check (private.is_household_owner(household_id));

create policy household_invitations_update_owner
on public.household_invitations
for update to authenticated
using (private.is_household_owner(household_id))
with check (private.is_household_owner(household_id));

create policy household_invitations_delete_owner
on public.household_invitations
for delete to authenticated
using (private.is_household_owner(household_id));

create or replace function public.set_household_member_role_v1(
  p_household_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_household_owner(p_household_id) then
    raise exception 'Owner access required';
  end if;

  if p_role not in ('admin','user') then
    raise exception 'Invalid role';
  end if;

  if not exists(
    select 1
    from public.household_members
    where household_id=p_household_id
      and user_id=p_user_id
      and role <> 'owner'
  ) then
    raise exception 'Member not found or owner role cannot be changed';
  end if;

  update public.household_members
  set role=p_role,updated_at=now()
  where household_id=p_household_id
    and user_id=p_user_id
    and role <> 'owner';
end;
$$;

revoke all on function public.set_household_member_role_v1(uuid,uuid,text) from public;
grant execute on function public.set_household_member_role_v1(uuid,uuid,text) to authenticated;

create or replace function public.set_module_role_permission_v1(
  p_household_id uuid,
  p_module_code text,
  p_role text,
  p_access_level text
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_household_owner(p_household_id) then
    raise exception 'Owner access required';
  end if;

  if p_role not in ('admin','user') then
    raise exception 'Only Admin and User permissions can be changed';
  end if;

  if p_access_level not in ('full','read','restricted') then
    raise exception 'Invalid access level';
  end if;

  if not exists(
    select 1 from public.modules
    where code=p_module_code and is_active
  ) then
    raise exception 'Module not found';
  end if;

  insert into public.module_role_permissions(
    household_id,module_code,role,access_level,updated_by_user_id
  )
  values(
    p_household_id,p_module_code,p_role,p_access_level,auth.uid()
  )
  on conflict(household_id,module_code,role)
  do update set
    access_level=excluded.access_level,
    updated_by_user_id=excluded.updated_by_user_id,
    updated_at=now();
end;
$$;

revoke all on function public.set_module_role_permission_v1(uuid,text,text,text) from public;
grant execute on function public.set_module_role_permission_v1(uuid,text,text,text) to authenticated;

create or replace function public.household_users_v1(
  p_household_id uuid
)
returns table(
  user_id uuid,
  email text,
  display_name text,
  role text,
  status text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;

  return query
  select
    hm.user_id,
    u.email::text,
    coalesce(
      fp.display_name,
      up.display_name,
      split_part(u.email,'@',1)
    )::text as display_name,
    hm.role,
    hm.status,
    hm.joined_at
  from public.household_members hm
  join auth.users u on u.id=hm.user_id
  left join public.user_profiles up on up.id=hm.user_id
  left join public.family_profiles fp
    on fp.household_id=hm.household_id
   and fp.linked_user_id=hm.user_id
   and fp.active
  where hm.household_id=p_household_id
  order by
    case hm.role when 'owner' then 1 when 'admin' then 2 else 3 end,
    lower(coalesce(fp.display_name,up.display_name,u.email));
end;
$$;

revoke all on function public.household_users_v1(uuid) from public;
grant execute on function public.household_users_v1(uuid) to authenticated;

create or replace function public.create_household_invitation_v1(
  p_household_id uuid,
  p_email text,
  p_role text default 'user',
  p_display_name text default null,
  p_expires_hours integer default 168
)
returns table(
  invitation_id uuid,
  invitation_token text,
  invitation_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_token text;
  v_hash text;
  v_id uuid;
  v_expires timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_household_owner(p_household_id) then
    raise exception 'Owner access required';
  end if;

  if p_role not in ('admin','user') then
    raise exception 'Invalid invitation role';
  end if;

  if nullif(trim(p_email),'') is null then
    raise exception 'Email is required';
  end if;

  if p_expires_hours < 1 or p_expires_hours > 720 then
    raise exception 'Invalid invitation expiry';
  end if;

  v_token := encode(gen_random_bytes(24),'hex');
  v_hash := encode(digest(v_token,'sha256'),'hex');
  v_expires := now() + make_interval(hours=>p_expires_hours);

  update public.household_invitations
  set status='revoked'
  where household_id=p_household_id
    and lower(email)=lower(trim(p_email))
    and status='pending';

  insert into public.household_invitations(
    household_id,email,role,display_name,token_hash,invited_by_user_id,expires_at
  )
  values(
    p_household_id,
    lower(trim(p_email)),
    p_role,
    nullif(trim(p_display_name),''),
    v_hash,
    auth.uid(),
    v_expires
  )
  returning id into v_id;

  return query select v_id,v_token,v_expires;
end;
$$;

revoke all on function public.create_household_invitation_v1(uuid,text,text,text,integer) from public;
grant execute on function public.create_household_invitation_v1(uuid,text,text,text,integer) to authenticated;

create or replace function private.can_access_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists(
    select 1
    from public.calendar_events e
    where e.id=p_event_id
      and e.deleted_at is null
      and private.has_module_access(e.household_id,'calendar','read')
      and (
        e.visibility='household'
        or private.has_module_access(e.household_id,'calendar','full')
        or e.created_by_user_id=auth.uid()
        or exists(
          select 1
          from public.event_participants ep
          join public.family_profiles fp
            on fp.household_id=ep.household_id
           and fp.id=ep.profile_id
          where ep.event_id=e.id
            and fp.linked_user_id=auth.uid()
            and fp.active
        )
      )
  );
$$;

create or replace function private.can_edit_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists(
    select 1
    from public.calendar_events e
    where e.id=p_event_id
      and e.deleted_at is null
      and private.has_module_access(e.household_id,'calendar','full')
  );
$$;

drop policy if exists calendars_select_member on public.calendars;
drop policy if exists calendars_insert_admin on public.calendars;
drop policy if exists calendars_update_admin on public.calendars;
drop policy if exists calendars_delete_admin on public.calendars;

create policy calendars_select_module_read
on public.calendars for select to authenticated
using (private.has_module_access(household_id,'calendar','read'));

create policy calendars_insert_module_full
on public.calendars for insert to authenticated
with check (private.has_module_access(household_id,'calendar','full'));

create policy calendars_update_module_full
on public.calendars for update to authenticated
using (private.has_module_access(household_id,'calendar','full'))
with check (private.has_module_access(household_id,'calendar','full'));

create policy calendars_delete_module_full
on public.calendars for delete to authenticated
using (private.has_module_access(household_id,'calendar','full'));

drop policy if exists categories_select_member on public.event_categories;
drop policy if exists categories_insert_admin on public.event_categories;
drop policy if exists categories_update_admin on public.event_categories;
drop policy if exists categories_delete_admin on public.event_categories;

create policy categories_select_module_read
on public.event_categories for select to authenticated
using (private.has_module_access(household_id,'calendar','read'));

create policy categories_insert_module_full
on public.event_categories for insert to authenticated
with check (private.has_module_access(household_id,'calendar','full'));

create policy categories_update_module_full
on public.event_categories for update to authenticated
using (private.has_module_access(household_id,'calendar','full'))
with check (private.has_module_access(household_id,'calendar','full'));

create policy categories_delete_module_full
on public.event_categories for delete to authenticated
using (private.has_module_access(household_id,'calendar','full'));

drop policy if exists events_insert_member on public.calendar_events;
create policy events_insert_module_full
on public.calendar_events for insert to authenticated
with check (
  private.has_module_access(household_id,'calendar','full')
  and created_by_user_id=(select auth.uid())
);

drop policy if exists tasks_select_member on public.tasks;
drop policy if exists tasks_insert_member on public.tasks;
drop policy if exists tasks_update_member on public.tasks;
drop policy if exists tasks_delete_member on public.tasks;

create policy tasks_select_module_read
on public.tasks for select to authenticated
using (private.has_module_access(household_id,'tasks','read'));

create policy tasks_insert_module_full
on public.tasks for insert to authenticated
with check (
  private.has_module_access(household_id,'tasks','full')
  and created_by_user_id=(select auth.uid())
);

create policy tasks_update_module_full
on public.tasks for update to authenticated
using (private.has_module_access(household_id,'tasks','full'))
with check (private.has_module_access(household_id,'tasks','full'));

create policy tasks_delete_module_full
on public.tasks for delete to authenticated
using (private.has_module_access(household_id,'tasks','full'));

drop policy if exists task_templates_select_member on public.task_templates;
drop policy if exists task_templates_insert_member on public.task_templates;
drop policy if exists task_templates_update_member on public.task_templates;
drop policy if exists task_templates_delete_member on public.task_templates;

create policy task_templates_select_module_read
on public.task_templates for select to authenticated
using (private.has_module_access(household_id,'tasks','read'));

create policy task_templates_insert_module_full
on public.task_templates for insert to authenticated
with check (
  private.has_module_access(household_id,'tasks','full')
  and created_by_user_id=(select auth.uid())
);

create policy task_templates_update_module_full
on public.task_templates for update to authenticated
using (private.has_module_access(household_id,'tasks','full'))
with check (private.has_module_access(household_id,'tasks','full'));

create policy task_templates_delete_module_full
on public.task_templates for delete to authenticated
using (private.has_module_access(household_id,'tasks','full'));

drop policy if exists checklists_select_member on public.checklists;
drop policy if exists checklists_insert_member on public.checklists;
drop policy if exists checklists_update_member on public.checklists;
drop policy if exists checklists_delete_member on public.checklists;

create policy checklists_select_module_read
on public.checklists for select to authenticated
using (private.has_module_access(household_id,'checklists','read'));

create policy checklists_insert_module_full
on public.checklists for insert to authenticated
with check (
  private.has_module_access(household_id,'checklists','full')
  and created_by_user_id=(select auth.uid())
);

create policy checklists_update_module_full
on public.checklists for update to authenticated
using (private.has_module_access(household_id,'checklists','full'))
with check (private.has_module_access(household_id,'checklists','full'));

create policy checklists_delete_module_full
on public.checklists for delete to authenticated
using (private.has_module_access(household_id,'checklists','full'));

drop policy if exists checklist_items_select_member on public.checklist_items;
drop policy if exists checklist_items_insert_member on public.checklist_items;
drop policy if exists checklist_items_update_member on public.checklist_items;
drop policy if exists checklist_items_delete_member on public.checklist_items;

create policy checklist_items_select_module_read
on public.checklist_items for select to authenticated
using (private.has_module_access(household_id,'checklists','read'));

create policy checklist_items_insert_module_full
on public.checklist_items for insert to authenticated
with check (
  private.has_module_access(household_id,'checklists','full')
  and created_by_user_id=(select auth.uid())
);

create policy checklist_items_update_module_full
on public.checklist_items for update to authenticated
using (private.has_module_access(household_id,'checklists','full'))
with check (private.has_module_access(household_id,'checklists','full'));

create policy checklist_items_delete_module_full
on public.checklist_items for delete to authenticated
using (private.has_module_access(household_id,'checklists','full'));

create or replace function public.calendar_occurrences_v1(
  p_household_id uuid,
  p_range_start date,
  p_range_end date
)
returns table(
  event_id uuid,
  occurrence_key text,
  household_id uuid,
  calendar_id uuid,
  category_id uuid,
  title text,
  description text,
  all_day boolean,
  occurrence_start_at timestamptz,
  occurrence_end_at timestamptz,
  occurrence_start_date date,
  occurrence_end_date date,
  event_timezone text,
  location_text text,
  visibility text,
  status text
)
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  if not private.has_module_access(p_household_id,'calendar','read') then
    raise exception 'Calendar access required';
  end if;

  if p_range_end<p_range_start then
    raise exception 'Invalid calendar range';
  end if;

  if p_range_end-p_range_start>400 then
    raise exception 'Calendar range too large';
  end if;

  return query
  with base as (
    select e.*,r.rrule,r.exception_dates,r.exception_instants
    from public.calendar_events e
    left join public.event_recurrence_rules r
      on r.household_id=e.household_id and r.event_id=e.id
    where e.household_id=p_household_id
      and e.deleted_at is null
      and e.status='active'
      and private.can_access_event(e.id)
  ),
  all_day_occ as (
    select
      e.id,
      d.occurrence_date,
      null::timestamptz as occurrence_at
    from base e
    cross join lateral private.rrule_occurrence_dates(
      e.start_date,
      e.rrule,
      coalesce(e.exception_dates,array[]::date[]),
      p_range_start,
      p_range_end
    ) d(occurrence_date)
    where e.all_day
  ),
  timed_occ_pre as (
    select
      e.id,
      d.occurrence_date,
      (
        d.occurrence_date
        + (timezone(e.event_timezone,e.start_at))::time
      ) at time zone e.event_timezone as occurrence_at
    from base e
    cross join lateral private.rrule_occurrence_dates(
      timezone(e.event_timezone,e.start_at)::date,
      e.rrule,
      array[]::date[],
      p_range_start,
      p_range_end
    ) d(occurrence_date)
    where not e.all_day
  ),
  timed_occ as (
    select t.*
    from timed_occ_pre t
    join base e on e.id=t.id
    where not (
      t.occurrence_at=any(
        coalesce(e.exception_instants,array[]::timestamptz[])
      )
    )
  ),
  occurrences as (
    select * from all_day_occ
    union all
    select * from timed_occ
  )
  select
    e.id as event_id,
    e.id::text||':'||
      case
        when e.all_day then o.occurrence_date::text
        else extract(epoch from o.occurrence_at)::bigint::text
      end as occurrence_key,
    e.household_id,
    e.calendar_id,
    e.category_id,
    e.title,
    e.description,
    e.all_day,
    case when e.all_day then null else o.occurrence_at end as occurrence_start_at,
    case
      when e.all_day then null
      when e.end_at is null then null
      else o.occurrence_at+(e.end_at-e.start_at)
    end as occurrence_end_at,
    case when e.all_day then o.occurrence_date else null end as occurrence_start_date,
    case
      when e.all_day then
        o.occurrence_date+(coalesce(e.end_date,e.start_date)-e.start_date)
      else null
    end as occurrence_end_date,
    e.event_timezone,
    e.location_text,
    e.visibility,
    e.status
  from occurrences o
  join base e on e.id=o.id
  order by
    coalesce(
      o.occurrence_at,
      o.occurrence_date::timestamp at time zone e.event_timezone
    ),
    e.title;
end;
$$;

create or replace function public.save_event_v1(
  p_event_id uuid,
  p_household_id uuid,
  p_calendar_id uuid,
  p_title text,
  p_description text,
  p_all_day boolean,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_start_date date,
  p_end_date date,
  p_timezone text,
  p_location_text text,
  p_category_id uuid,
  p_visibility text,
  p_participants jsonb default '[]'::jsonb,
  p_rrule text default null,
  p_reminders jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_event uuid;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  if not private.has_module_access(p_household_id,'calendar','full') then
    raise exception 'Calendar write access required';
  end if;

  if nullif(trim(p_title),'') is null then
    raise exception 'Event title is required';
  end if;

  if p_visibility not in ('household','participants') then
    raise exception 'Invalid visibility';
  end if;

  if not exists(
    select 1 from pg_catalog.pg_timezone_names where name=p_timezone
  ) then
    raise exception 'Invalid timezone';
  end if;

  if p_event_id is null then
    insert into public.calendar_events(
      household_id,calendar_id,category_id,title,description,all_day,
      start_at,end_at,start_date,end_date,event_timezone,location_text,
      visibility,status,created_by_user_id
    )
    values(
      p_household_id,p_calendar_id,p_category_id,trim(p_title),
      nullif(trim(p_description),''),
      p_all_day,p_start_at,p_end_at,p_start_date,p_end_date,p_timezone,
      nullif(trim(p_location_text),''),
      p_visibility,'active',v_user
    )
    returning id into v_event;
  else
    if not private.can_edit_event(p_event_id) then
      raise exception 'Event edit access required';
    end if;

    if not exists(
      select 1
      from public.calendar_events
      where id=p_event_id and household_id=p_household_id
    ) then
      raise exception 'Event household mismatch';
    end if;

    update public.calendar_events
    set calendar_id=p_calendar_id,
        category_id=p_category_id,
        title=trim(p_title),
        description=nullif(trim(p_description),''),
        all_day=p_all_day,
        start_at=p_start_at,
        end_at=p_end_at,
        start_date=p_start_date,
        end_date=p_end_date,
        event_timezone=p_timezone,
        location_text=nullif(trim(p_location_text),''),
        visibility=p_visibility,
        updated_at=now()
    where id=p_event_id;

    v_event:=p_event_id;
  end if;

  delete from public.event_participants where event_id=v_event;

  insert into public.event_participants(
    household_id,event_id,profile_id,participant_role,can_edit
  )
  select
    p_household_id,
    v_event,
    x.profile_id,
    coalesce(nullif(x.participant_role,''),'participant'),
    coalesce(x.can_edit,false)
  from jsonb_to_recordset(coalesce(p_participants,'[]'::jsonb))
    as x(profile_id uuid,participant_role text,can_edit boolean);

  if p_rrule is null or btrim(p_rrule)='' then
    delete from public.event_recurrence_rules where event_id=v_event;
  else
    insert into public.event_recurrence_rules(
      household_id,event_id,rrule,timezone
    )
    values(p_household_id,v_event,p_rrule,p_timezone)
    on conflict(household_id,event_id)
    do update set
      rrule=excluded.rrule,
      timezone=excluded.timezone,
      updated_at=now();
  end if;

  delete from public.event_reminders where event_id=v_event;

  insert into public.event_reminders(
    household_id,event_id,profile_id,reminder_kind,offset_minutes,
    exact_at,morning_time,timezone,delivery_channel,enabled,created_by_user_id
  )
  select
    p_household_id,
    v_event,
    x.profile_id,
    x.reminder_kind,
    x.offset_minutes,
    x.exact_at,
    x.morning_time,
    p_timezone,
    coalesce(nullif(x.delivery_channel,''),'push'),
    coalesce(x.enabled,true),
    v_user
  from jsonb_to_recordset(coalesce(p_reminders,'[]'::jsonb))
    as x(
      profile_id uuid,
      reminder_kind text,
      offset_minutes integer,
      exact_at timestamptz,
      morning_time time,
      delivery_channel text,
      enabled boolean
    );

  return v_event;
end;
$$;

create or replace function public.create_household_v1(
  p_name text,
  p_timezone text default 'Europe/Berlin',
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_household uuid;
  v_display text;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  if nullif(trim(p_name),'') is null then
    raise exception 'Household name is required';
  end if;

  if not exists(
    select 1 from pg_catalog.pg_timezone_names where name=p_timezone
  ) then
    raise exception 'Invalid timezone';
  end if;

  select coalesce(
    nullif(trim(p_display_name),''),
    nullif(trim(up.display_name),''),
    split_part(u.email,'@',1),
    'Member'
  )
  into v_display
  from auth.users u
  left join public.user_profiles up on up.id=u.id
  where u.id=v_user;

  insert into public.households(
    name,timezone,created_by_user_id
  )
  values(
    trim(p_name),p_timezone,v_user
  )
  returning id into v_household;

  insert into public.household_members(
    household_id,user_id,role,status
  )
  values(
    v_household,v_user,'owner','active'
  );

  insert into public.family_profiles(
    household_id,linked_user_id,display_name,profile_type,color_key
  )
  values(
    v_household,v_user,v_display,'adult','purple'
  );

  insert into public.calendars(
    household_id,name,color_key,is_default,created_by_user_id
  )
  values(
    v_household,'Family','purple',true,v_user
  );

  insert into public.event_categories(
    household_id,name,color_key,icon_key,sort_order,is_system,created_by_user_id
  )
  values
    (v_household,'Family','purple','family',10,true,v_user),
    (v_household,'Work','blue','work',20,true,v_user),
    (v_household,'Doctor','green','doctor',30,true,v_user),
    (v_household,'Birthday','pink','birthday',40,true,v_user),
    (v_household,'Travel','orange','travel',50,true,v_user),
    (v_household,'Other','slate','other',60,true,v_user);

  insert into public.household_modules(
    household_id,module_code,enabled,source,enabled_at
  )
  select
    v_household,
    m.code,
    m.is_core,
    'default',
    case when m.is_core then now() else null end
  from public.modules m
  where m.is_active;

  insert into public.module_role_permissions(
    household_id,module_code,role,access_level
  )
  select
    v_household,
    m.code,
    r.role,
    r.access_level
  from public.modules m
  cross join (
    values
      ('owner'::text,'full'::text),
      ('admin'::text,'full'::text),
      ('user'::text,'read'::text)
  ) as r(role,access_level)
  where m.is_active;

  insert into public.notification_preferences(
    household_id,user_id,timezone
  )
  values(
    v_household,v_user,p_timezone
  );

  return v_household;
end;
$$;

create or replace function private.seed_permissions_for_new_module()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if new.is_active then
    insert into public.module_role_permissions(
      household_id,module_code,role,access_level
    )
    select
      h.id,
      new.code,
      r.role,
      r.access_level
    from public.households h
    cross join (
      values
        ('owner'::text,'full'::text),
        ('admin'::text,'full'::text),
        ('user'::text,'read'::text)
    ) as r(role,access_level)
    on conflict(household_id,module_code,role) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_seed_permissions_for_new_module on public.modules;
create trigger trg_seed_permissions_for_new_module
after insert or update of is_active
on public.modules
for each row
execute function private.seed_permissions_for_new_module();

grant select,insert,update,delete
on public.module_role_permissions
to authenticated;
