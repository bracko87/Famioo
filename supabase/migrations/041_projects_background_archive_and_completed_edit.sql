-- Famioo migration 041
-- Finish Projects & Chores parity with Tasks: background expiry and editing completed responsibilities.

create or replace function private.archive_all_expired_projects_chores_v1()
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  h record;
  v_today date;
  v_projects integer:=0;
  v_items integer:=0;
  v_rows integer:=0;
begin
  for h in select id,timezone from public.households loop
    v_today := (now() at time zone h.timezone)::date;

    update public.project_work_items
    set status='archived',updated_at=now()
    where household_id=h.id
      and status<>'archived'
      and due_date is not null
      and due_date < v_today;
    get diagnostics v_rows=row_count;
    v_items:=v_items+v_rows;

    update public.household_projects
    set status='archived',updated_at=now()
    where household_id=h.id
      and status<>'archived'
      and due_date is not null
      and due_date < v_today;
    get diagnostics v_rows=row_count;
    v_projects:=v_projects+v_rows;

    update public.project_work_items pwi
    set status='archived',updated_at=now()
    where pwi.household_id=h.id
      and pwi.status<>'archived'
      and exists(
        select 1
        from public.household_projects hp
        where hp.id=pwi.project_id
          and hp.household_id=h.id
          and hp.status='archived'
      );
    get diagnostics v_rows=row_count;
    v_items:=v_items+v_rows;
  end loop;

  return jsonb_build_object(
    'projects_archived',v_projects,
    'responsibilities_archived',v_items,
    'processed_at',now()
  );
end;
$$;

revoke all on function private.archive_all_expired_projects_chores_v1()
from public,anon,authenticated;
grant execute on function private.archive_all_expired_projects_chores_v1()
to service_role;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname='famioo-archive-expired-projects-chores-v1'
  limit 1;

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end
$$;

select cron.schedule(
  'famioo-archive-expired-projects-chores-v1',
  '27 * * * *',
  $$select private.archive_all_expired_projects_chores_v1();$$
);


create or replace function public.save_completed_project_work_item_v1(
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
  p_score_responsibility text
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_status text;
  v_completed_at timestamptz;
  v_completed_by uuid;
  v_result uuid;
  v_points smallint;
  v_profile uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'projects','full') then
    raise exception 'Projects & Chores write access required';
  end if;

  select status,completed_at,completed_by_profile_id
  into v_status,v_completed_at,v_completed_by
  from public.project_work_items
  where id=p_id and household_id=p_household_id
  for update;

  if not found then raise exception 'Responsibility not found'; end if;
  if v_status<>'done' then
    raise exception 'This helper is only for completed responsibilities';
  end if;

  -- The normal editor intentionally accepts open items only. Temporarily reopen
  -- inside this transaction, reuse the canonical save path, then restore completion.
  update public.project_work_items
  set status='open',updated_at=now()
  where id=p_id and household_id=p_household_id;

  v_result:=public.save_project_work_item_v2(
    p_id,
    p_household_id,
    p_project_id,
    p_item_kind,
    p_title,
    p_category_id,
    p_due_date,
    p_location_text,
    p_assigned_profile_id,
    p_notes,
    p_sync_task,
    p_sync_calendar,
    p_score_duration,
    p_score_effort,
    p_score_execution,
    p_score_responsibility,
    null
  );

  select points,assigned_profile_id
  into v_points,v_profile
  from public.project_work_items
  where id=p_id and household_id=p_household_id;

  v_profile:=coalesce(v_completed_by,v_profile);

  update public.project_work_items
  set status='done',
      completed_at=coalesce(v_completed_at,now()),
      completed_by_profile_id=v_profile,
      updated_at=now()
  where id=p_id and household_id=p_household_id;

  if v_profile is not null and v_points>0 then
    insert into public.family_points_ledger(
      household_id,profile_id,source_work_item_id,points,awarded_at
    )
    values(
      p_household_id,v_profile,p_id,v_points,coalesce(v_completed_at,now())
    )
    on conflict(source_work_item_id)
    do update set
      profile_id=excluded.profile_id,
      points=excluded.points,
      awarded_at=excluded.awarded_at;
  else
    delete from public.family_points_ledger
    where source_work_item_id=p_id;
  end if;

  return v_result;
end;
$$;

revoke all on function public.save_completed_project_work_item_v1(
  uuid,uuid,uuid,text,text,uuid,date,text,uuid,text,boolean,boolean,text,text,text,text
) from public,anon;

grant execute on function public.save_completed_project_work_item_v1(
  uuid,uuid,uuid,text,text,uuid,date,text,uuid,text,boolean,boolean,text,text,text,text
) to authenticated;

select private.archive_all_expired_projects_chores_v1();
