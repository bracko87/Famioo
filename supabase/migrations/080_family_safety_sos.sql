-- Famioo migration 080
-- Family Safety / SOS V1.
-- Core safety module: hold-to-SOS, optional location, household adult response, push/app notifications.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'safety',
  'Family Safety',
  'SOS alerts, trusted family response and optional emergency location sharing',
  'shield-alert',
  35,
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

-- Family Safety is a core module and every household role must be able to use it.
insert into public.module_role_permissions(
  household_id,module_code,role,access_level
)
select
  h.id,
  'safety',
  r.role,
  'full'
from public.households h
cross join (values ('owner'::text),('admin'::text),('user'::text)) as r(role)
on conflict(household_id,module_code,role)
do update set
  access_level='full',
  updated_at=now();

create table if not exists public.safety_alerts(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  triggered_by_user_id uuid not null references auth.users(id) on delete cascade,
  triggered_by_profile_id uuid,
  status text not null default 'active'
    check(status in ('active','resolved','cancelled')),
  triggered_at timestamptz not null default now(),
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  location_captured_at timestamptz,
  resolved_by_user_id uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_alert_profile_fk
    foreign key(household_id,triggered_by_profile_id)
    references public.family_profiles(household_id,id)
    on delete set null,
  constraint safety_alert_latitude_check
    check(latitude is null or latitude between -90 and 90),
  constraint safety_alert_longitude_check
    check(longitude is null or longitude between -180 and 180),
  constraint safety_alert_accuracy_check
    check(accuracy_m is null or accuracy_m >= 0),
  constraint safety_alert_location_pair_check
    check((latitude is null)=(longitude is null))
);

create unique index if not exists safety_alerts_one_active_per_user_uidx
  on public.safety_alerts(household_id,triggered_by_user_id)
  where status='active';

create index if not exists safety_alerts_household_status_idx
  on public.safety_alerts(household_id,status,triggered_at desc);

create table if not exists public.safety_alert_responses(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  alert_id uuid not null references public.safety_alerts(id) on delete cascade,
  responder_user_id uuid not null references auth.users(id) on delete cascade,
  response_type text not null default 'responding'
    check(response_type in ('responding')),
  responded_at timestamptz not null default now(),
  unique(alert_id,responder_user_id)
);

create index if not exists safety_alert_responses_household_alert_idx
  on public.safety_alert_responses(household_id,alert_id,responded_at);

alter table public.safety_alerts enable row level security;
alter table public.safety_alert_responses enable row level security;

drop policy if exists safety_alerts_select_household on public.safety_alerts;
create policy safety_alerts_select_household
on public.safety_alerts
for select to authenticated
using(private.is_household_member(household_id));

drop policy if exists safety_alert_responses_select_household on public.safety_alert_responses;
create policy safety_alert_responses_select_household
on public.safety_alert_responses
for select to authenticated
using(private.is_household_member(household_id));

revoke all on public.safety_alerts from public,anon;
revoke all on public.safety_alert_responses from public,anon;
grant select on public.safety_alerts to authenticated;
grant select on public.safety_alert_responses to authenticated;
grant all on public.safety_alerts,public.safety_alert_responses to service_role;

create or replace function private.is_safety_adult(
  p_household_id uuid,
  p_user_id uuid
)
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
      and hm.user_id=p_user_id
      and hm.status='active'
      and (
        hm.role in ('owner','admin')
        or exists(
          select 1
          from public.family_profiles fp
          where fp.household_id=hm.household_id
            and fp.linked_user_id=hm.user_id
            and fp.active
            and fp.profile_type='adult'
        )
      )
  );
$$;

revoke all on function private.is_safety_adult(uuid,uuid)
from public,anon,authenticated;

create or replace function public.trigger_safety_alert_v1(
  p_household_id uuid,
  p_profile_id uuid default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_m double precision default null
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_profile uuid;
  v_alert uuid;
  v_name text:='Family member';
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;

  if (p_latitude is null)<>(p_longitude is null) then
    raise exception 'Latitude and longitude must be provided together';
  end if;

  if p_latitude is not null and (p_latitude < -90 or p_latitude > 90) then
    raise exception 'Invalid latitude';
  end if;

  if p_longitude is not null and (p_longitude < -180 or p_longitude > 180) then
    raise exception 'Invalid longitude';
  end if;

  if p_accuracy_m is not null and p_accuracy_m < 0 then
    raise exception 'Invalid location accuracy';
  end if;

  if p_profile_id is not null then
    select fp.id,fp.display_name
    into v_profile,v_name
    from public.family_profiles fp
    where fp.id=p_profile_id
      and fp.household_id=p_household_id
      and fp.active
      and fp.linked_user_id=v_user;

    if v_profile is null then
      raise exception 'Use your own linked family profile for an SOS alert';
    end if;
  else
    select fp.id,fp.display_name
    into v_profile,v_name
    from public.family_profiles fp
    where fp.household_id=p_household_id
      and fp.active
      and fp.linked_user_id=v_user
    order by fp.created_at
    limit 1;

    v_name:=coalesce(v_name,'Family member');
  end if;

  select sa.id into v_alert
  from public.safety_alerts sa
  where sa.household_id=p_household_id
    and sa.triggered_by_user_id=v_user
    and sa.status='active'
  order by sa.triggered_at desc
  limit 1
  for update;

  if v_alert is null then
    insert into public.safety_alerts(
      household_id,triggered_by_user_id,triggered_by_profile_id,
      status,triggered_at,latitude,longitude,accuracy_m,location_captured_at
    )
    values(
      p_household_id,v_user,v_profile,
      'active',now(),p_latitude,p_longitude,p_accuracy_m,
      case when p_latitude is not null then now() else null end
    )
    returning id into v_alert;
  else
    update public.safety_alerts
    set triggered_by_profile_id=coalesce(triggered_by_profile_id,v_profile),
        latitude=coalesce(p_latitude,latitude),
        longitude=coalesce(p_longitude,longitude),
        accuracy_m=coalesce(p_accuracy_m,accuracy_m),
        location_captured_at=case
          when p_latitude is not null then now()
          else location_captured_at
        end,
        updated_at=now()
    where id=v_alert;
  end if;

  with preferred as (
    select hm.user_id
    from public.household_members hm
    where hm.household_id=p_household_id
      and hm.status='active'
      and hm.user_id<>v_user
      and private.is_safety_adult(p_household_id,hm.user_id)
  ),
  recipients as (
    select user_id from preferred
    union
    select hm.user_id
    from public.household_members hm
    where hm.household_id=p_household_id
      and hm.status='active'
      and hm.user_id<>v_user
      and not exists(select 1 from preferred)
  )
  insert into public.notifications(
    household_id,recipient_user_id,notification_type,
    title,body,entity_type,entity_id,scheduled_for,status,source_key
  )
  select
    p_household_id,
    r.user_id,
    'safety_sos',
    'SOS · '||v_name||' needs help',
    'Emergency family alert sent now.'
      ||case when p_latitude is not null then ' Location is available in Family Safety.' else '' end,
    'safety_alert',
    v_alert,
    now(),
    'pending',
    'safety-sos:'||v_alert::text||':'||r.user_id::text
  from recipients r
  on conflict(source_key) where source_key is not null do nothing;

  return v_alert;
end;
$$;

revoke all on function public.trigger_safety_alert_v1(
  uuid,uuid,double precision,double precision,double precision
) from public,anon;
grant execute on function public.trigger_safety_alert_v1(
  uuid,uuid,double precision,double precision,double precision
) to authenticated;

create or replace function public.respond_to_safety_alert_v1(
  p_alert_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_household uuid;
  v_trigger uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select household_id,triggered_by_user_id
  into v_household,v_trigger
  from public.safety_alerts
  where id=p_alert_id
    and status='active';

  if v_household is null then raise exception 'Active safety alert not found'; end if;
  if not private.is_safety_adult(v_household,v_user) then
    raise exception 'Only an adult household member can respond to an SOS alert';
  end if;
  if v_trigger=v_user then
    raise exception 'The person who triggered the alert cannot mark themselves as the responder';
  end if;

  insert into public.safety_alert_responses(
    household_id,alert_id,responder_user_id,response_type,responded_at
  )
  values(v_household,p_alert_id,v_user,'responding',now())
  on conflict(alert_id,responder_user_id)
  do update set responded_at=excluded.responded_at;

  return true;
end;
$$;

revoke all on function public.respond_to_safety_alert_v1(uuid) from public,anon;
grant execute on function public.respond_to_safety_alert_v1(uuid) to authenticated;

create or replace function public.resolve_safety_alert_v1(
  p_alert_id uuid,
  p_resolution_note text default null
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_household uuid;
  v_trigger uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select household_id,triggered_by_user_id
  into v_household,v_trigger
  from public.safety_alerts
  where id=p_alert_id
    and status='active'
  for update;

  if v_household is null then raise exception 'Active safety alert not found'; end if;

  if v_user<>v_trigger and not private.is_safety_adult(v_household,v_user) then
    raise exception 'Only the person who triggered the alert or an adult household member can resolve it';
  end if;

  update public.safety_alerts
  set status='resolved',
      resolved_by_user_id=v_user,
      resolved_at=now(),
      resolution_note=nullif(trim(p_resolution_note),''),
      updated_at=now()
  where id=p_alert_id;

  return true;
end;
$$;

revoke all on function public.resolve_safety_alert_v1(uuid,text) from public,anon;
grant execute on function public.resolve_safety_alert_v1(uuid,text) to authenticated;
