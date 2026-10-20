-- Famioo migration 110
-- Family SOS: notify every other active logged-in household member.
-- This changes only recipient selection. No table/data deletion and no
-- emergency-service autodial. Existing active SOS records stay intact.
-- Apply to the Famioo Supabase project as a separately approved backend release.
--
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

  -- Notify every other active household login, not only the adult-priority
  -- subset. The on-device notification still depends on push permission,
  -- subscription and the scheduled delivery worker.
  insert into public.notifications(
    household_id,recipient_user_id,notification_type,
    title,body,entity_type,entity_id,scheduled_for,status,source_key
  )
  select
    p_household_id,
    hm.user_id,
    'safety_sos',
    'SOS · '||v_name||' needs help',
    'Emergency family alert sent now.'
      ||case when p_latitude is not null then ' Location is available in Family Safety.' else '' end,
    'safety_alert',
    v_alert,
    now(),
    'pending',
    'safety-sos:'||v_alert::text||':'||hm.user_id::text
  from public.household_members hm
  where hm.household_id=p_household_id
    and hm.status='active'
    and hm.user_id<>v_user
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

