-- Famioo migration 042
-- Permanent removal actions for Projects & Chores and safe restore state.

create or replace function public.set_project_work_item_archived_v1(
  p_item_id uuid,
  p_household_id uuid,
  p_archived boolean
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'projects','full') then
    raise exception 'Projects & Chores write access required';
  end if;

  update public.project_work_items
  set status=case
        when p_archived then 'archived'
        when completed_at is not null then 'done'
        else 'open'
      end,
      updated_at=now()
  where id=p_item_id and household_id=p_household_id;

  if not found then raise exception 'Responsibility not found'; end if;
  return true;
end;
$$;

revoke all on function public.set_project_work_item_archived_v1(uuid,uuid,boolean)
from public,anon;
grant execute on function public.set_project_work_item_archived_v1(uuid,uuid,boolean)
to authenticated;


create or replace function public.delete_project_work_item_v1(
  p_item_id uuid,
  p_household_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'projects','full') then
    raise exception 'Projects & Chores write access required';
  end if;

  delete from public.family_points_ledger
  where household_id=p_household_id
    and source_work_item_id=p_item_id;

  delete from public.project_work_items
  where id=p_item_id
    and household_id=p_household_id;

  if not found then raise exception 'Responsibility not found'; end if;

  -- Deliberately preserve any linked Task or Calendar event. Projects & Chores
  -- is the points/competition child, not the owner of those main records.
  return true;
end;
$$;

revoke all on function public.delete_project_work_item_v1(uuid,uuid)
from public,anon;
grant execute on function public.delete_project_work_item_v1(uuid,uuid)
to authenticated;


create or replace function public.delete_household_project_v1(
  p_project_id uuid,
  p_household_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'projects','full') then
    raise exception 'Projects & Chores write access required';
  end if;

  delete from public.family_points_ledger fpl
  using public.project_work_items pwi
  where pwi.project_id=p_project_id
    and pwi.household_id=p_household_id
    and fpl.source_work_item_id=pwi.id;

  delete from public.project_work_items
  where project_id=p_project_id
    and household_id=p_household_id;

  delete from public.household_projects
  where id=p_project_id
    and household_id=p_household_id;

  if not found then raise exception 'Project not found'; end if;

  -- Linked Tasks and Calendar events remain intact.
  return true;
end;
$$;

revoke all on function public.delete_household_project_v1(uuid,uuid)
from public,anon;
grant execute on function public.delete_household_project_v1(uuid,uuid)
to authenticated;
