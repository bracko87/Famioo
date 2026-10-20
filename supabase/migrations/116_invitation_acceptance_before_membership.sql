-- Migration 116: Email invitation acceptance must precede household membership.
-- Preserves existing memberships: no backfill, demotion or deletion.
-- Existing Auth users remain unaffected until a new invitation is created.

alter table public.household_invitations
  add column if not exists invited_auth_user_id uuid references auth.users(id) on delete set null,
  add column if not exists accepted_at timestamptz,
  add column if not exists requires_password boolean not null default false;

create index if not exists household_invitations_recipient_pending_idx
  on public.household_invitations(invited_auth_user_id, expires_at)
  where status='pending';

-- Membership is created only inside this transaction, after Supabase Auth
-- verifies the recipient's own email address and session.
create or replace function public.accept_household_invitation_v2(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private, auth, pg_temp
as $$
declare
  v_invite public.household_invitations%rowtype;
  v_user_id uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  v_timezone text;
  v_profile_id uuid;
begin
  if v_user_id is null then
    raise exception 'Sign in using your invitation email before accepting';
  end if;

  select u.email, u.email_confirmed_at
    into v_email, v_confirmed
  from auth.users u
  where u.id=v_user_id;

  if v_confirmed is null then
    raise exception 'Verify your email using the invitation link first';
  end if;

  select *
    into v_invite
  from public.household_invitations i
  where i.id=p_invitation_id
  for update;

  if not found or v_invite.status <> 'pending' then
    raise exception 'Invitation is not pending';
  end if;

  if v_invite.expires_at <= now() then
    raise exception 'Invitation has expired. Ask the owner to invite you again';
  end if;

  if v_invite.invited_auth_user_id is distinct from v_user_id
     or lower(v_invite.email) is distinct from lower(v_email) then
    raise exception 'Invitation is not addressed to this signed-in user';
  end if;

  if exists (
    select 1 from public.household_members hm
    where hm.household_id=v_invite.household_id
      and hm.user_id=v_user_id and hm.role='owner'
  ) then
    raise exception 'An owner cannot accept a second membership invitation';
  end if;

  select h.timezone into v_timezone
  from public.households h
  where h.id=v_invite.household_id and h.archived_at is null;

  if v_timezone is null then
    raise exception 'This household is unavailable';
  end if;

  insert into public.user_profiles(id,display_name,default_timezone)
  values (
    v_user_id,
    coalesce(nullif(trim(v_invite.display_name),''),split_part(v_email,'@',1)),
    v_timezone
  )
  on conflict(id) do update set
    display_name=coalesce(nullif(public.user_profiles.display_name,''),excluded.display_name),
    updated_at=now();

  insert into public.household_members(
    household_id,user_id,role,status,updated_at
  ) values (
    v_invite.household_id,v_user_id,v_invite.role,'active',now()
  )
  on conflict(household_id,user_id) do update set
    role=excluded.role,status='active',updated_at=now();

  select fp.id into v_profile_id
  from public.family_profiles fp
  where fp.household_id=v_invite.household_id
    and fp.linked_user_id=v_user_id
  limit 1;

  if v_profile_id is null then
    insert into public.family_profiles(
      household_id,linked_user_id,display_name,profile_type,color_key,active
    ) values (
      v_invite.household_id,v_user_id,
      coalesce(nullif(trim(v_invite.display_name),''),split_part(v_email,'@',1)),
      'adult',
      case when v_invite.role='admin' then 'blue' else 'green' end,
      true
    );
  else
    update public.family_profiles
    set active=true,updated_at=now()
    where id=v_profile_id and household_id=v_invite.household_id;
  end if;

  insert into public.notification_preferences(household_id,user_id,timezone)
  values(v_invite.household_id,v_user_id,v_timezone)
  on conflict(household_id,user_id) do nothing;

  update public.household_invitations
  set status='accepted',accepted_at=now()
  where id=p_invitation_id;

  return v_invite.household_id;
end;
$$;

revoke all on function public.accept_household_invitation_v2(uuid) from public, anon;
grant execute on function public.accept_household_invitation_v2(uuid) to authenticated;
