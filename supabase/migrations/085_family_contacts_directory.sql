-- Famioo migration 085
-- Family Contacts Directory V1.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'contacts',
  'Family Contacts',
  'Shared directory for family, doctors, school, babysitters, neighbours and emergency contacts',
  'contact-round',
  38,
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

insert into public.module_role_permissions(household_id,module_code,role,access_level)
select h.id,'contacts',r.role,'full'
from public.households h
cross join (values ('owner'::text),('admin'::text),('user'::text)) as r(role)
on conflict(household_id,module_code,role)
do update set access_level='full',updated_at=now();

create table if not exists public.family_contacts(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  contact_type text not null default 'other'
    check(contact_type in (
      'family','babysitter','doctor','pharmacy','school','kita',
      'neighbour','emergency','service','other'
    )),
  display_name text not null check(length(trim(display_name)) between 1 and 160),
  relation_label text,
  organisation text,
  phone text,
  secondary_phone text,
  email text,
  address_line text,
  postal_code text,
  city text,
  country text,
  website text,
  notes text,
  is_favourite boolean not null default false,
  is_emergency boolean not null default false,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  updated_by_user_id uuid not null references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(phone is null or length(trim(phone)) between 3 and 64),
  check(secondary_phone is null or length(trim(secondary_phone)) between 3 and 64),
  check(email is null or length(trim(email)) between 3 and 254),
  check(website is null or length(trim(website)) <= 500),
  check(notes is null or length(notes) <= 5000)
);

create index if not exists family_contacts_household_active_idx
  on public.family_contacts(household_id,active,is_favourite desc,display_name);

create index if not exists family_contacts_household_type_idx
  on public.family_contacts(household_id,contact_type,active);

alter table public.family_contacts enable row level security;

revoke all on public.family_contacts from public,anon,authenticated;
grant all on public.family_contacts to service_role;

create or replace function public.family_contacts_v1(
  p_household_id uuid
)
returns table(
  id uuid,
  contact_type text,
  display_name text,
  relation_label text,
  organisation text,
  phone text,
  secondary_phone text,
  email text,
  address_line text,
  postal_code text,
  city text,
  country text,
  website text,
  notes text,
  is_favourite boolean,
  is_emergency boolean,
  created_by_user_id uuid,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;

  return query
  select
    fc.id,
    fc.contact_type,
    fc.display_name,
    fc.relation_label,
    fc.organisation,
    fc.phone,
    fc.secondary_phone,
    fc.email,
    fc.address_line,
    fc.postal_code,
    fc.city,
    fc.country,
    fc.website,
    fc.notes,
    fc.is_favourite,
    fc.is_emergency,
    fc.created_by_user_id,
    fc.updated_at
  from public.family_contacts fc
  where fc.household_id=p_household_id
    and fc.active
  order by
    fc.is_emergency desc,
    fc.is_favourite desc,
    lower(fc.display_name);
end;
$$;

revoke all on function public.family_contacts_v1(uuid) from public,anon;
grant execute on function public.family_contacts_v1(uuid) to authenticated;

create or replace function public.save_family_contact_v1(
  p_household_id uuid,
  p_id uuid default null,
  p_contact_type text default 'other',
  p_display_name text default null,
  p_relation_label text default null,
  p_organisation text default null,
  p_phone text default null,
  p_secondary_phone text default null,
  p_email text default null,
  p_address_line text default null,
  p_postal_code text default null,
  p_city text default null,
  p_country text default null,
  p_website text default null,
  p_notes text default null,
  p_is_favourite boolean default false,
  p_is_emergency boolean default false
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;

  if p_contact_type not in (
    'family','babysitter','doctor','pharmacy','school','kita',
    'neighbour','emergency','service','other'
  ) then
    raise exception 'Invalid contact type';
  end if;

  if nullif(trim(coalesce(p_display_name,'')),'') is null then
    raise exception 'Contact name is required';
  end if;

  if p_email is not null
     and nullif(trim(p_email),'') is not null
     and trim(p_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'Use a valid email address';
  end if;

  if p_website is not null and length(trim(p_website))>500 then
    raise exception 'Website is too long';
  end if;

  if p_id is null then
    insert into public.family_contacts(
      household_id,contact_type,display_name,relation_label,organisation,
      phone,secondary_phone,email,address_line,postal_code,city,country,
      website,notes,is_favourite,is_emergency,
      created_by_user_id,updated_by_user_id,active,created_at,updated_at
    )
    values(
      p_household_id,p_contact_type,trim(p_display_name),
      nullif(trim(coalesce(p_relation_label,'')),''),
      nullif(trim(coalesce(p_organisation,'')),''),
      nullif(trim(coalesce(p_phone,'')),''),
      nullif(trim(coalesce(p_secondary_phone,'')),''),
      nullif(trim(coalesce(p_email,'')),''),
      nullif(trim(coalesce(p_address_line,'')),''),
      nullif(trim(coalesce(p_postal_code,'')),''),
      nullif(trim(coalesce(p_city,'')),''),
      nullif(trim(coalesce(p_country,'')),''),
      nullif(trim(coalesce(p_website,'')),''),
      nullif(trim(coalesce(p_notes,'')),''),
      coalesce(p_is_favourite,false),
      coalesce(p_is_emergency,false),
      v_user,v_user,true,now(),now()
    )
    returning id into v_id;
  else
    update public.family_contacts
    set contact_type=p_contact_type,
        display_name=trim(p_display_name),
        relation_label=nullif(trim(coalesce(p_relation_label,'')),''),
        organisation=nullif(trim(coalesce(p_organisation,'')),''),
        phone=nullif(trim(coalesce(p_phone,'')),''),
        secondary_phone=nullif(trim(coalesce(p_secondary_phone,'')),''),
        email=nullif(trim(coalesce(p_email,'')),''),
        address_line=nullif(trim(coalesce(p_address_line,'')),''),
        postal_code=nullif(trim(coalesce(p_postal_code,'')),''),
        city=nullif(trim(coalesce(p_city,'')),''),
        country=nullif(trim(coalesce(p_country,'')),''),
        website=nullif(trim(coalesce(p_website,'')),''),
        notes=nullif(trim(coalesce(p_notes,'')),''),
        is_favourite=coalesce(p_is_favourite,false),
        is_emergency=coalesce(p_is_emergency,false),
        updated_by_user_id=v_user,
        updated_at=now()
    where id=p_id
      and household_id=p_household_id
      and active
    returning id into v_id;

    if v_id is null then raise exception 'Contact not found'; end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_family_contact_v1(
  uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean
) from public,anon;
grant execute on function public.save_family_contact_v1(
  uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean
) to authenticated;

create or replace function public.archive_family_contact_v1(
  p_household_id uuid,
  p_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_household_member(p_household_id) then
    raise exception 'Household access required';
  end if;

  update public.family_contacts
  set active=false,
      updated_by_user_id=auth.uid(),
      updated_at=now()
  where household_id=p_household_id
    and id=p_id
    and active;

  return found;
end;
$$;

revoke all on function public.archive_family_contact_v1(uuid,uuid) from public,anon;
grant execute on function public.archive_family_contact_v1(uuid,uuid) to authenticated;
