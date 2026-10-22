-- Household-scoped Free plan. Activate a specific household separately after
-- checking its data and member roles. Never embed household IDs in public Git.
-- Paid module rows remain present and can be restored from the snapshot.
create table if not exists public.household_plan_overrides (
  household_id uuid primary key references public.households(id) on delete cascade,
  plan text not null check (plan='free'),
  created_at timestamptz not null default now()
);

alter table public.household_plan_overrides enable row level security;
revoke all on public.household_plan_overrides from public, anon, authenticated;
grant select on public.household_plan_overrides to authenticated;
drop policy if exists household_plan_read_member on public.household_plan_overrides;
create policy household_plan_read_member on public.household_plan_overrides
  for select to authenticated
  using (private.is_household_member(household_id));

create table if not exists public.household_module_plan_backup (
  household_id uuid not null references public.households(id) on delete cascade,
  module_code text not null,
  was_enabled boolean not null,
  was_valid_until timestamptz,
  captured_at timestamptz not null default now(),
  primary key (household_id, module_code)
);
alter table public.household_module_plan_backup enable row level security;
revoke all on public.household_module_plan_backup from public, anon, authenticated;

-- All existing SQL RLS policies and permission-checking RPCs that call this
-- centralized helper now honor the household's effective plan, not only the
-- individual account or the outdated global modules.is_core flag.
create or replace function private.has_module_access(
  p_household_id uuid,
  p_module_code text,
  p_required_access text default 'read'
)
returns boolean
language plpgsql
stable security definer
set search_path=public,private,pg_temp
as $function$
declare
  v_role text;
  v_access text;
  v_entitled boolean;
  v_household_free boolean;
begin
  if auth.uid() is null or p_required_access not in ('read','full') then
    return false;
  end if;

  select hm.role into v_role
  from public.household_members hm
  where hm.household_id=p_household_id
    and hm.user_id=auth.uid() and hm.status='active'
  limit 1;

  if v_role is null then return false; end if;

  select exists(
    select 1 from public.household_plan_overrides hpo
    where hpo.household_id=p_household_id and hpo.plan='free'
  ) into v_household_free;

  -- The Free offer is household-wide, including all future invitees. Even
  -- historically misclassified is_core paid modules cannot bypass this gate.
  if v_household_free and p_module_code not in (
    'calendar','calendar_connections','tasks','checklists',
    'safety','contacts','emergency_info','pickup_authorization',
    'messenger','memories','files'
  ) then return false; end if;

  select coalesce(
    (v_household_free and m.code in (
      'calendar','calendar_connections','tasks','checklists',
      'safety','contacts','emergency_info','pickup_authorization',
      'messenger','memories','files'
    ))
    or m.is_core
    or (hm.enabled and (hm.valid_until is null or hm.valid_until>now())),
    false
  ) into v_entitled
  from public.modules m
  left join public.household_modules hm on hm.household_id=p_household_id
    and hm.module_code=m.code
  where m.code=p_module_code and m.is_active;

  if not coalesce(v_entitled,false) then return false; end if;
  if v_role='owner' then return true; end if;

  select mrp.access_level into v_access
  from public.module_role_permissions mrp
  where mrp.household_id=p_household_id and mrp.module_code=p_module_code
    and mrp.role=v_role;

  v_access:=coalesce(v_access,case when v_role='admin' then 'full' else 'read' end);
  if p_required_access='full' then return v_access='full'; end if;
  return v_access in ('full','read');
end;
$function$;

-- For the Free household, cap new Memories additions at 100 MiB of distinct
-- referenced image files. Do not remove or alter existing photos.
create or replace function public.free_household_memories_usage_v1(
  p_household_id uuid
)
returns table(memories_used_bytes bigint, memories_quota_bytes bigint)
language plpgsql stable security definer
set search_path=public,private,pg_temp
as $function$
begin
  if auth.uid() is null or not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;
  return query
  select coalesce(sum(f.file_size),0)::bigint, 104857600::bigint
  from public.household_files f
  where f.household_id=p_household_id and f.status in ('pending','active')
    and f.id in (select p.file_id from public.family_memory_photos p
                 where p.household_id=p_household_id);
end;
$function$;
revoke all on function public.free_household_memories_usage_v1(uuid) from public,anon;
grant execute on function public.free_household_memories_usage_v1(uuid) to authenticated;

create or replace function private.enforce_free_household_memories_v1()
returns trigger language plpgsql security definer
set search_path=public,private,pg_temp
as $function$
declare
  v_bytes bigint;
begin
  if not exists(select 1 from public.household_plan_overrides
                where household_id=new.household_id and plan='free') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.household_id::text, 13));
  select coalesce(sum(f.file_size),0)::bigint into v_bytes
  from public.household_files f
  where f.household_id=new.household_id and f.status in ('pending','active')
    and f.id in (
      select p.file_id from public.family_memory_photos p
      where p.household_id=new.household_id and p.id is distinct from new.id
      union select new.file_id
    );

  if v_bytes>104857600 then
    raise exception 'Free household Memories storage limit reached (100 MB)';
  end if;
  return new;
end;
$function$;

drop trigger if exists free_household_memories_quota_guard on public.family_memory_photos;
create trigger free_household_memories_quota_guard
before insert or update of file_id,household_id on public.family_memory_photos
for each row execute function private.enforce_free_household_memories_v1();
