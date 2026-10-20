-- Migration 115. Medical & Safety guardian policies used direct SELECTs
-- from the private family_contacts table, which authenticated clients cannot
-- read. Fix through a narrow membership-checked SECURITY DEFINER helper.
-- Never grant direct SELECT on family_contacts to authenticated users.
create or replace function private.emergency_contact_in_household(
  p_household_id uuid,p_contact_id uuid
)
returns boolean language sql stable security definer
set search_path=public,private,pg_temp
as $$
  select auth.uid() is not null
    and private.is_household_member(p_household_id)
    and exists (
      select 1 from public.family_contacts fc
      where fc.household_id=p_household_id and fc.id=p_contact_id and fc.active
    );
$$;
revoke all on function private.emergency_contact_in_household(uuid,uuid) from public,anon;
grant execute on function private.emergency_contact_in_household(uuid,uuid) to authenticated;

drop policy if exists family_emergency_profiles_write on public.family_emergency_profiles;
create policy family_emergency_profiles_write
on public.family_emergency_profiles for all to authenticated
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
  and(
    primary_doctor_contact_id is null
    or private.emergency_contact_in_household(household_id,primary_doctor_contact_id)
  )
);

drop policy if exists family_emergency_guardians_read on public.family_emergency_guardians;
create policy family_emergency_guardians_read
on public.family_emergency_guardians for select to authenticated
using(
  private.has_module_access(household_id,'emergency_info','read')
  and exists(
    select 1 from public.family_profiles fp
    where fp.id=profile_id and fp.household_id=household_id and fp.active
  )
  and private.emergency_contact_in_household(household_id,contact_id)
);

drop policy if exists family_emergency_guardians_write on public.family_emergency_guardians;
create policy family_emergency_guardians_write
on public.family_emergency_guardians for all to authenticated
using(private.has_module_access(household_id,'emergency_info','full'))
with check(
  private.has_module_access(household_id,'emergency_info','full')
  and exists(
    select 1 from public.family_profiles fp
    where fp.id=profile_id and fp.household_id=household_id and fp.active
  )
  and private.emergency_contact_in_household(household_id,contact_id)
);

-- Both original SECURITY INVOKER RPCs still verify Emergency Information
-- permissions and profile membership. Replace only their forbidden directory
-- lookups, leaving all data writes and other checks intact.
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

  if p_primary_doctor_contact_id is not null
     and not private.emergency_contact_in_household(p_household_id,p_primary_doctor_contact_id)
  then raise exception 'Doctor contact not found'; end if;

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
  if not private.emergency_contact_in_household(p_household_id,p_contact_id)
  then raise exception 'Emergency contact not found'; end if;

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

-- Test: load Medical & Safety with ordinary household JWT; add/edit
-- doctor/guardian; access other households denied; direct family_contacts
-- SELECT still denied. No existing rows are changed by this migration.
