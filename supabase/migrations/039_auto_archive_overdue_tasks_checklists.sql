-- Famioo migration 039
-- Archive past-dated Tasks and Checklists automatically in the background.

create or replace function private.archive_overdue_work_all_households_v1()
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  r record;
  v_today date;
  v_tasks integer:=0;
  v_checklists integer:=0;
  v_rows integer:=0;
begin
  for r in
    select id,timezone
    from public.households
  loop
    v_today := (now() at time zone r.timezone)::date;

    update public.tasks
    set status='archived',
        archived_at=coalesce(archived_at,now()),
        updated_at=now()
    where household_id=r.id
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
    where household_id=r.id
      and status='active'
      and due_date is not null
      and due_date < v_today;

    get diagnostics v_rows=row_count;
    v_checklists:=v_checklists+v_rows;
  end loop;

  return jsonb_build_object(
    'tasks_archived',v_tasks,
    'checklists_archived',v_checklists,
    'processed_at',now()
  );
end;
$$;

revoke all on function private.archive_overdue_work_all_households_v1()
from public,anon,authenticated;
grant execute on function private.archive_overdue_work_all_households_v1()
to service_role;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname='famioo-archive-overdue-work-v1'
  limit 1;

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end
$$;

select cron.schedule(
  'famioo-archive-overdue-work-v1',
  '10 * * * *',
  $$select private.archive_overdue_work_all_households_v1();$$
);
