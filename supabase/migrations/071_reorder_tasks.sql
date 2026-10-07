-- Famioo migration 071
-- Mobile-safe manual task ordering.

create or replace function public.reorder_tasks_v1(
  p_household_id uuid,
  p_task_ids uuid[]
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'tasks','full') then
    raise exception 'Tasks write access required';
  end if;

  update public.tasks t
  set sort_order=ordered.ord * 10,
      updated_at=now()
  from unnest(coalesce(p_task_ids,array[]::uuid[])) with ordinality as ordered(id,ord)
  where t.id=ordered.id
    and t.household_id=p_household_id
    and t.archived_at is null;

  return true;
end;
$$;

revoke all on function public.reorder_tasks_v1(uuid,uuid[]) from public,anon;
grant execute on function public.reorder_tasks_v1(uuid,uuid[]) to authenticated;
