-- Famioo migration 106
-- Final QR Scanner naming/icon + reliable client-generated pet IDs for photo uploads.

update public.modules
set icon_key='qr-code'
where code='tickets';

create or replace function public.save_family_pet_v1(
  p_id uuid,
  p_household_id uuid,
  p_name text,
  p_species text,
  p_breed text default null,
  p_sex text default null,
  p_birth_date date default null,
  p_chip_number text default null,
  p_weight_kg numeric default null,
  p_color_markings text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'pets','full') then raise exception 'Pet write access required'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Pet name is required'; end if;
  if nullif(trim(coalesce(p_species,'')),'') is null then raise exception 'Species is required'; end if;
  if p_sex is not null and p_sex not in ('female','male','unknown') then raise exception 'Invalid sex'; end if;
  if p_weight_kg is not null and p_weight_kg<0 then raise exception 'Weight cannot be negative'; end if;

  if p_id is null then
    insert into public.family_pets(
      household_id,name,species,breed,sex,birth_date,chip_number,weight_kg,color_markings,notes,created_by_user_id
    ) values(
      p_household_id,trim(p_name),trim(p_species),nullif(trim(coalesce(p_breed,'')),''),
      p_sex,p_birth_date,nullif(trim(coalesce(p_chip_number,'')),''),
      p_weight_kg,nullif(trim(coalesce(p_color_markings,'')),''),
      nullif(trim(coalesce(p_notes,'')),''),auth.uid()
    ) returning id into v_id;
  elsif exists(select 1 from public.family_pets where id=p_id and household_id=p_household_id) then
    update public.family_pets
    set name=trim(p_name),species=trim(p_species),breed=nullif(trim(coalesce(p_breed,'')),''),
        sex=p_sex,birth_date=p_birth_date,chip_number=nullif(trim(coalesce(p_chip_number,'')),''),
        weight_kg=p_weight_kg,color_markings=nullif(trim(coalesce(p_color_markings,'')),''),
        notes=nullif(trim(coalesce(p_notes,'')),''),updated_at=now()
    where id=p_id and household_id=p_household_id
    returning id into v_id;
  elsif exists(select 1 from public.family_pets where id=p_id) then
    raise exception 'Pet id unavailable';
  else
    insert into public.family_pets(
      id,household_id,name,species,breed,sex,birth_date,chip_number,weight_kg,color_markings,notes,created_by_user_id
    ) values(
      p_id,p_household_id,trim(p_name),trim(p_species),nullif(trim(coalesce(p_breed,'')),''),
      p_sex,p_birth_date,nullif(trim(coalesce(p_chip_number,'')),''),
      p_weight_kg,nullif(trim(coalesce(p_color_markings,'')),''),
      nullif(trim(coalesce(p_notes,'')),''),auth.uid()
    ) returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_family_pet_v1(uuid,uuid,text,text,text,text,date,text,numeric,text,text) from public,anon;
grant execute on function public.save_family_pet_v1(uuid,uuid,text,text,text,text,date,text,numeric,text,text) to authenticated;
