-- Famioo migration 034
-- Connect School & Kita and Shopping to the shared Tasks module.

alter table public.school_entries
  add column if not exists sync_task boolean not null default false,
  add column if not exists linked_task_id uuid references public.tasks(id) on delete set null;

alter table public.shopping_lists
  add column if not exists sync_task boolean not null default false,
  add column if not exists linked_task_id uuid references public.tasks(id) on delete set null;


create or replace function private.shopping_category_id(p_household_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_category uuid;
begin
  select id into v_category
  from public.event_categories
  where household_id=p_household_id
    and active
    and lower(name)='shopping'
  order by created_at
  limit 1;

  if v_category is null then
    select id into v_category
    from public.event_categories
    where household_id=p_household_id and active
    order by sort_order,name
    limit 1;
  end if;

  return v_category;
end;
$$;

revoke all on function private.shopping_category_id(uuid) from public;


create or replace function public.save_school_entry_v2(
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
  p_add_to_calendar boolean,
  p_sync_task boolean
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_id uuid;
  v_task uuid;
  v_participants jsonb:='[]'::jsonb;
begin
  if p_entry_id is not null then
    select linked_task_id into v_task
    from public.school_entries
    where id=p_entry_id and household_id=p_household_id;
  end if;

  v_id:=public.save_school_entry_v1(
    p_entry_id,p_household_id,p_title,p_category_id,p_child_profile_id,p_entry_date,
    p_all_day,p_start_time,p_end_time,p_location_text,p_notes,p_add_to_calendar
  );

  if p_child_profile_id is not null then
    v_participants:=jsonb_build_array(jsonb_build_object('profile_id',p_child_profile_id));
  end if;

  if p_sync_task then
    if not private.has_module_access(p_household_id,'tasks','full') then
      raise exception 'Tasks write access required';
    end if;

    if p_category_id is null then
      raise exception 'A category is required when connecting a School & Kita entry to Tasks';
    end if;

    if v_task is null then
      v_task:=public.create_task_v1(
        p_household_id,trim(p_title),p_category_id,p_entry_date,p_location_text,
        v_participants,false,false
      );
    else
      perform public.update_task_v1(
        v_task,p_household_id,trim(p_title),p_category_id,p_entry_date,p_location_text,
        v_participants,false
      );
    end if;

    update public.school_entries
    set sync_task=true,linked_task_id=v_task,updated_at=now()
    where id=v_id;
  else
    if v_task is not null then
      update public.tasks
      set status='archived',archived_at=coalesce(archived_at,now()),updated_at=now()
      where id=v_task
        and household_id=p_household_id
        and status<>'done';
    end if;

    update public.school_entries
    set sync_task=false,linked_task_id=null,updated_at=now()
    where id=v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_school_entry_v2(
  uuid,uuid,text,uuid,uuid,date,boolean,time,time,text,text,boolean,boolean
) from public;
grant execute on function public.save_school_entry_v2(
  uuid,uuid,text,uuid,uuid,date,boolean,time,time,text,text,boolean,boolean
) to authenticated;


create or replace function public.create_shopping_list_v2(
  p_household_id uuid,
  p_title text,
  p_linked_event_id uuid,
  p_scheduled_date date,
  p_sync_task boolean
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_id uuid;
  v_task uuid;
  v_title text;
  v_category uuid;
  v_date date;
  v_location text;
begin
  v_id:=public.create_shopping_list_v1(
    p_household_id,p_title,p_linked_event_id,p_scheduled_date
  );

  if p_sync_task then
    if not private.has_module_access(p_household_id,'tasks','full') then
      raise exception 'Tasks write access required';
    end if;

    select title,category_id,scheduled_date,location_text
      into v_title,v_category,v_date,v_location
    from public.shopping_lists
    where id=v_id and household_id=p_household_id;

    v_category:=coalesce(v_category,private.shopping_category_id(p_household_id));

    if v_category is null then
      raise exception 'No active category is available for the linked Task';
    end if;

    v_task:=public.create_task_v1(
      p_household_id,v_title,v_category,v_date,v_location,
      '[]'::jsonb,false,false
    );

    update public.shopping_lists
    set sync_task=true,linked_task_id=v_task,updated_at=now()
    where id=v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.create_shopping_list_v2(uuid,text,uuid,date,boolean) from public;
grant execute on function public.create_shopping_list_v2(uuid,text,uuid,date,boolean) to authenticated;


create or replace function public.shopping_list_task_status_sync_v1()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if new.linked_task_id is null or new.status=old.status then
    return new;
  end if;

  if new.status='archived' then
    update public.tasks
    set status='done',
        completed_at=coalesce(completed_at,now()),
        updated_at=now()
    where id=new.linked_task_id
      and household_id=new.household_id
      and archived_at is null;
  elsif new.status='active' then
    update public.tasks
    set status='open',
        completed_at=null,
        completed_by_profile_id=null,
        updated_at=now()
    where id=new.linked_task_id
      and household_id=new.household_id
      and archived_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists shopping_list_task_status_sync on public.shopping_lists;
create trigger shopping_list_task_status_sync
after update of status on public.shopping_lists
for each row execute function public.shopping_list_task_status_sync_v1();
