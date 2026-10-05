-- Famioo migration 039
-- Editable calendar events + automatic archive of overdue tasks and checklists.

create or replace function public.delete_event_v1(
  p_event_id uuid,
  p_household_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  if not private.can_edit_event(p_event_id) then
    raise exception 'Calendar edit access required';
  end if;

  update public.calendar_events
  set deleted_at=now(),
      deleted_by_user_id=v_user,
      status='active',
      updated_at=now()
  where id=p_event_id
    and household_id=p_household_id
    and deleted_at is null;

  if not found then
    raise exception 'Event not found';
  end if;

  update public.notifications
  set status='cancelled'
  where household_id=p_household_id
    and entity_type='calendar_event'
    and entity_id=p_event_id
    and status='pending';

  return true;
end;
$$;

revoke all on function public.delete_event_v1(uuid,uuid) from public,anon;
grant execute on function public.delete_event_v1(uuid,uuid) to authenticated;


create or replace function public.set_task_archived_v1(
  p_task_id uuid,
  p_household_id uuid,
  p_archived boolean
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.has_module_access(p_household_id,'tasks','full') then
    raise exception 'Tasks write access required';
  end if;

  update public.tasks
  set status=case
        when p_archived then 'archived'
        when status='archived' then 'open'
        else status
      end,
      archived_at=case when p_archived then now() else null end,
      updated_at=now()
  where id=p_task_id
    and household_id=p_household_id;

  if not found then
    raise exception 'Task not found';
  end if;

  return true;
end;
$$;

revoke all on function public.set_task_archived_v1(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_task_archived_v1(uuid,uuid,boolean) to authenticated;


create or replace function public.archive_overdue_work_v1(
  p_household_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_today date;
  v_tasks integer:=0;
  v_checklists integer:=0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;

  select (now() at time zone h.timezone)::date
    into v_today
  from public.households h
  where h.id=p_household_id;

  if v_today is null then
    raise exception 'Household not found';
  end if;

  update public.tasks
  set status='archived',
      archived_at=coalesce(archived_at,now()),
      updated_at=now()
  where household_id=p_household_id
    and archived_at is null
    and due_date is not null
    and due_date < v_today;

  get diagnostics v_tasks=row_count;

  update public.checklists
  set status='archived',
      archived_at=coalesce(archived_at,now()),
      expanded_slot=null,
      updated_at=now()
  where household_id=p_household_id
    and status='active'
    and due_date is not null
    and due_date < v_today;

  get diagnostics v_checklists=row_count;

  return jsonb_build_object(
    'tasks_archived',v_tasks,
    'checklists_archived',v_checklists,
    'today',v_today
  );
end;
$$;

revoke all on function public.archive_overdue_work_v1(uuid) from public,anon;
grant execute on function public.archive_overdue_work_v1(uuid) to authenticated;


create or replace function private.archive_all_overdue_work()
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  h record;
  v_today date;
  v_tasks integer:=0;
  v_checklists integer:=0;
  v_rows integer;
begin
  for h in
    select id,timezone from public.households
  loop
    v_today := (now() at time zone h.timezone)::date;

    update public.tasks
    set status='archived',
        archived_at=coalesce(archived_at,now()),
        updated_at=now()
    where household_id=h.id
      and archived_at is null
      and due_date is not null
      and due_date < v_today;

    get diagnostics v_rows=row_count;
    v_tasks:=v_tasks+v_rows;

    update public.checklists
    set status='archived',
        archived_at=coalesce(archived_at,now()),
        expanded_slot=null,
        updated_at=now()
    where household_id=h.id
      and status='active'
      and due_date is not null
      and due_date < v_today;

    get diagnostics v_rows=row_count;
    v_checklists:=v_checklists+v_rows;
  end loop;

  return jsonb_build_object(
    'tasks_archived',v_tasks,
    'checklists_archived',v_checklists
  );
end;
$$;

revoke all on function private.archive_all_overdue_work() from public,anon,authenticated;
grant execute on function private.archive_all_overdue_work() to service_role;


create or replace function public.purge_old_archives_v1(p_household_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_tasks integer:=0;
  v_checklists integer:=0;
  v_shopping integer:=0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;

  delete from public.tasks
  where household_id=p_household_id
    and archived_at is not null
    and archived_at < now() - interval '6 months';
  get diagnostics v_tasks=row_count;

  delete from public.checklists
  where household_id=p_household_id
    and status='archived'
    and archived_at is not null
    and archived_at < now() - interval '6 months';
  get diagnostics v_checklists=row_count;

  delete from public.shopping_lists
  where household_id=p_household_id
    and status='archived'
    and archived_at is not null
    and archived_at < now() - interval '6 months';
  get diagnostics v_shopping=row_count;

  return jsonb_build_object(
    'tasks_deleted',v_tasks,
    'checklists_deleted',v_checklists,
    'shopping_lists_deleted',v_shopping
  );
end;
$$;


do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname='famioo-auto-archive-overdue-v1'
  limit 1;

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end
$$;

select cron.schedule(
  'famioo-auto-archive-overdue-v1',
  '17 * * * *',
  $job$
    select private.archive_all_overdue_work();
  $job$
);

select private.archive_all_overdue_work();
