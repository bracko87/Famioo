-- Famioo migration 093
-- Emergency Information V1.
-- Authenticated household-only medical/safety information with fast guardian access.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'emergency_info',
  'Emergency Information',
  'Emergency contacts, doctors, insurance and important family medical and safety notes',
  'badge-alert',
  45,
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
select h.id,'emergency_info',r.role,'full'
from public.households h
cross join (values ('owner'::text),('admin'::text),('user'::text)) as r(role)
on conflict(household_id,module_code,role)
do update set access_level='full',updated_at=now();

create table if not exists public.family_emergency_profiles(
  profile_id uuid primary key references public.family_profiles(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  blood_type text,
  allergies text,
  medications text,
  medical_notes text,
  safety_notes text,
  primary_doctor_contact_id uuid references public.family_contacts(id) on delete set null,
  insurance_provider text,
  insurance_member_number text,
  insurance_policy_number text,
  insurance_phone text,
  insurance_notes text,
  created_by_user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  updated_by_user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists family_emergency_profiles_household_idx
  on public.family_emergency_profiles(household_id,profile_id);

create table if not exists public.family_emergency_guardians(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  profile_id uuid not null references public.family_profiles(id) on delete cascade,
  contact_id uuid not null references public.family_contacts(id) on delete cascade,
  relation_label text,
  priority smallint not null default 1 check(priority between 1 and 10),
  notes text,
  created_by_user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id,contact_id)
);

create index if not exists family_emergency_guardians_household_idx
  on public.family_emergency_guardians(household_id,profile_id,priority,id);

alter table public.family_emergency_profiles enable row level security;
alter table public.family_emergency_guardians enable row level security;

drop policy if exists family_emergency_profiles_read on public.family_emergency_profiles;
create policy family_emergency_profiles_read
on public.family_emergency_profiles
for select to authenticated
using(
  private.has_module_access(household_id,'emergency_info','read')
  and exists(
    select 1 from public.family_profiles fp
    where fp.id=profile_id and fp.household_id=household_id and fp.active
  )
);

drop policy if exists family_emergency_profiles_write on public.family_emergency_profiles;
create policy family_emergency_profiles_write
on public.family_emergency_profiles
for all to authenticated
using(
  private.has_module_access(household_id,'emergency_info','full')
  and exists(
    select 1 from public.family_profiles fp
    where fp.id=profile_id and fp.household_id=household_id and fp.active
  )
)
with check(
  private.has_module_access(household_id,'emergency_info','full')
  and exists(
    select 1 from public.family_profiles fp
    where fp.id=profile_id and fp.household_id=household_id and fp.active
  )
  and (
    primary_doctor_contact_id is null
    or exists(
      select 1 from public.family_contacts fc
      where fc.id=primary_doctor_contact_id and fc.household_id=household_id and fc.active
    )
  )
);

drop policy if exists family_emergency_guardians_read on public.family_emergency_guardians;
create policy family_emergency_guardians_read
on public.family_emergency_guardians
for select to authenticated
using(
  private.has_module_access(household_id,'emergency_info','read')
  and exists(
    select 1 from public.family_profiles fp
    where fp.id=profile_id and fp.household_id=household_id and fp.active
  )
  and exists(
    select 1 from public.family_contacts fc
    where fc.id=contact_id and fc.household_id=household_id and fc.active
  )
);

drop policy if exists family_emergency_guardians_write on public.family_emergency_guardians;
create policy family_emergency_guardians_write
on public.family_emergency_guardians
for all to authenticated
using(
  private.has_module_access(household_id,'emergency_info','full')
)
with check(
  private.has_module_access(household_id,'emergency_info','full')
  and exists(
    select 1 from public.family_profiles fp
    where fp.id=profile_id and fp.household_id=household_id and fp.active
  )
  and exists(
    select 1 from public.family_contacts fc
    where fc.id=contact_id and fc.household_id=household_id and fc.active
  )
);

grant select,insert,update,delete on public.family_emergency_profiles,public.family_emergency_guardians to authenticated;

create or replace function public.save_family_emergency_profile_v1(
  p_household_id uuid,
  p_profile_id uuid,
  p_blood_type text default null,
  p_allergies text default null,
  p_medications text default null,
  p_medical_notes text default null,
  p_safety_notes text default null,
  p_primary_doctor_contact_id uuid default null,
  p_insurance_provider text default null,
  p_insurance_member_number text default null,
  p_insurance_policy_number text default null,
  p_insurance_phone text default null,
  p_insurance_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'emergency_info','full') then
    raise exception 'Emergency Information write access required';
  end if;
  if not exists(
    select 1 from public.family_profiles fp
    where fp.id=p_profile_id and fp.household_id=p_household_id and fp.active
  ) then raise exception 'Family profile not found'; end if;

  if p_primary_doctor_contact_id is not null and not exists(
    select 1 from public.family_contacts fc
    where fc.id=p_primary_doctor_contact_id and fc.household_id=p_household_id and fc.active
  ) then raise exception 'Doctor contact not found'; end if;

  insert into public.family_emergency_profiles(
    profile_id,household_id,blood_type,allergies,medications,medical_notes,safety_notes,
    primary_doctor_contact_id,insurance_provider,insurance_member_number,insurance_policy_number,
    insurance_phone,insurance_notes,created_by_user_id,updated_by_user_id
  )
  values(
    p_profile_id,p_household_id,nullif(trim(p_blood_type),''),nullif(trim(p_allergies),''),
    nullif(trim(p_medications),''),nullif(trim(p_medical_notes),''),nullif(trim(p_safety_notes),''),
    p_primary_doctor_contact_id,nullif(trim(p_insurance_provider),''),nullif(trim(p_insurance_member_number),''),
    nullif(trim(p_insurance_policy_number),''),nullif(trim(p_insurance_phone),''),
    nullif(trim(p_insurance_notes),''),auth.uid(),auth.uid()
  )
  on conflict(profile_id) do update set
    household_id=excluded.household_id,
    blood_type=excluded.blood_type,
    allergies=excluded.allergies,
    medications=excluded.medications,
    medical_notes=excluded.medical_notes,
    safety_notes=excluded.safety_notes,
    primary_doctor_contact_id=excluded.primary_doctor_contact_id,
    insurance_provider=excluded.insurance_provider,
    insurance_member_number=excluded.insurance_member_number,
    insurance_policy_number=excluded.insurance_policy_number,
    insurance_phone=excluded.insurance_phone,
    insurance_notes=excluded.insurance_notes,
    updated_by_user_id=auth.uid(),
    updated_at=now();

  return p_profile_id;
end;
$$;

create or replace function public.save_family_emergency_guardian_v1(
  p_household_id uuid,
  p_id uuid,
  p_profile_id uuid,
  p_contact_id uuid,
  p_relation_label text default null,
  p_priority integer default 1,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path=public,private,pg_temp
as $$
declare v_id uuid:=coalesce(p_id,gen_random_uuid());
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'emergency_info','full') then
    raise exception 'Emergency Information write access required';
  end if;
  if not exists(
    select 1 from public.family_profiles fp
    where fp.id=p_profile_id and fp.household_id=p_household_id and fp.active
  ) then raise exception 'Family profile not found'; end if;
  if not exists(
    select 1 from public.family_contacts fc
    where fc.id=p_contact_id and fc.household_id=p_household_id and fc.active
  ) then raise exception 'Emergency contact not found'; end if;

  insert into public.family_emergency_guardians(
    id,household_id,profile_id,contact_id,relation_label,priority,notes,created_by_user_id
  )
  values(
    v_id,p_household_id,p_profile_id,p_contact_id,nullif(trim(p_relation_label),''),
    greatest(1,least(coalesce(p_priority,1),10)),nullif(trim(p_notes),''),auth.uid()
  )
  on conflict(id) do update set
    profile_id=excluded.profile_id,
    contact_id=excluded.contact_id,
    relation_label=excluded.relation_label,
    priority=excluded.priority,
    notes=excluded.notes,
    updated_at=now();

  return v_id;
end;
$$;

create or replace function public.delete_family_emergency_guardian_v1(
  p_household_id uuid,
  p_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'emergency_info','full') then
    raise exception 'Emergency Information write access required';
  end if;

  delete from public.family_emergency_guardians
  where id=p_id and household_id=p_household_id;

  return found;
end;
$$;

revoke all on function public.save_family_emergency_profile_v1(uuid,uuid,text,text,text,text,text,uuid,text,text,text,text,text) from public,anon;
revoke all on function public.save_family_emergency_guardian_v1(uuid,uuid,uuid,uuid,text,integer,text) from public,anon;
revoke all on function public.delete_family_emergency_guardian_v1(uuid,uuid) from public,anon;
grant execute on function public.save_family_emergency_profile_v1(uuid,uuid,text,text,text,text,text,uuid,text,text,text,text,text) to authenticated;
grant execute on function public.save_family_emergency_guardian_v1(uuid,uuid,uuid,uuid,text,integer,text) to authenticated;
grant execute on function public.delete_family_emergency_guardian_v1(uuid,uuid) to authenticated;
