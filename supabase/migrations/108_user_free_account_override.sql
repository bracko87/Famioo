-- Account-level Free plan restriction for a single user, not a household downgrade.
-- This migration must be applied to the Supabase project used by the app before
-- server-side enforcement is active. Does not change existing household purchases.
--
-- Reversible: delete the relevant row from public.user_plan_overrides;
-- the original household entitlements then apply to that individual again.

create table if not exists public.user_plan_overrides (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null check (plan = 'free'),
  created_at timestamptz not null default now()
);

alter table public.user_plan_overrides enable row level security;
revoke all on public.user_plan_overrides from public, anon, authenticated;
grant select on public.user_plan_overrides to authenticated;

drop policy if exists user_plan_overrides_read_self on public.user_plan_overrides;
create policy user_plan_overrides_read_self
on public.user_plan_overrides for select to authenticated
using (user_id = (select auth.uid()));

-- Target only the explicitly requested auth account; do not modify its
-- household membership, payment records, household_modules or member roles.
insert into public.user_plan_overrides (user_id, plan)
select id, 'free'
from auth.users
where lower(trim(email)) = 'aleksandarlevnajic@gmail.com'
on conflict (user_id) do update set plan = excluded.plan;

-- Both SQL RLS and SECURITY DEFINER RPCs which call private.has_module_access
-- must consult the individual override *before* household core/paid entitlement.
-- For Free accounts, free modules remain available across households, subject
-- to normal membership and role permissions. All paid modules are blocked.
create or replace function private.has_module_access(
  p_household_id uuid,
  p_module_code text,
  p_required_access text default 'read'
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_role text;
  v_access text;
  v_entitled boolean;
  v_individual_free boolean;
begin
  if auth.uid() is null or p_required_access not in ('read','full') then
    return false;
  end if;

  select hm.role
    into v_role
  from public.household_members hm
  where hm.household_id = p_household_id
    and hm.user_id = auth.uid()
    and hm.status = 'active'
  limit 1;

  if v_role is null then
    return false;
  end if;

  select exists (
    select 1
    from public.user_plan_overrides upo
    where upo.user_id = auth.uid() and upo.plan = 'free'
  )
  into v_individual_free;

  if v_individual_free and p_module_code not in (
    'calendar', 'calendar_connections', 'tasks', 'checklists',
    'safety', 'contacts', 'emergency_info', 'pickup_authorization',
    'messenger', 'memories', 'files', 'voice_integration'
  ) then
    return false;
  end if;

  select coalesce(
    (v_individual_free and m.code in (
      'calendar', 'calendar_connections', 'tasks', 'checklists',
      'safety', 'contacts', 'emergency_info', 'pickup_authorization',
      'messenger', 'memories', 'files', 'voice_integration'
    ))
    or m.is_core
    or (
      hmod.enabled
      and (hmod.valid_until is null or hmod.valid_until > now())
    ),
    false
  )
  into v_entitled
  from public.modules m
  left join public.household_modules hmod
    on hmod.household_id = p_household_id
   and hmod.module_code = m.code
  where m.code = p_module_code
    and m.is_active;

  if not coalesce(v_entitled, false) then
    return false;
  end if;

  if v_role = 'owner' then
    return true;
  end if;

  select mrp.access_level
  into v_access
  from public.module_role_permissions mrp
  where mrp.household_id = p_household_id
    and mrp.module_code = p_module_code
    and mrp.role = v_role;

  v_access := coalesce(
    v_access,
    case when v_role = 'admin' then 'full' else 'read' end
  );

  if p_required_access = 'full' then
    return v_access = 'full';
  end if;

  return v_access in ('full', 'read');
end;
$$;

revoke all on function private.has_module_access(uuid, text, text) from public, anon;
