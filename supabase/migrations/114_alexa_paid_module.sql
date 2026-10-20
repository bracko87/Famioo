-- Famioo migration 114 — Alexa / Voice becomes a PAID optional module.
-- Apply only to the Famioo Supabase backend, after migrations 108 and 112.
-- This does NOT charge any household, create a paid entitlement, activate Alexa,
-- connect the Amazon Skill, or change existing household purchases.
-- No changes to production until approved deployment.

-- 1. Remove the inherited core (Free) entitlement, leaving optional module
-- purchases/activations in household_modules as the source of paid access.
update public.modules
set is_core=false,
    name='Alexa / Voice Integration',
    description='Optional paid household voice assistant integration (Alexa Skill setup pending)'
where code='voice_integration';

-- 2. Register in the optional paid-product catalogue. The first optional
-- module quote follows the existing Famioo €0.99 base model; later-module
-- pricing remains null/unset until finalized, and checkout isn't live yet.
insert into public.billing_products(
  product_code,name,product_kind,module_code,
  first_purchase_price_eur,followup_price_eur,
  included_ai_requests,extra_storage_bytes,
  qualifies_for_storage_threshold,active,sort_order
)
values(
  'module_voice_integration','Alexa / Voice Integration','module','voice_integration',
  0.99,null,0,0,true,true,85
)
on conflict(product_code) do update
set name=excluded.name,
    product_kind=excluded.product_kind,
    module_code=excluded.module_code,
    first_purchase_price_eur=excluded.first_purchase_price_eur,
    qualifies_for_storage_threshold=excluded.qualifies_for_storage_threshold,
    active=true,
    updated_at=now();

-- 3. Remove Alexa from the account-level Free override IN BOTH entitlement
-- lists. All other Free module behavior and household purchases are unchanged.
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
    'messenger', 'memories', 'files'
  ) then
    return false;
  end if;

  select coalesce(
    (v_individual_free and m.code in (
      'calendar', 'calendar_connections', 'tasks', 'checklists',
      'safety', 'contacts', 'emergency_info', 'pickup_authorization',
      'messenger', 'memories', 'files'
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

-- 4. Keep role AND effective paid entitlement checks in RPCs. The functions
-- run as SECURITY DEFINER after migration 112: never infer permission solely
-- from caller owner/admin role.
create or replace function public.save_voice_integration_settings_v1(
  p_household_id uuid,
  p_enabled boolean,
  p_allowed_actions text[]
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare v_actions text[]:=coalesce(p_allowed_actions,'{}'::text[]);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(
    select 1 from public.household_members hm
    where hm.household_id=p_household_id
      and hm.user_id=auth.uid()
      and hm.status='active'
      and hm.role in ('owner','admin')
  ) then raise exception 'Only household owners/admins can configure voice integration'; end if;
  if not private.has_module_access(p_household_id,'voice_integration','full') then
    raise exception 'Paid Alexa / Voice module access required';
  end if;
  if not (v_actions <@ array['calendar_query','shopping_add','task_add','reminders_query']::text[]) then
    raise exception 'Unsupported voice action';
  end if;

  insert into public.voice_integration_settings(
    household_id,enabled,allowed_actions,linked_by_user_id
  )
  values(p_household_id,coalesce(p_enabled,false),v_actions,auth.uid())
  on conflict(household_id) do update set
    enabled=excluded.enabled,
    allowed_actions=excluded.allowed_actions,
    updated_at=now();

  return true;
end;
$$;

create or replace function public.rotate_voice_integration_token_v1(
  p_household_id uuid
)
returns text
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare v_token text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(
    select 1 from public.household_members hm
    where hm.household_id=p_household_id
      and hm.user_id=auth.uid()
      and hm.status='active'
      and hm.role in ('owner','admin')
  ) then raise exception 'Only household owners/admins can rotate voice integration tokens'; end if;
  if not private.has_module_access(p_household_id,'voice_integration','full') then
    raise exception 'Paid Alexa / Voice module access required';
  end if;

  v_token:='fami_voice_'||encode(gen_random_bytes(24),'hex');

  insert into public.voice_integration_settings(
    household_id,enabled,allowed_actions,token_hash,token_prefix,linked_by_user_id,token_rotated_at
  )
  values(
    p_household_id,false,
    '{}'::text[],
    encode(digest(v_token,'sha256'),'hex'),
    left(v_token,18),
    auth.uid(),
    now()
  )
  on conflict(household_id) do update set
    token_hash=excluded.token_hash,
    token_prefix=excluded.token_prefix,
    linked_by_user_id=auth.uid(),
    token_rotated_at=now(),
    updated_at=now();

  return v_token;
end;
$$;

-- 5. Even SELECT of integration settings/logs is limited to active
-- entitled household owners/admins. Direct write was revoked in migration 112.
drop policy if exists voice_integration_settings_owner_admin
  on public.voice_integration_settings;
create policy voice_integration_settings_owner_admin
on public.voice_integration_settings for all to authenticated
using (
  private.has_module_access(household_id,'voice_integration','read')
  and exists (
    select 1 from public.household_members hm
    where hm.household_id=voice_integration_settings.household_id
      and hm.user_id=(select auth.uid())
      and hm.status='active' and hm.role in ('owner','admin')
  )
)
with check (
  private.has_module_access(household_id,'voice_integration','full')
  and exists (
    select 1 from public.household_members hm
    where hm.household_id=voice_integration_settings.household_id
      and hm.user_id=(select auth.uid())
      and hm.status='active' and hm.role in ('owner','admin')
  )
);

drop policy if exists voice_integration_action_log_owner_admin
  on public.voice_integration_action_log;
create policy voice_integration_action_log_owner_admin
on public.voice_integration_action_log for select to authenticated
using (
  private.has_module_access(household_id,'voice_integration','read')
  and exists (
    select 1 from public.household_members hm
    where hm.household_id=voice_integration_action_log.household_id
      and hm.user_id=(select auth.uid())
      and hm.status='active' and hm.role in ('owner','admin')
  )
);

-- Preserve the protected RPC grants: end users require household admin role
-- and actual paid-module entitlement; membership alone is never enough.
revoke all on function public.save_voice_integration_settings_v1(uuid,boolean,text[]) from public,anon;
revoke all on function public.rotate_voice_integration_token_v1(uuid) from public,anon;
grant execute on function public.save_voice_integration_settings_v1(uuid,boolean,text[]) to authenticated;
grant execute on function public.rotate_voice_integration_token_v1(uuid) to authenticated;

-- Release tests:
-- * Free user & no purchase: no voice module route, no settings/tokens, 403 RPC.
-- * Household subscribed but caller individual Free override: still denied.
-- * Paid household active admin: can configure or rotate, as before.
-- * Disabled/expired household paid entitlement: RPC denies.
-- * Existing purchase records and all non-Alexa modules remain unchanged.
