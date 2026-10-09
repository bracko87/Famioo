-- Famioo migration 100
-- Standalone AI shopping receipt capture.

alter table public.household_costs
  add column if not exists source_receipt_id uuid null references public.shopping_receipts(id) on delete set null;

create unique index if not exists household_costs_source_receipt_unique
  on public.household_costs(source_receipt_id)
  where source_receipt_id is not null;

alter table public.household_costs
  drop constraint if exists household_costs_source_type_check;
alter table public.household_costs
  add constraint household_costs_source_type_check
  check(source_type in ('manual','shopping','shopping_receipt','task','home_care','life_admin','projects','calendar_event','vehicle','pet'));

create or replace function public.save_standalone_shopping_receipt_v1(
  p_household_id uuid,
  p_total_cost numeric,
  p_currency text,
  p_receipt_store text,
  p_purchase_date date,
  p_file_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_ai_model text,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_receipt_id uuid;
  v_cost_id uuid;
  v_item jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'shopping','full') then raise exception 'Shopping write access required'; end if;
  if p_total_cost is null or p_total_cost < 0 then raise exception 'Receipt total is required'; end if;
  if nullif(trim(coalesce(p_file_path,'')),'') is null then raise exception 'Receipt file is required'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then raise exception 'Receipt items must be an array'; end if;

  insert into public.shopping_receipts(
    household_id,shopping_list_id,linked_cost_id,store_name,purchase_date,total_amount,currency,
    file_path,file_name,mime_type,file_size,extraction_status,ai_model,created_by_user_id
  )
  values(
    p_household_id,null,null,nullif(trim(coalesce(p_receipt_store,'')),''),
    coalesce(p_purchase_date,current_date),p_total_cost,coalesce(nullif(trim(p_currency),''),'EUR'),
    trim(p_file_path),nullif(trim(coalesce(p_file_name,'')),''),nullif(trim(coalesce(p_mime_type,'')),''),
    p_file_size,'reviewed',nullif(trim(coalesce(p_ai_model,'')),''),v_user
  )
  returning id into v_receipt_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
  loop
    if nullif(trim(coalesce(v_item->>'product_name','')),'') is null then continue; end if;
    insert into public.shopping_receipt_items(
      receipt_id,household_id,product_name,normalized_name,quantity,unit,unit_price,line_total,category
    )
    values(
      v_receipt_id,p_household_id,left(trim(v_item->>'product_name'),220),
      left(coalesce(nullif(trim(coalesce(v_item->>'normalized_name','')),''),trim(v_item->>'product_name')),220),
      case when nullif(v_item->>'quantity','') is null then null else greatest(0,(v_item->>'quantity')::numeric) end,
      nullif(left(trim(coalesce(v_item->>'unit','')),40),''),
      case when nullif(v_item->>'unit_price','') is null then null else greatest(0,(v_item->>'unit_price')::numeric) end,
      case when nullif(v_item->>'line_total','') is null then null else greatest(0,(v_item->>'line_total')::numeric) end,
      nullif(left(trim(coalesce(v_item->>'category','')),80),'')
    );
  end loop;

  if p_total_cost > 0 and private.has_module_access(p_household_id,'costs','full') then
    insert into public.household_costs(
      household_id,title,amount,currency,cost_date,cost_kind,source_type,source_receipt_id,
      notes,created_by_user_id,schedule_type,flow_type
    )
    values(
      p_household_id,
      case when nullif(trim(coalesce(p_receipt_store,'')),'') is null then 'Shopping receipt' else 'Shopping receipt · '||trim(p_receipt_store) end,
      p_total_cost,coalesce(nullif(trim(p_currency),''),'EUR'),coalesce(p_purchase_date,current_date),
      'additional','shopping_receipt',v_receipt_id,'Automatically created from uploaded shopping receipt.',v_user,'one_time','expense'
    )
    returning id into v_cost_id;

    update public.shopping_receipts set linked_cost_id=v_cost_id where id=v_receipt_id;
  end if;

  return jsonb_build_object('receipt_id',v_receipt_id,'cost_id',v_cost_id);
end;
$$;

revoke all on function public.save_standalone_shopping_receipt_v1(uuid,numeric,text,text,date,text,text,text,bigint,text,jsonb) from public,anon;
grant execute on function public.save_standalone_shopping_receipt_v1(uuid,numeric,text,text,date,text,text,text,bigint,text,jsonb) to authenticated;
