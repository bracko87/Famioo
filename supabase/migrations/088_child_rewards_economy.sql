-- Famioo migration 088
-- Child Rewards Economy V1.
-- Reuses Projects & Chores family_points_ledger and adds task rewards,
-- parent-managed rewards, redemptions, balance/history RPCs and parent adjustments.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'rewards',
  'Child Rewards',
  'Points for tasks and chores with parent-managed family rewards',
  'gift',
  40,
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
select h.id,'rewards',r.role,r.access_level
from public.households h
cross join (values
  ('owner'::text,'full'::text),
  ('admin'::text,'full'::text),
  ('user'::text,'read'::text)
) as r(role,access_level)
on conflict(household_id,module_code,role)
do update set access_level=excluded.access_level,updated_at=now();

alter table public.tasks
  add column if not exists reward_points smallint not null default 0
    check(reward_points between 0 and 1000);

create table if not exists public.child_reward_task_awards(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  profile_id uuid not null references public.family_profiles(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  points smallint not null check(points between 1 and 1000),
  awarded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(task_id)
);

create index if not exists child_reward_task_awards_profile_idx
  on public.child_reward_task_awards(household_id,profile_id,awarded_at desc);

create table if not exists public.child_reward_catalog(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check(length(trim(title)) between 1 and 120),
  description text,
  emoji text,
  cost_points integer not null check(cost_points between 1 and 100000),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists child_reward_catalog_household_idx
  on public.child_reward_catalog(household_id,active,sort_order,created_at);

create table if not exists public.child_reward_redemptions(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  profile_id uuid not null references public.family_profiles(id) on delete cascade,
  reward_id uuid references public.child_reward_catalog(id) on delete set null,
  reward_title text not null,
  reward_emoji text,
  cost_points integer not null check(cost_points>0),
  redeemed_by_user_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now()
);

create index if not exists child_reward_redemptions_profile_idx
  on public.child_reward_redemptions(household_id,profile_id,redeemed_at desc);

create table if not exists public.child_reward_adjustments(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  profile_id uuid not null references public.family_profiles(id) on delete cascade,
  points integer not null check(points between -100000 and 100000 and points<>0),
  note text not null check(length(trim(note)) between 1 and 240),
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists child_reward_adjustments_profile_idx
  on public.child_reward_adjustments(household_id,profile_id,created_at desc);

alter table public.child_reward_task_awards enable row level security;
alter table public.child_reward_catalog enable row level security;
alter table public.child_reward_redemptions enable row level security;
alter table public.child_reward_adjustments enable row level security;

revoke all on public.child_reward_task_awards,public.child_reward_catalog,
  public.child_reward_redemptions,public.child_reward_adjustments
from public,anon,authenticated;
grant all on public.child_reward_task_awards,public.child_reward_catalog,
  public.child_reward_redemptions,public.child_reward_adjustments
to service_role;

create or replace function private.can_manage_child_rewards(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public,private,pg_temp
as $$
  select exists(
    select 1
    from public.household_members hm
    where hm.household_id=p_household_id
      and hm.user_id=auth.uid()
      and hm.status='active'
      and hm.role in ('owner','admin')
  );
$$;

revoke all on function private.can_manage_child_rewards(uuid) from public,anon,authenticated;

create or replace function private.child_reward_balance(p_household_id uuid,p_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path=public,private,pg_temp
as $$
  select
    coalesce((select sum(fpl.points)::integer from public.family_points_ledger fpl
      where fpl.household_id=p_household_id and fpl.profile_id=p_profile_id),0)
    + coalesce((select sum(ta.points)::integer from public.child_reward_task_awards ta
      where ta.household_id=p_household_id and ta.profile_id=p_profile_id),0)
    + coalesce((select sum(a.points)::integer from public.child_reward_adjustments a
      where a.household_id=p_household_id and a.profile_id=p_profile_id),0)
    - coalesce((select sum(r.cost_points)::integer from public.child_reward_redemptions r
      where r.household_id=p_household_id and r.profile_id=p_profile_id),0);
$$;

revoke all on function private.child_reward_balance(uuid,uuid) from public,anon,authenticated;

create or replace function public.child_reward_overview_v1(p_household_id uuid)
returns table(
  profile_id uuid,
  display_name text,
  avatar_path text,
  profile_type text,
  project_points integer,
  task_points integer,
  adjustment_points integer,
  spent_points integer,
  balance integer
)
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_household_member(p_household_id) then raise exception 'Household access required'; end if;

  return query
  select
    fp.id,
    fp.display_name::text,
    fp.avatar_path,
    fp.profile_type::text,
    coalesce((select sum(fpl.points)::integer from public.family_points_ledger fpl
      where fpl.household_id=p_household_id and fpl.profile_id=fp.id),0),
    coalesce((select sum(ta.points)::integer from public.child_reward_task_awards ta
      where ta.household_id=p_household_id and ta.profile_id=fp.id),0),
    coalesce((select sum(a.points)::integer from public.child_reward_adjustments a
      where a.household_id=p_household_id and a.profile_id=fp.id),0),
    coalesce((select sum(r.cost_points)::integer from public.child_reward_redemptions r
      where r.household_id=p_household_id and r.profile_id=fp.id),0),
    private.child_reward_balance(p_household_id,fp.id)
  from public.family_profiles fp
  where fp.household_id=p_household_id
    and fp.active
    and fp.profile_type in ('child','profile_only')
  order by fp.display_name;
end;
$$;

create or replace function public.child_reward_catalog_v1(
  p_household_id uuid,
  p_include_inactive boolean default false
)
returns table(
  id uuid,
  title text,
  description text,
  emoji text,
  cost_points integer,
  active boolean,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_household_member(p_household_id) then raise exception 'Household access required'; end if;

  return query
  select r.id,r.title::text,r.description,r.emoji,r.cost_points,r.active,r.sort_order,r.created_at,r.updated_at
  from public.child_reward_catalog r
  where r.household_id=p_household_id
    and (r.active or (coalesce(p_include_inactive,false) and private.can_manage_child_rewards(p_household_id)))
  order by r.active desc,r.sort_order,r.cost_points,r.title;
end;
$$;

create or replace function public.child_reward_tasks_v1(p_household_id uuid)
returns table(
  task_id uuid,
  title text,
  assigned_profile_id uuid,
  assigned_name text,
  reward_points smallint,
  status text,
  due_date date
)
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_household_member(p_household_id) then raise exception 'Household access required'; end if;

  return query
  select t.id,t.title::text,t.assigned_profile_id,fp.display_name::text,t.reward_points,t.status::text,t.due_date
  from public.tasks t
  join public.family_profiles fp
    on fp.id=t.assigned_profile_id
   and fp.household_id=t.household_id
   and fp.active
   and fp.profile_type in ('child','profile_only')
  where t.household_id=p_household_id
    and t.archived_at is null
  order by (t.status='done'),t.due_date nulls last,t.created_at desc;
end;
$$;

create or replace function public.child_reward_history_v1(
  p_household_id uuid,
  p_profile_id uuid default null,
  p_limit integer default 100
)
returns table(
  entry_id text,
  profile_id uuid,
  entry_type text,
  title text,
  points_delta integer,
  occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_household_member(p_household_id) then raise exception 'Household access required'; end if;
  if p_profile_id is not null and not exists(
    select 1 from public.family_profiles fp
    where fp.id=p_profile_id and fp.household_id=p_household_id and fp.active
  ) then raise exception 'Profile not found'; end if;

  return query
  select h.entry_id,h.profile_id,h.entry_type,h.title,h.points_delta,h.occurred_at
  from (
    select
      'chore:'||fpl.id::text as entry_id,
      fpl.profile_id,
      'chore'::text as entry_type,
      coalesce(pwi.title,'Completed chore')::text as title,
      fpl.points::integer as points_delta,
      fpl.awarded_at as occurred_at
    from public.family_points_ledger fpl
    left join public.project_work_items pwi on pwi.id=fpl.source_work_item_id
    where fpl.household_id=p_household_id

    union all

    select
      'task:'||ta.id::text,
      ta.profile_id,
      'task'::text,
      coalesce(t.title,'Completed task')::text,
      ta.points::integer,
      ta.awarded_at
    from public.child_reward_task_awards ta
    left join public.tasks t on t.id=ta.task_id
    where ta.household_id=p_household_id

    union all

    select
      'adjustment:'||a.id::text,
      a.profile_id,
      'adjustment'::text,
      a.note::text,
      a.points,
      a.created_at
    from public.child_reward_adjustments a
    where a.household_id=p_household_id

    union all

    select
      'redemption:'||r.id::text,
      r.profile_id,
      'redemption'::text,
      r.reward_title::text,
      -r.cost_points,
      r.redeemed_at
    from public.child_reward_redemptions r
    where r.household_id=p_household_id
  ) h
  where p_profile_id is null or h.profile_id=p_profile_id
  order by h.occurred_at desc
  limit greatest(1,least(coalesce(p_limit,100),300));
end;
$$;

create or replace function public.save_child_reward_v1(
  p_household_id uuid,
  p_id uuid default null,
  p_title text default null,
  p_description text default null,
  p_emoji text default null,
  p_cost_points integer default 1,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_manage_child_rewards(p_household_id) then raise exception 'Parent/admin access required'; end if;
  if nullif(trim(coalesce(p_title,'')),'') is null then raise exception 'Reward title is required'; end if;
  if p_cost_points is null or p_cost_points<1 or p_cost_points>100000 then raise exception 'Reward cost must be between 1 and 100000 points'; end if;

  if p_id is null then
    insert into public.child_reward_catalog(
      household_id,title,description,emoji,cost_points,active,sort_order,created_by_user_id
    )
    values(
      p_household_id,trim(p_title),nullif(trim(coalesce(p_description,'')),''),
      nullif(trim(coalesce(p_emoji,'')),''),p_cost_points,coalesce(p_active,true),
      coalesce((select max(sort_order)+1 from public.child_reward_catalog where household_id=p_household_id),0),
      auth.uid()
    )
    returning id into v_id;
  else
    update public.child_reward_catalog
    set title=trim(p_title),
        description=nullif(trim(coalesce(p_description,'')),''),
        emoji=nullif(trim(coalesce(p_emoji,'')),''),
        cost_points=p_cost_points,
        active=coalesce(p_active,true),
        updated_at=now()
    where id=p_id and household_id=p_household_id
    returning id into v_id;
    if v_id is null then raise exception 'Reward not found'; end if;
  end if;

  return v_id;
end;
$$;

create or replace function public.set_child_reward_active_v1(
  p_household_id uuid,
  p_id uuid,
  p_active boolean
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_manage_child_rewards(p_household_id) then raise exception 'Parent/admin access required'; end if;

  update public.child_reward_catalog
  set active=coalesce(p_active,false),updated_at=now()
  where id=p_id and household_id=p_household_id;

  return found;
end;
$$;

create or replace function public.set_task_reward_points_v1(
  p_household_id uuid,
  p_task_id uuid,
  p_points integer
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_manage_child_rewards(p_household_id) then raise exception 'Parent/admin access required'; end if;
  if p_points is null or p_points<0 or p_points>1000 then raise exception 'Task reward must be between 0 and 1000 points'; end if;

  update public.tasks
  set reward_points=p_points::smallint,updated_at=now()
  where id=p_task_id and household_id=p_household_id and archived_at is null;

  return found;
end;
$$;

create or replace function public.adjust_child_reward_points_v1(
  p_household_id uuid,
  p_profile_id uuid,
  p_points integer,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_manage_child_rewards(p_household_id) then raise exception 'Parent/admin access required'; end if;
  if p_points is null or p_points=0 or p_points not between -100000 and 100000 then raise exception 'Adjustment must be a non-zero point value'; end if;
  if nullif(trim(coalesce(p_note,'')),'') is null then raise exception 'Adjustment note is required'; end if;
  if not exists(
    select 1 from public.family_profiles fp
    where fp.id=p_profile_id and fp.household_id=p_household_id and fp.active
      and fp.profile_type in ('child','profile_only')
  ) then raise exception 'Child profile not found'; end if;

  if private.child_reward_balance(p_household_id,p_profile_id)+p_points<0 then
    raise exception 'Adjustment would make the balance negative';
  end if;

  insert into public.child_reward_adjustments(household_id,profile_id,points,note,created_by_user_id)
  values(p_household_id,p_profile_id,p_points,trim(p_note),auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.redeem_child_reward_v1(
  p_household_id uuid,
  p_profile_id uuid,
  p_reward_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_reward public.child_reward_catalog%rowtype;
  v_id uuid;
  v_balance integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_manage_child_rewards(p_household_id) then raise exception 'Parent/admin access required'; end if;
  if not exists(
    select 1 from public.family_profiles fp
    where fp.id=p_profile_id and fp.household_id=p_household_id and fp.active
      and fp.profile_type in ('child','profile_only')
  ) then raise exception 'Child profile not found'; end if;

  select * into v_reward
  from public.child_reward_catalog
  where id=p_reward_id and household_id=p_household_id and active
  for update;
  if not found then raise exception 'Reward is not available'; end if;

  v_balance:=private.child_reward_balance(p_household_id,p_profile_id);
  if v_balance<v_reward.cost_points then raise exception 'Not enough points for this reward'; end if;

  insert into public.child_reward_redemptions(
    household_id,profile_id,reward_id,reward_title,reward_emoji,cost_points,redeemed_by_user_id
  )
  values(
    p_household_id,p_profile_id,v_reward.id,v_reward.title,v_reward.emoji,v_reward.cost_points,auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.sync_child_task_reward_v1()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_child boolean:=false;
begin
  if new.assigned_profile_id is not null then
    select exists(
      select 1 from public.family_profiles fp
      where fp.id=new.assigned_profile_id
        and fp.household_id=new.household_id
        and fp.active
        and fp.profile_type in ('child','profile_only')
    ) into v_child;
  end if;

  if new.status='done' and new.archived_at is null and v_child and new.reward_points>0 then
    insert into public.child_reward_task_awards(
      household_id,profile_id,task_id,points,awarded_at
    )
    values(
      new.household_id,new.assigned_profile_id,new.id,new.reward_points,coalesce(new.completed_at,now())
    )
    on conflict(task_id)
    do update set
      profile_id=excluded.profile_id,
      points=excluded.points,
      awarded_at=excluded.awarded_at;
  else
    delete from public.child_reward_task_awards where task_id=new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists child_task_reward_sync on public.tasks;
create trigger child_task_reward_sync
after insert or update of status,assigned_profile_id,reward_points,completed_at,archived_at
on public.tasks
for each row execute function public.sync_child_task_reward_v1();

-- Backfill awards for already-completed child tasks that have a reward value.
insert into public.child_reward_task_awards(household_id,profile_id,task_id,points,awarded_at)
select t.household_id,t.assigned_profile_id,t.id,t.reward_points,coalesce(t.completed_at,now())
from public.tasks t
join public.family_profiles fp
  on fp.id=t.assigned_profile_id and fp.household_id=t.household_id
where t.status='done' and t.archived_at is null and t.reward_points>0
  and fp.active and fp.profile_type in ('child','profile_only')
on conflict(task_id) do update
set profile_id=excluded.profile_id,points=excluded.points,awarded_at=excluded.awarded_at;

revoke all on function public.child_reward_overview_v1(uuid) from public,anon;
revoke all on function public.child_reward_catalog_v1(uuid,boolean) from public,anon;
revoke all on function public.child_reward_tasks_v1(uuid) from public,anon;
revoke all on function public.child_reward_history_v1(uuid,uuid,integer) from public,anon;
revoke all on function public.save_child_reward_v1(uuid,uuid,text,text,text,integer,boolean) from public,anon;
revoke all on function public.set_child_reward_active_v1(uuid,uuid,boolean) from public,anon;
revoke all on function public.set_task_reward_points_v1(uuid,uuid,integer) from public,anon;
revoke all on function public.adjust_child_reward_points_v1(uuid,uuid,integer,text) from public,anon;
revoke all on function public.redeem_child_reward_v1(uuid,uuid,uuid) from public,anon;

grant execute on function public.child_reward_overview_v1(uuid) to authenticated;
grant execute on function public.child_reward_catalog_v1(uuid,boolean) to authenticated;
grant execute on function public.child_reward_tasks_v1(uuid) to authenticated;
grant execute on function public.child_reward_history_v1(uuid,uuid,integer) to authenticated;
grant execute on function public.save_child_reward_v1(uuid,uuid,text,text,text,integer,boolean) to authenticated;
grant execute on function public.set_child_reward_active_v1(uuid,uuid,boolean) to authenticated;
grant execute on function public.set_task_reward_points_v1(uuid,uuid,integer) to authenticated;
grant execute on function public.adjust_child_reward_points_v1(uuid,uuid,integer,text) to authenticated;
grant execute on function public.redeem_child_reward_v1(uuid,uuid,uuid) to authenticated;
