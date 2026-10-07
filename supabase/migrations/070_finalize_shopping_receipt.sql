-- Famioo migration 070
-- Finish a shopping trip atomically: archive list, create Household Cost summary,
-- and persist reviewed receipt data for long-term analytics.

create or replace function public.finalize_shopping_v2(
  p_shopping_list_id uuid,
  p_household_id uuid,
  p_total_cost numeric default null,
  p_currency text default 'EUR',
  p_receipt_store text default null,
  p_purchase_date date default null,
  p_file_path text default null,
  p_file_name text default null,
  p_mime_type text default null,
  p_file_size bigint default null,
  p_extraction_status text default 'manual',
  p_ai_model text default null,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_receipt_id uuid;
  v_cost_id uuid;
  v_item jsonb;
  v_has_receipt boolean;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'shopping','full') then
    raise exception 'Shopping write access required';
  end if;
  if p_extraction_status not in ('manual','pending','reviewed','failed') then
    raise exception 'Invalid receipt extraction status';
  end if;
  if p_total_cost is not null and p_total_cost < 0 then
    raise exception 'Cost cannot be negative';
  end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then
    raise exception 'Receipt items must be an array';
  end if;

  perform public.archive_shopping_list_v1(
    p_shopping_list_id,
    p_household_id,
    p_total_cost,
    coalesce(nullif(trim(p_currency),''),'EUR')
  );

  if p_total_cost is not null and p_total_cost > 0 then
    select id into v_cost_id
    from public.household_costs
    where household_id=p_household_id
      and source_type='shopping'
      and source_shopping_list_id=p_shopping_list_id
    order by created_at desc
    limit 1;
  end if;

  v_has_receipt :=
    nullif(trim(coalesce(p_receipt_store,'')),'') is not null
    or nullif(trim(coalesce(p_file_path,'')),'') is not null
    or jsonb_array_length(coalesce(p_items,'[]'::jsonb)) > 0;

  if v_has_receipt then
    insert into public.shopping_receipts(
      household_id,shopping_list_id,linked_cost_id,
      store_name,purchase_date,total_amount,currency,
      file_path,file_name,mime_type,file_size,
      extraction_status,ai_model,created_by_user_id
    )
    values(
      p_household_id,p_shopping_list_id,v_cost_id,
      nullif(trim(coalesce(p_receipt_store,'')),''),
      coalesce(p_purchase_date,current_date),
      p_total_cost,
      coalesce(nullif(trim(p_currency),''),'EUR'),
      nullif(trim(coalesce(p_file_path,'')),''),
      nullif(trim(coalesce(p_file_name,'')),''),
      nullif(trim(coalesce(p_mime_type,'')),''),
      p_file_size,
      p_extraction_status,
      nullif(trim(coalesce(p_ai_model,'')),''),
      v_user
    )
    returning id into v_receipt_id;

    for v_item in
      select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
    loop
      if nullif(trim(coalesce(v_item->>'product_name','')),'') is null then
        continue;
      end if;

      insert into public.shopping_receipt_items(
        receipt_id,household_id,product_name,normalized_name,
        quantity,unit,unit_price,line_total,category
      )
      values(
        v_receipt_id,
        p_household_id,
        left(trim(v_item->>'product_name'),220),
        left(
          coalesce(
            nullif(trim(coalesce(v_item->>'normalized_name','')),''),
            trim(v_item->>'product_name')
          ),
          220
        ),
        case when nullif(v_item->>'quantity','') is null then null else greatest(0,(v_item->>'quantity')::numeric) end,
        nullif(left(trim(coalesce(v_item->>'unit','')),40),''),
        case when nullif(v_item->>'unit_price','') is null then null else greatest(0,(v_item->>'unit_price')::numeric) end,
        case when nullif(v_item->>'line_total','') is null then null else greatest(0,(v_item->>'line_total')::numeric) end,
        nullif(left(trim(coalesce(v_item->>'category','')),80),'')
      );
    end loop;
  end if;

  return jsonb_build_object(
    'receipt_id',v_receipt_id,
    'cost_id',v_cost_id
  );
end;
$$;

revoke all on function public.finalize_shopping_v2(
  uuid,uuid,numeric,text,text,date,text,text,text,bigint,text,text,jsonb
) from public,anon;
grant execute on function public.finalize_shopping_v2(
  uuid,uuid,numeric,text,text,date,text,text,text,bigint,text,text,jsonb
) to authenticated;
