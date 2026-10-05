-- Famioo migration 036
-- Owner household-member removal and automatic cleanup of expired Projects & Chores items.

create or replace function public.remove_household_member_v1(
  p_household_id uuid,
  p_profile_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_linked_user uuid;
  v_member_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_household_owner(p_household_id) then
    raise exception 'Only the household owner can remove household members';
  end if;

  select fp.linked_user_id
  into v_linked_user
  from public.family_profiles fp
  where fp.id=p_profile_id
    and fp.household_id=p_household_id
    and fp.active
  for update;

  if not found then
    raise exception 'Household member not found';
  end if;

  if v_linked_user is not null then
    select hm.role
    into v_member_role
    from public.household_members hm
    where hm.household_id=p_household_id
      and hm.user_id=v_linked_user;

    if v_member_role='owner' then
      raise exception 'The household owner cannot be removed';
    end if;
  end if;

  -- Remove the member from current/future assignments while preserving
  -- historical completion and point records.
  delete from public.event_reminders
  where household_id=p_household_id and profile_id=p_profile_id;

  delete from public.event_participants
  where household_id=p_household_id and profile_id=p_profile_id;

  delete from public.task_participants
  where household_id=p_household_id and profile_id=p_profile_id;

  delete from public.checklist_participants
  where household_id=p_household_id and profile_id=p_profile_id;

  update public.tasks
  set assigned_profile_id=null,
      updated_at=now()
  where household_id=p_household_id
    and assigned_profile_id=p_profile_id
    and status='open';

  update public.checklist_items
  set assigned_profile_id=null,
      updated_at=now()
  where household_id=p_household_id
    and assigned_profile_id=p_profile_id;

  update public.household_projects
  set owner_profile_id=null,
      updated_at=now()
  where household_id=p_household_id
    and owner_profile_id=p_profile_id
    and status='active';

  update public.project_work_items
  set assigned_profile_id=null,
      updated_at=now()
  where household_id=p_household_id
    and assigned_profile_id=p_profile_id
    and status='open';

  update public.project_work_templates
  set default_assigned_profile_id=null,
      updated_at=now()
  where household_id=p_household_id
    and default_assigned_profile_id=p_profile_id;

  update public.task_templates
  set default_assigned_profile_id=null,
      updated_at=now()
  where household_id=p_household_id
    and default_assigned_profile_id=p_profile_id;

  update public.home_care_assets
  set responsible_profile_id=null,
      updated_at=now()
  where household_id=p_household_id
    and responsible_profile_id=p_profile_id;

  update public.home_care_maintenance
  set responsible_profile_id=null,
      updated_at=now()
  where household_id=p_household_id
    and responsible_profile_id=p_profile_id;

  update public.home_care_repairs
  set responsible_profile_id=null,
      updated_at=now()
  where household_id=p_household_id
    and responsible_profile_id=p_profile_id;

  update public.life_admin_items
  set responsible_profile_id=null,
      updated_at=now()
  where household_id=p_household_id
    and responsible_profile_id=p_profile_id;

  update public.school_entries
  set child_profile_id=null,
      updated_at=now()
  where household_id=p_household_id
    and child_profile_id=p_profile_id;

  update public.family_profiles
  set active=false,
      updated_at=now()
  where id=p_profile_id
    and household_id=p_household_id;

  if v_linked_user is not null then
    delete from public.notification_preferences
    where household_id=p_household_id
      and user_id=v_linked_user;

    delete from public.household_members
    where household_id=p_household_id
      and user_id=v_linked_user
      and role<>'owner';
  end if;

  return true;
end;
$$;

revoke all on function public.remove_household_member_v1(uuid,uuid) from public;
grant execute on function public.remove_household_member_v1(uuid,uuid) to authenticated;


create or replace function public.archive_expired_project_work_items_v1(
  p_household_id uuid
)
returns integer
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_timezone text;
  v_today date;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.has_module_access(p_household_id,'projects','full') then
    raise exception 'Projects & Chores write access required';
  end if;

  select timezone
  into v_timezone
  from public.households
  where id=p_household_id;

  if v_timezone is null then
    raise exception 'Household not found';
  end if;

  v_today := (now() at time zone v_timezone)::date;

  update public.project_work_items
  set status='archived',
      updated_at=now()
  where household_id=p_household_id
    and status<>'archived'
    and due_date is not null
    and due_date < v_today;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.archive_expired_project_work_items_v1(uuid) from public;
grant execute on function public.archive_expired_project_work_items_v1(uuid) to authenticated;
