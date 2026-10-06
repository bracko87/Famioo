-- Famioo migration 050
-- Storage reward threshold: €3.00/month or more keeps 10 GB; downgrade happens below €3.00.

create or replace function public.files_storage_entitlement_v1(p_household_id uuid)
returns table(
  used_bytes bigint,
  quota_bytes bigint,
  paid_monthly_eur numeric,
  storage_tier text,
  can_upload boolean,
  needs_storage_offer boolean,
  storage_addon_price_eur numeric,
  downgrade_grace_until timestamptz
)
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_used bigint;
  v_paid numeric;
  v_addon boolean;
  v_grace timestamptz;
  v_quota bigint;
  v_tier text;
  v_can_upload boolean;
  v_offer boolean;
begin
  if auth.uid() is null or not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;

  select coalesce(sum(file_size),0)::bigint
  into v_used
  from public.household_files
  where household_id=p_household_id
    and status in ('pending','active');

  v_paid:=private.paid_module_monthly_total_v1(p_household_id);
  v_addon:=private.has_active_storage_addon_v1(p_household_id);

  select hss.downgrade_grace_until
  into v_grace
  from public.household_storage_settings hss
  where hss.household_id=p_household_id;

  if v_paid>=3.00 then
    v_quota:=10737418240;
    v_tier:='paid_10gb';
    v_can_upload:=v_used<v_quota;
    v_offer:=false;
  elsif v_addon then
    v_quota:=10737418240;
    v_tier:='addon_10gb';
    v_can_upload:=v_used<v_quota;
    v_offer:=false;
  elsif v_grace is not null and v_grace>now() then
    v_quota:=case when v_used>1073741824 then 10737418240 else 1073741824 end;
    v_tier:=case when v_used>1073741824 then 'downgrade_grace' else 'free_1gb' end;
    v_can_upload:=v_used<1073741824;
    v_offer:=true;
  else
    v_quota:=1073741824;
    v_tier:='free_1gb';
    v_can_upload:=v_used<v_quota;
    v_offer:=v_used>1073741824;
  end if;

  return query
  select
    v_used,
    v_quota,
    v_paid,
    v_tier,
    v_can_upload,
    v_offer,
    coalesce((select followup_price_eur from public.billing_products where product_code='storage_10gb'),0.49),
    v_grace;
end;
$$;


create or replace function private.refresh_storage_grace_v1(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_paid numeric;
  v_addon boolean;
  v_last_qualified timestamptz;
  v_grace timestamptz;
  v_new_grace timestamptz;
  v_event_key text;
begin
  insert into public.household_storage_settings(household_id)
  values(p_household_id)
  on conflict(household_id) do nothing;

  v_paid:=private.paid_module_monthly_total_v1(p_household_id);
  v_addon:=private.has_active_storage_addon_v1(p_household_id);

  select last_qualified_at,downgrade_grace_until
  into v_last_qualified,v_grace
  from public.household_storage_settings
  where household_id=p_household_id
  for update;

  if v_paid>=3.00 then
    update public.household_storage_settings
    set downgrade_grace_until=null,
        last_qualified_at=now(),
        updated_at=now()
    where household_id=p_household_id;

  elsif v_addon then
    update public.household_storage_settings
    set downgrade_grace_until=null,
        last_qualified_at=null,
        updated_at=now()
    where household_id=p_household_id;

  elsif v_last_qualified is not null then
    v_new_grace:=now()+interval '30 days';
    v_event_key:=to_char(v_new_grace at time zone 'UTC','YYYYMMDDHH24MISSMS');

    update public.household_storage_settings
    set downgrade_grace_until=v_new_grace,
        last_qualified_at=null,
        updated_at=now()
    where household_id=p_household_id;

    insert into public.system_email_deliveries(
      household_id,user_id,kind,event_key,recipient_email,payload_json,scheduled_for
    )
    select
      p_household_id,
      hm.user_id,
      'storage_downgrade',
      v_event_key,
      u.email,
      jsonb_build_object(
        'paid_monthly_eur',v_paid,
        'free_storage_gb',1,
        'retained_storage_gb',10,
        'storage_addon_price_eur',coalesce(
          (select followup_price_eur from public.billing_products where product_code='storage_10gb'),
          0.49
        ),
        'grace_until',v_new_grace
      ),
      now()
    from public.household_members hm
    join auth.users u on u.id=hm.user_id
    where hm.household_id=p_household_id
      and hm.status='active'
      and hm.role='owner'
      and nullif(trim(u.email),'') is not null
    on conflict(household_id,user_id,kind,event_key) do nothing;

  else
    update public.household_storage_settings
    set updated_at=now()
    where household_id=p_household_id;
  end if;
end;
$$;
