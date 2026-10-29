-- Scoped Shopping trial for one Free-plan household.
-- Applying this migration by itself grants Shopping to NOBODY. A separate
-- owner-approved row must be inserted for exactly the intended household.
-- The record does not change subscriptions, storage, or paid entitlements.
create table if not exists public.household_test_module_unlocks (
  household_id uuid not null references public.households(id) on delete cascade,
  module_code text not null check (module_code = 'shopping'),
  granted_at timestamptz not null default now(),
  primary key (household_id, module_code)
);

alter table public.household_test_module_unlocks enable row level security;
revoke all on public.household_test_module_unlocks from public, anon, authenticated;
grant select on public.household_test_module_unlocks to authenticated;
drop policy if exists household_test_module_unlocks_read_member
on public.household_test_module_unlocks;
create policy household_test_module_unlocks_read_member
  on public.household_test_module_unlocks for select to authenticated
  using (private.is_household_member(household_id));

-- Preserve the existing role checks, all non-Free entitlements, and
-- explicitly restricted permissions. Ordinary household users receive
-- collaborative Shopping write access only when no explicit role permission
-- overrides the default. Owners and Admins retain their normal roles.
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
  v_trial_enabled boolean;
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

  select exists (
    select 1 from public.household_test_module_unlocks t
    where t.household_id=p_household_id and t.module_code=p_module_code
  ) into v_trial_enabled;

  -- A trial is an explicit household-scoped exception, not a general
  -- downgrade bypass. No individual email or client metadata controls access.
  if v_household_free and not v_trial_enabled and p_module_code not in (
    'calendar','calendar_connections','tasks','checklists',
    'safety','contacts','emergency_info','pickup_authorization',
    'messenger','memories','files'
  ) then return false; end if;

  select coalesce(
    (v_household_free and (
      v_trial_enabled or m.code in (
        'calendar','calendar_connections','tasks','checklists',
        'safety','contacts','emergency_info','pickup_authorization',
        'messenger','memories','files'
      )
    ))
    or (not v_household_free and (
      m.is_core or (hm.enabled and (hm.valid_until is null or hm.valid_until>now()))
    )),
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

  v_access:=coalesce(v_access,
    case
      when v_household_free and v_trial_enabled and p_module_code='shopping' then 'full'
      when v_role='admin' then 'full'
      else 'read'
    end);
  if p_required_access='full' then return v_access='full'; end if;
  return v_access in ('full','read');
end;
$function$;


