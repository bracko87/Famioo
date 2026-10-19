-- Famioo migration 112 — Voice integration token write protection.
-- Do not allow authenticated frontend users to write token_hash, token_prefix,
-- linked_by_user_id or allowed_actions directly. Use guarded owner/admin RPCs.
-- Existing household permissions, tokens and user data are not changed.

revoke insert,update,delete on table public.voice_integration_settings from authenticated;

-- Explicit owner/admin checks are retained inside each privileged function.
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

-- New rows are deny-by-default unless an owner/admin enables chosen actions.
-- Existing households keep their configured action permissions.
alter table public.voice_integration_settings
  alter column allowed_actions set default '{}'::text[];

revoke all on function public.save_voice_integration_settings_v1(uuid,boolean,text[]) from public,anon;
revoke all on function public.rotate_voice_integration_token_v1(uuid) from public,anon;
grant execute on function public.save_voice_integration_settings_v1(uuid,boolean,text[]) to authenticated;
grant execute on function public.rotate_voice_integration_token_v1(uuid) to authenticated;
