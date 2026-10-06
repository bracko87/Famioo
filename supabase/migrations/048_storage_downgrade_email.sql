-- Famioo migration 048
-- Queue transactional email when a household loses the >€3/month 10 GB storage reward.

create table if not exists public.system_email_deliveries(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in ('storage_downgrade')),
  event_key text not null,
  recipient_email text not null,
  payload_json jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz not null default now(),
  status text not null default 'pending'
    check(status in ('pending','sending','sent','failed','expired')),
  attempts integer not null default 0 check(attempts>=0),
  last_attempt_at timestamptz null,
  provider_status integer null,
  provider_response jsonb null,
  error_text text null,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(household_id,user_id,kind,event_key)
);

create index if not exists system_email_deliveries_due_idx
on public.system_email_deliveries(status,scheduled_for,created_at);

alter table public.system_email_deliveries enable row level security;

drop policy if exists system_email_deliveries_admin_read on public.system_email_deliveries;
create policy system_email_deliveries_admin_read
on public.system_email_deliveries
for select
to authenticated
using(private.is_household_admin_or_owner(household_id));

grant select on public.system_email_deliveries to authenticated;


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

  if v_paid>3.00 then
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
    -- Household just crossed from the rewarded 10 GB tier to <= €3/month.
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
