-- Famioo migration 031
-- Home Care asset purchases can optionally post one-time costs to Household Costs.

alter table public.home_care_assets
  add column if not exists purchase_cost_id uuid
    references public.household_costs(id) on delete set null;

alter table public.household_costs
  add column if not exists source_home_care_asset_id uuid
    references public.home_care_assets(id) on delete set null;

create unique index if not exists household_costs_home_care_asset_uidx
  on public.household_costs(source_home_care_asset_id)
  where source_home_care_asset_id is not null;

create or replace function public.save_home_asset_v1(
  p_id uuid,
  p_household_id uuid,
  p_name text,
  p_asset_type text,
  p_room_location text,
  p_brand text,
  p_model text,
  p_serial_number text,
  p_purchase_date date,
  p_purchase_price numeric,
  p_retailer text,
  p_warranty_until date,
  p_responsible_profile_id uuid,
  p_notes text,
  p_include_cost boolean
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_id uuid;
  v_existing_cost uuid;
  v_cost_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  if not private.has_module_access(p_household_id,'home_care','full') then
    raise exception 'Home Care write access required';
  end if;

  if nullif(trim(p_name),'') is null then
    raise exception 'Asset name is required';
  end if;

  if p_purchase_price is not null and p_purchase_price < 0 then
    raise exception 'Purchase price cannot be negative';
  end if;

  if p_responsible_profile_id is not null and not exists(
    select 1
    from public.family_profiles
    where id=p_responsible_profile_id
      and household_id=p_household_id
      and active
  ) then
    raise exception 'Responsible household member not found';
  end if;

  if p_include_cost then
    if p_purchase_price is null or p_purchase_price <= 0 then
      raise exception 'Enter a purchase price before adding it to Household Costs';
    end if;

    if not private.has_module_access(p_household_id,'costs','full') then
      raise exception 'Household Costs write access required';
    end if;
  end if;

  if p_id is null then
    insert into public.home_care_assets(
      household_id,name,asset_type,room_location,brand,model,serial_number,
      purchase_date,purchase_price,retailer,warranty_until,responsible_profile_id,
      notes,created_by_user_id
    )
    values(
      p_household_id,
      trim(p_name),
      coalesce(nullif(trim(p_asset_type),''),'Other'),
      nullif(trim(p_room_location),''),
      nullif(trim(p_brand),''),
      nullif(trim(p_model),''),
      nullif(trim(p_serial_number),''),
      p_purchase_date,
      p_purchase_price,
      nullif(trim(p_retailer),''),
      p_warranty_until,
      p_responsible_profile_id,
      nullif(trim(p_notes),''),
      auth.uid()
    )
    returning id into v_id;
  else
    select id,purchase_cost_id
      into v_id,v_existing_cost
    from public.home_care_assets
    where id=p_id
      and household_id=p_household_id
      and active
    for update;

    if v_id is null then
      raise exception 'Asset not found';
    end if;

    update public.home_care_assets
    set name=trim(p_name),
        asset_type=coalesce(nullif(trim(p_asset_type),''),'Other'),
        room_location=nullif(trim(p_room_location),''),
        brand=nullif(trim(p_brand),''),
        model=nullif(trim(p_model),''),
        serial_number=nullif(trim(p_serial_number),''),
        purchase_date=p_purchase_date,
        purchase_price=p_purchase_price,
        retailer=nullif(trim(p_retailer),''),
        warranty_until=p_warranty_until,
        responsible_profile_id=p_responsible_profile_id,
        notes=nullif(trim(p_notes),''),
        updated_at=now()
    where id=v_id;
  end if;

  if p_include_cost then
    select id into v_cost_id
    from public.household_costs
    where household_id=p_household_id
      and source_home_care_asset_id=v_id
    limit 1;

    if v_cost_id is null then
      v_cost_id:=v_existing_cost;
    end if;

    if v_cost_id is null then
      insert into public.household_costs(
        household_id,title,amount,currency,cost_date,cost_kind,source_type,
        source_home_care_asset_id,notes,schedule_type,created_by_user_id
      )
      values(
        p_household_id,
        'Home Care: '||trim(p_name)||' purchase',
        p_purchase_price,
        'EUR',
        coalesce(p_purchase_date,current_date),
        'additional',
        'home_care',
        v_id,
        'Purchase price from Home Care asset',
        'one_time',
        auth.uid()
      )
      returning id into v_cost_id;
    else
      update public.household_costs
      set title='Home Care: '||trim(p_name)||' purchase',
          amount=p_purchase_price,
          currency='EUR',
          cost_date=coalesce(p_purchase_date,current_date),
          cost_kind='additional',
          source_type='home_care',
          source_home_care_asset_id=v_id,
          notes='Purchase price from Home Care asset',
          schedule_type='one_time',
          schedule_day=null,
          updated_at=now()
      where id=v_cost_id
        and household_id=p_household_id;
    end if;

    update public.home_care_assets
    set purchase_cost_id=v_cost_id,updated_at=now()
    where id=v_id;
  else
    if v_existing_cost is not null then
      if not private.has_module_access(p_household_id,'costs','full') then
        raise exception 'Household Costs write access required to remove the linked purchase cost';
      end if;

      delete from public.household_costs
      where id=v_existing_cost
        and household_id=p_household_id;

      update public.home_care_assets
      set purchase_cost_id=null,updated_at=now()
      where id=v_id;
    else
      delete from public.household_costs
      where household_id=p_household_id
        and source_home_care_asset_id=v_id;

      update public.home_care_assets
      set purchase_cost_id=null,updated_at=now()
      where id=v_id;
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_home_asset_v1(
  uuid,uuid,text,text,text,text,text,text,date,numeric,text,date,uuid,text,boolean
) from public;

grant execute on function public.save_home_asset_v1(
  uuid,uuid,text,text,text,text,text,text,date,numeric,text,date,uuid,text,boolean
) to authenticated;
