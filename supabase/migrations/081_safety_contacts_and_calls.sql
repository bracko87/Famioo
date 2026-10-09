-- Famioo migration 081
-- Safety contacts and browser-to-browser internet calling foundation.

alter table public.family_profiles
  add column if not exists contact_phone text;

do $$
begin
  if not exists(
    select 1
    from pg_constraint
    where conname='family_profiles_contact_phone_check'
      and conrelid='public.family_profiles'::regclass
  ) then
    alter table public.family_profiles
      add constraint family_profiles_contact_phone_check
      check(
        contact_phone is null
        or (
          length(trim(contact_phone)) between 6 and 32
          and trim(contact_phone) ~ '^\\+?[0-9 ()/.-]+$'
        )
      );
  end if;
end
$$;

create or replace function public.household_users_v1(
  p_household_id uuid
)
returns table(
  profile_id uuid,
  user_id uuid,
  email text,
  phone text,
  display_name text,
  avatar_path text,
  profile_type text,
  role text,
  status text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path=public,private,auth,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;

  return query
  select
    fp.id as profile_id,
    fp.linked_user_id as user_id,
    u.email::text,
    coalesce(nullif(trim(fp.contact_phone),''),u.phone::text) as phone,
    fp.display_name::text,
    fp.avatar_path,
    fp.profile_type,
    coalesce(hm.role,'profile')::text as role,
    coalesce(hm.status,'active')::text as status,
    coalesce(hm.joined_at,fp.created_at) as joined_at
  from public.family_profiles fp
  left join auth.users u on u.id=fp.linked_user_id
  left join public.household_members hm
    on hm.household_id=fp.household_id
   and hm.user_id=fp.linked_user_id
  where fp.household_id=p_household_id
    and fp.active
  order by
    case coalesce(hm.role,'profile')
      when 'owner' then 1
      when 'admin' then 2
      when 'user' then 3
      else 4
    end,
    lower(fp.display_name);
end;
$$;

revoke all on function public.household_users_v1(uuid) from public,anon;
grant execute on function public.household_users_v1(uuid) to authenticated;

create or replace function public.set_household_profile_phone_v1(
  p_household_id uuid,
  p_profile_id uuid,
  p_phone text
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_linked_user uuid;
  v_role text;
  v_phone text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;

  select linked_user_id into v_linked_user
  from public.family_profiles
  where household_id=p_household_id
    and id=p_profile_id
    and active;

  if not found then raise exception 'Family profile not found'; end if;

  select role into v_role
  from public.household_members
  where household_id=p_household_id
    and user_id=v_user
    and status='active';

  if v_linked_user is distinct from v_user
     and coalesce(v_role,'user') not in ('owner','admin')
  then
    raise exception 'Only the profile owner or a household admin can change this phone number';
  end if;

  v_phone:=nullif(trim(p_phone),'');

  if v_phone is not null and (
    length(v_phone) not between 6 and 32
    or v_phone !~ '^\\+?[0-9 ()/.-]+$'
  ) then
    raise exception 'Use a valid phone number';
  end if;

  update public.family_profiles
  set contact_phone=v_phone,
      updated_at=now()
  where household_id=p_household_id
    and id=p_profile_id;

  return true;
end;
$$;

revoke all on function public.set_household_profile_phone_v1(uuid,uuid,text)
from public,anon;
grant execute on function public.set_household_profile_phone_v1(uuid,uuid,text)
to authenticated;


create table if not exists public.safety_calls(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  alert_id uuid not null references public.safety_alerts(id) on delete cascade,
  caller_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'ringing'
    check(status in ('ringing','accepted','declined','ended','failed')),
  offer_sdp text,
  answer_sdp text,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  check(caller_user_id<>recipient_user_id)
);

create index if not exists safety_calls_household_recipient_idx
  on public.safety_calls(household_id,recipient_user_id,status,created_at desc);

create index if not exists safety_calls_alert_idx
  on public.safety_calls(alert_id,created_at desc);

create table if not exists public.safety_call_ice(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  call_id uuid not null references public.safety_calls(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  candidate_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists safety_call_ice_call_idx
  on public.safety_call_ice(call_id,created_at,id);

alter table public.safety_calls enable row level security;
alter table public.safety_call_ice enable row level security;

drop policy if exists safety_calls_select_participant on public.safety_calls;
create policy safety_calls_select_participant
on public.safety_calls for select to authenticated
using(
  private.is_household_member(household_id)
  and (caller_user_id=(select auth.uid()) or recipient_user_id=(select auth.uid()))
);

drop policy if exists safety_call_ice_select_participant on public.safety_call_ice;
create policy safety_call_ice_select_participant
on public.safety_call_ice for select to authenticated
using(
  exists(
    select 1
    from public.safety_calls c
    where c.id=call_id
      and c.household_id=safety_call_ice.household_id
      and (c.caller_user_id=(select auth.uid()) or c.recipient_user_id=(select auth.uid()))
  )
);

revoke all on public.safety_calls,public.safety_call_ice from public,anon;
grant select on public.safety_calls,public.safety_call_ice to authenticated;
grant all on public.safety_calls,public.safety_call_ice to service_role;

create or replace function public.start_safety_call_v1(
  p_alert_id uuid,
  p_recipient_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_household uuid;
  v_call uuid;
  v_name text:='Family member';
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select household_id into v_household
  from public.safety_alerts
  where id=p_alert_id
    and status='active';

  if v_household is null then raise exception 'Active safety alert not found'; end if;
  if not private.is_household_member(v_household) then raise exception 'Household access required'; end if;
  if p_recipient_user_id=v_user then raise exception 'Choose another household member'; end if;

  if not exists(
    select 1
    from public.household_members
    where household_id=v_household
      and user_id=p_recipient_user_id
      and status='active'
  ) then
    raise exception 'Recipient is not an active household member';
  end if;

  update public.safety_calls
  set status='ended',ended_at=now(),updated_at=now()
  where alert_id=p_alert_id
    and caller_user_id=v_user
    and recipient_user_id=p_recipient_user_id
    and status in ('ringing','accepted');

  insert into public.safety_calls(
    household_id,alert_id,caller_user_id,recipient_user_id,status
  )
  values(
    v_household,p_alert_id,v_user,p_recipient_user_id,'ringing'
  )
  returning id into v_call;

  select coalesce(fp.display_name,'Family member')
  into v_name
  from public.family_profiles fp
  where fp.household_id=v_household
    and fp.linked_user_id=v_user
    and fp.active
  order by fp.created_at
  limit 1;

  insert into public.notifications(
    household_id,recipient_user_id,notification_type,
    title,body,entity_type,entity_id,scheduled_for,status,source_key
  )
  values(
    v_household,
    p_recipient_user_id,
    'safety_call',
    'Safety call · '||coalesce(v_name,'Family member'),
    'Incoming Famioo internet call connected to an active SOS alert.',
    'safety_call',
    v_call,
    now(),
    'pending',
    'safety-call:'||v_call::text
  );

  return v_call;
end;
$$;

revoke all on function public.start_safety_call_v1(uuid,uuid) from public,anon;
grant execute on function public.start_safety_call_v1(uuid,uuid) to authenticated;

create or replace function public.set_safety_call_offer_v1(
  p_call_id uuid,
  p_offer_sdp text
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_offer_sdp),'') is null then raise exception 'Call offer is required'; end if;

  update public.safety_calls
  set offer_sdp=p_offer_sdp,
      updated_at=now()
  where id=p_call_id
    and caller_user_id=auth.uid()
    and status='ringing';

  if not found then raise exception 'Outgoing safety call not found'; end if;
  return true;
end;
$$;

revoke all on function public.set_safety_call_offer_v1(uuid,text) from public,anon;
grant execute on function public.set_safety_call_offer_v1(uuid,text) to authenticated;

create or replace function public.answer_safety_call_v1(
  p_call_id uuid,
  p_answer_sdp text
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_answer_sdp),'') is null then raise exception 'Call answer is required'; end if;

  update public.safety_calls
  set answer_sdp=p_answer_sdp,
      status='accepted',
      answered_at=coalesce(answered_at,now()),
      updated_at=now()
  where id=p_call_id
    and recipient_user_id=auth.uid()
    and status='ringing';

  if not found then raise exception 'Incoming safety call not found'; end if;
  return true;
end;
$$;

revoke all on function public.answer_safety_call_v1(uuid,text) from public,anon;
grant execute on function public.answer_safety_call_v1(uuid,text) to authenticated;

create or replace function public.add_safety_call_ice_v1(
  p_call_id uuid,
  p_candidate_json jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_household uuid;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_candidate_json is null or jsonb_typeof(p_candidate_json)<>'object' then
    raise exception 'ICE candidate is required';
  end if;

  select household_id into v_household
  from public.safety_calls
  where id=p_call_id
    and status in ('ringing','accepted')
    and (caller_user_id=auth.uid() or recipient_user_id=auth.uid());

  if v_household is null then raise exception 'Safety call not found'; end if;

  insert into public.safety_call_ice(
    household_id,call_id,user_id,candidate_json
  )
  values(v_household,p_call_id,auth.uid(),p_candidate_json)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.add_safety_call_ice_v1(uuid,jsonb) from public,anon;
grant execute on function public.add_safety_call_ice_v1(uuid,jsonb) to authenticated;

create or replace function public.end_safety_call_v1(
  p_call_id uuid,
  p_status text default 'ended'
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_status not in ('declined','ended','failed') then
    raise exception 'Invalid call end status';
  end if;

  update public.safety_calls
  set status=p_status,
      ended_at=now(),
      updated_at=now()
  where id=p_call_id
    and (caller_user_id=auth.uid() or recipient_user_id=auth.uid())
    and status in ('ringing','accepted');

  if not found then return false; end if;
  return true;
end;
$$;

revoke all on function public.end_safety_call_v1(uuid,text) from public,anon;
grant execute on function public.end_safety_call_v1(uuid,text) to authenticated;
