-- Famioo migration 058
-- Vaccination Calendar module for child profiles.
-- Germany-first baseline using the STIKO 2026 standard schedule.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'vaccinations',
  'Vaccinations & Check-ups',
  'German child vaccination planning and U/J preventive check-up calendar',
  'vaccinations',
  65,
  false,
  true
)
on conflict(code) do update set
  name=excluded.name,
  description=excluded.description,
  icon_key=excluded.icon_key,
  sort_order=excluded.sort_order,
  is_core=false,
  is_active=true;

insert into public.billing_products(
  product_code,name,product_kind,module_code,
  first_purchase_price_eur,followup_price_eur,
  included_ai_requests,extra_storage_bytes,
  qualifies_for_storage_threshold,active,sort_order
)
values(
  'module_vaccinations',
  'Vaccinations & Check-ups',
  'module',
  'vaccinations',
  0.99,
  null,
  0,
  0,
  true,
  true,
  65
)
on conflict(product_code) do update set
  name=excluded.name,
  product_kind=excluded.product_kind,
  module_code=excluded.module_code,
  first_purchase_price_eur=excluded.first_purchase_price_eur,
  followup_price_eur=excluded.followup_price_eur,
  qualifies_for_storage_threshold=excluded.qualifies_for_storage_threshold,
  active=true,
  sort_order=excluded.sort_order,
  updated_at=now();

-- Existing development households receive the module as a launch preview.
-- New households still use the normal entitlement/purchase flow.
insert into public.household_modules(
  household_id,module_code,enabled,source,enabled_at,updated_at
)
select id,'vaccinations',true,'launch_preview',now(),now()
from public.households
on conflict(household_id,module_code)
do update set
  enabled=true,
  source=case
    when public.household_modules.source='purchase' then public.household_modules.source
    else 'launch_preview'
  end,
  enabled_at=coalesce(public.household_modules.enabled_at,now()),
  updated_at=now();


create table if not exists public.vaccination_schedule_templates(
  code text primary key,
  country_code text not null default 'DE',
  schedule_version text not null default 'STIKO 2026',
  vaccine_name text not null,
  dose_label text not null,
  age_start_days integer,
  age_end_days integer,
  age_start_months integer,
  age_end_months integer,
  age_label text not null,
  timing_note text,
  is_optional boolean not null default false,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint vaccination_template_age_days_check
    check(age_start_days is null or age_start_days>=0),
  constraint vaccination_template_age_end_days_check
    check(age_end_days is null or age_end_days>=coalesce(age_start_days,0)),
  constraint vaccination_template_age_months_check
    check(age_start_months is null or age_start_months>=0),
  constraint vaccination_template_age_end_months_check
    check(age_end_months is null or age_end_months>=coalesce(age_start_months,0))
);

alter table public.vaccination_schedule_templates enable row level security;

drop policy if exists vaccination_schedule_templates_select on public.vaccination_schedule_templates;
create policy vaccination_schedule_templates_select
on public.vaccination_schedule_templates
for select to authenticated
using (true);

revoke all on table public.vaccination_schedule_templates from anon,public;
grant select on table public.vaccination_schedule_templates to authenticated;


insert into public.vaccination_schedule_templates(
  code,country_code,schedule_version,vaccine_name,dose_label,
  age_start_days,age_end_days,age_start_months,age_end_months,
  age_label,timing_note,is_optional,sort_order,active
)
values
  (
    'de_stiko_2026_rsv_first_season','DE','STIKO 2026',
    'RSV prevention','First RSV season',
    null,null,null,null,
    'First RSV season',
    'Monoclonal antibody immunisation. Timing depends on birth month and RSV season; confirm the appointment with the paediatrician.',
    false,5,true
  ),
  (
    'de_stiko_2026_rota_1','DE','STIKO 2026',
    'Rotavirus','Dose 1',
    42,84,null,null,
    'From 6 weeks',
    'Start from 6 weeks of age. The first dose should be started early; exact product schedule must be followed.',
    false,10,true
  ),
  (
    'de_stiko_2026_rota_2','DE','STIKO 2026',
    'Rotavirus','Dose 2',
    70,112,null,null,
    'About 10–16 weeks',
    'Planning target only. Minimum interval is 4 weeks; exact timing depends on the vaccine product.',
    false,20,true
  ),
  (
    'de_stiko_2026_rota_3','DE','STIKO 2026',
    'Rotavirus','Dose 3',
    98,154,null,null,
    'If using a 3-dose vaccine',
    'Only required for a 3-dose rotavirus vaccine. Exact timing depends on the product.',
    true,30,true
  ),
  (
    'de_stiko_2026_hex_1','DE','STIKO 2026',
    '6-in-1 (DTaP-IPV-Hib-HepB)','Dose 1',
    null,null,2,2,
    '2 months',
    'Diphtheria, tetanus, pertussis, polio, Hib and hepatitis B combination vaccine.',
    false,40,true
  ),
  (
    'de_stiko_2026_pneumo_1','DE','STIKO 2026',
    'Pneumococcal','Dose 1',
    null,null,2,2,
    '2 months',
    'Standard infant pneumococcal immunisation.',
    false,50,true
  ),
  (
    'de_stiko_2026_menb_1','DE','STIKO 2026',
    'Meningococcal B','Dose 1',
    null,null,2,2,
    '2 months',
    'Standard infant MenB immunisation.',
    false,60,true
  ),
  (
    'de_stiko_2026_hex_2','DE','STIKO 2026',
    '6-in-1 (DTaP-IPV-Hib-HepB)','Dose 2',
    null,null,4,4,
    '4 months',
    'Second 6-in-1 dose.',
    false,70,true
  ),
  (
    'de_stiko_2026_pneumo_2','DE','STIKO 2026',
    'Pneumococcal','Dose 2',
    null,null,4,4,
    '4 months',
    'Second pneumococcal dose.',
    false,80,true
  ),
  (
    'de_stiko_2026_menb_2','DE','STIKO 2026',
    'Meningococcal B','Dose 2',
    null,null,4,4,
    '4 months',
    'Second MenB dose.',
    false,90,true
  ),
  (
    'de_stiko_2026_hex_3','DE','STIKO 2026',
    '6-in-1 (DTaP-IPV-Hib-HepB)','Dose 3',
    null,null,11,11,
    '11 months',
    'Third 6-in-1 dose. The minimum interval from dose 2 is important for long-term protection.',
    false,100,true
  ),
  (
    'de_stiko_2026_pneumo_3','DE','STIKO 2026',
    'Pneumococcal','Dose 3',
    null,null,11,11,
    '11 months',
    'Third pneumococcal dose.',
    false,110,true
  ),
  (
    'de_stiko_2026_mmr_1','DE','STIKO 2026',
    'MMR (measles, mumps, rubella)','Dose 1',
    null,null,11,11,
    '11 months',
    'First MMR dose.',
    false,120,true
  ),
  (
    'de_stiko_2026_varicella_1','DE','STIKO 2026',
    'Varicella (chickenpox)','Dose 1',
    null,null,11,14,
    '11–14 months',
    'First varicella dose.',
    false,130,true
  ),
  (
    'de_stiko_2026_menb_3','DE','STIKO 2026',
    'Meningococcal B','Dose 3',
    null,null,12,12,
    '12 months',
    'Third MenB dose in the standard 2+1 infant schedule.',
    false,140,true
  ),
  (
    'de_stiko_2026_mmr_2','DE','STIKO 2026',
    'MMR (measles, mumps, rubella)','Dose 2',
    null,null,15,15,
    '15 months',
    'Second MMR dose.',
    false,150,true
  ),
  (
    'de_stiko_2026_varicella_2','DE','STIKO 2026',
    'Varicella (chickenpox)','Dose 2',
    null,null,15,23,
    '15–23 months',
    'Second varicella dose.',
    false,160,true
  ),
  (
    'de_stiko_2026_tdap_booster_1','DE','STIKO 2026',
    'Tetanus, diphtheria, pertussis','Booster 1',
    null,null,60,72,
    '5–6 years',
    'Standard childhood booster.',
    false,170,true
  ),
  (
    'de_stiko_2026_tdap_ipv_booster','DE','STIKO 2026',
    'Tetanus, diphtheria, pertussis, polio','Booster',
    null,null,108,192,
    '9–16 years',
    'Adolescent booster including polio.',
    false,180,true
  ),
  (
    'de_stiko_2026_hpv_1','DE','STIKO 2026',
    'HPV','Dose 1',
    null,null,108,168,
    '9–14 years',
    'STIKO recommends HPV vaccination for all children from age 9 through 14 years.',
    false,190,true
  ),
  (
    'de_stiko_2026_hpv_2','DE','STIKO 2026',
    'HPV','Dose 2',
    null,null,114,181,
    '5–13 months after dose 1',
    'Planning target is approximately 6 months after the 9th birthday. The actual interval should be 5–13 months after dose 1.',
    false,200,true
  ),
  (
    'de_stiko_2026_menacwy','DE','STIKO 2026',
    'Meningococcal ACWY','Dose 1',
    null,null,144,168,
    '12–14 years',
    'One standard MenACWY dose for children and adolescents aged 12–14 years.',
    false,210,true
  )
on conflict(code) do update set
  country_code=excluded.country_code,
  schedule_version=excluded.schedule_version,
  vaccine_name=excluded.vaccine_name,
  dose_label=excluded.dose_label,
  age_start_days=excluded.age_start_days,
  age_end_days=excluded.age_end_days,
  age_start_months=excluded.age_start_months,
  age_end_months=excluded.age_end_months,
  age_label=excluded.age_label,
  timing_note=excluded.timing_note,
  is_optional=excluded.is_optional,
  sort_order=excluded.sort_order,
  active=excluded.active;


create table if not exists public.child_vaccination_entries(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  child_profile_id uuid not null,
  template_code text references public.vaccination_schedule_templates(code) on delete set null,
  schedule_version text not null default 'STIKO 2026',
  vaccine_name text not null,
  dose_label text not null,
  recommended_start_date date,
  recommended_end_date date,
  scheduled_date date,
  scheduled_time time,
  location_text text,
  provider_text text,
  notes text,
  status text not null default 'recommended',
  completed_date date,
  calendar_id uuid references public.calendars(id) on delete set null,
  linked_event_id uuid references public.calendar_events(id) on delete set null,
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint child_vaccination_entries_child_fk
    foreign key(household_id,child_profile_id)
    references public.family_profiles(household_id,id)
    on delete cascade,
  constraint child_vaccination_entries_status_check
    check(status in ('recommended','scheduled','completed','not_applicable')),
  constraint child_vaccination_entries_name_check
    check(length(trim(vaccine_name)) between 1 and 180)
);

create unique index if not exists child_vaccination_entries_template_uidx
  on public.child_vaccination_entries(child_profile_id,template_code)
  where template_code is not null;

create index if not exists child_vaccination_entries_household_child_idx
  on public.child_vaccination_entries(household_id,child_profile_id,status);

create index if not exists child_vaccination_entries_schedule_idx
  on public.child_vaccination_entries(household_id,scheduled_date)
  where scheduled_date is not null;

alter table public.child_vaccination_entries enable row level security;

drop policy if exists child_vaccination_entries_select on public.child_vaccination_entries;
create policy child_vaccination_entries_select
on public.child_vaccination_entries
for select to authenticated
using(private.has_module_access(household_id,'vaccinations','read'));

drop policy if exists child_vaccination_entries_insert on public.child_vaccination_entries;
create policy child_vaccination_entries_insert
on public.child_vaccination_entries
for insert to authenticated
with check(private.has_module_access(household_id,'vaccinations','full'));

drop policy if exists child_vaccination_entries_update on public.child_vaccination_entries;
create policy child_vaccination_entries_update
on public.child_vaccination_entries
for update to authenticated
using(private.has_module_access(household_id,'vaccinations','full'))
with check(private.has_module_access(household_id,'vaccinations','full'));

drop policy if exists child_vaccination_entries_delete on public.child_vaccination_entries;
create policy child_vaccination_entries_delete
on public.child_vaccination_entries
for delete to authenticated
using(private.has_module_access(household_id,'vaccinations','full'));

revoke all on table public.child_vaccination_entries from anon,public;
grant select,insert,update,delete on table public.child_vaccination_entries to authenticated;


-- Vaccination category used for Calendar synchronization.
insert into public.event_categories(
  household_id,name,color_key,icon_key,sort_order,is_system,active,created_by_user_id
)
select
  h.id,
  'Vaccination',
  'blue',
  'vaccination-default',
  coalesce((select max(ec.sort_order) from public.event_categories ec where ec.household_id=h.id),0)+10,
  true,
  true,
  null
from public.households h
where not exists(
  select 1
  from public.event_categories ec
  where ec.household_id=h.id
    and lower(ec.name)='vaccination'
    and ec.active
);

insert into public.module_category_availability(
  household_id,module_code,category_id,enabled,updated_at
)
select ec.household_id,m.code,ec.id,true,now()
from public.event_categories ec
cross join (values ('calendar'),('vaccinations')) as m(code)
where ec.active
  and lower(ec.name)='vaccination'
on conflict(household_id,module_code,category_id)
do update set enabled=true,updated_at=now();


create or replace function private.vaccination_category_id(p_household_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_category uuid;
begin
  select id into v_category
  from public.event_categories
  where household_id=p_household_id
    and active
    and lower(name)='vaccination'
  order by created_at
  limit 1;

  if v_category is null then
    insert into public.event_categories(
      household_id,name,color_key,icon_key,sort_order,is_system,active,created_by_user_id
    )
    values(
      p_household_id,
      'Vaccination',
      'blue',
      'vaccination-default',
      coalesce((select max(sort_order) from public.event_categories where household_id=p_household_id),0)+10,
      true,
      true,
      null
    )
    returning id into v_category;
  end if;

  return v_category;
end;
$$;

revoke all on function private.vaccination_category_id(uuid) from public,anon,authenticated;


create or replace function public.initialize_child_vaccination_plan_v1(
  p_household_id uuid,
  p_child_profile_id uuid
)
returns integer
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_birth_date date;
  v_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'vaccinations','full') then
    raise exception 'Vaccination Calendar write access required';
  end if;

  select birth_date into v_birth_date
  from public.family_profiles
  where id=p_child_profile_id
    and household_id=p_household_id
    and active
    and profile_type='child';

  if not found then raise exception 'Child profile not found'; end if;
  if v_birth_date is null then raise exception 'Date of birth is required'; end if;

  insert into public.child_vaccination_entries(
    household_id,child_profile_id,template_code,schedule_version,
    vaccine_name,dose_label,recommended_start_date,recommended_end_date,
    status,created_by_user_id
  )
  select
    p_household_id,
    p_child_profile_id,
    t.code,
    t.schedule_version,
    t.vaccine_name,
    t.dose_label,
    case
      when t.age_start_days is not null then (v_birth_date+t.age_start_days)
      when t.age_start_months is not null then (v_birth_date+make_interval(months=>t.age_start_months))::date
      else null
    end,
    case
      when t.age_end_days is not null then (v_birth_date+t.age_end_days)
      when t.age_end_months is not null then (v_birth_date+make_interval(months=>t.age_end_months))::date
      when t.age_start_days is not null then (v_birth_date+t.age_start_days)
      when t.age_start_months is not null then (v_birth_date+make_interval(months=>t.age_start_months))::date
      else null
    end,
    'recommended',
    auth.uid()
  from public.vaccination_schedule_templates t
  where t.country_code='DE'
    and t.schedule_version='STIKO 2026'
    and t.active
  on conflict(child_profile_id,template_code)
  where template_code is not null
  do update set
    recommended_start_date=case
      when child_vaccination_entries.status='completed' then child_vaccination_entries.recommended_start_date
      else excluded.recommended_start_date
    end,
    recommended_end_date=case
      when child_vaccination_entries.status='completed' then child_vaccination_entries.recommended_end_date
      else excluded.recommended_end_date
    end,
    schedule_version=excluded.schedule_version,
    vaccine_name=excluded.vaccine_name,
    dose_label=excluded.dose_label,
    updated_at=now();

  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.initialize_child_vaccination_plan_v1(uuid,uuid) from public,anon;
grant execute on function public.initialize_child_vaccination_plan_v1(uuid,uuid) to authenticated;


create or replace function public.set_child_birth_date_v1(
  p_household_id uuid,
  p_child_profile_id uuid,
  p_birth_date date
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'vaccinations','full') then
    raise exception 'Vaccination Calendar write access required';
  end if;
  if p_birth_date is null or p_birth_date>current_date then
    raise exception 'Use a valid date of birth';
  end if;

  update public.family_profiles
  set birth_date=p_birth_date,
      updated_at=now()
  where id=p_child_profile_id
    and household_id=p_household_id
    and active
    and profile_type='child';

  if not found then raise exception 'Child profile not found'; end if;

  perform public.initialize_child_vaccination_plan_v1(
    p_household_id,
    p_child_profile_id
  );

  return true;
end;
$$;

revoke all on function public.set_child_birth_date_v1(uuid,uuid,date) from public,anon;
grant execute on function public.set_child_birth_date_v1(uuid,uuid,date) to authenticated;


create or replace function public.save_child_vaccination_entry_v1(
  p_entry_id uuid,
  p_household_id uuid,
  p_scheduled_date date,
  p_scheduled_time time,
  p_location_text text,
  p_provider_text text,
  p_notes text,
  p_status text,
  p_completed_date date,
  p_calendar_id uuid,
  p_add_to_calendar boolean
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_row public.child_vaccination_entries%rowtype;
  v_child_name text;
  v_timezone text;
  v_event uuid;
  v_calendar uuid;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_participants jsonb;
  v_title text;
  v_description text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'vaccinations','full') then
    raise exception 'Vaccination Calendar write access required';
  end if;
  if p_status not in ('recommended','scheduled','completed','not_applicable') then
    raise exception 'Invalid vaccination status';
  end if;

  select * into v_row
  from public.child_vaccination_entries
  where id=p_entry_id
    and household_id=p_household_id
  for update;

  if v_row.id is null then raise exception 'Vaccination entry not found'; end if;

  select display_name into v_child_name
  from public.family_profiles
  where id=v_row.child_profile_id
    and household_id=p_household_id
    and active
    and profile_type='child';

  if v_child_name is null then raise exception 'Child profile not found'; end if;

  if p_status='scheduled' and p_scheduled_date is null then
    raise exception 'Appointment date is required for scheduled vaccinations';
  end if;

  if p_status='completed'
     and coalesce(p_completed_date,p_scheduled_date) is null
  then
    raise exception 'Completion date is required';
  end if;

  if p_add_to_calendar and p_scheduled_date is null then
    raise exception 'Set an appointment date before adding to Calendar';
  end if;

  if p_add_to_calendar
     and not private.has_module_access(p_household_id,'calendar','full')
  then
    raise exception 'Calendar write access required';
  end if;

  update public.child_vaccination_entries
  set scheduled_date=p_scheduled_date,
      scheduled_time=p_scheduled_time,
      location_text=nullif(trim(p_location_text),''),
      provider_text=nullif(trim(p_provider_text),''),
      notes=nullif(trim(p_notes),''),
      status=p_status,
      completed_date=case
        when p_status='completed' then coalesce(p_completed_date,p_scheduled_date,current_date)
        else null
      end,
      updated_at=now()
  where id=v_row.id;

  v_event:=v_row.linked_event_id;

  if p_add_to_calendar and p_status<>'not_applicable' then
    if p_calendar_id is not null then
      select id into v_calendar
      from public.calendars
      where id=p_calendar_id
        and household_id=p_household_id
        and active;
    end if;

    if v_calendar is null then
      select id into v_calendar
      from public.calendars
      where household_id=p_household_id
        and active
      order by is_default desc,name
      limit 1;
    end if;

    if v_calendar is null then raise exception 'No active calendar found'; end if;

    select timezone into v_timezone
    from public.households
    where id=p_household_id;

    if p_scheduled_time is not null then
      v_start_at := (p_scheduled_date+p_scheduled_time) at time zone v_timezone;
      v_end_at := v_start_at+interval '30 minutes';
    end if;

    v_participants:=jsonb_build_array(
      jsonb_build_object(
        'profile_id',v_row.child_profile_id,
        'participant_role','participant',
        'can_edit',false
      )
    );

    v_title:='Vaccination · '||v_child_name||' · '||v_row.vaccine_name||' · '||v_row.dose_label;
    v_description:='Vaccination appointment tracked in Famioo Vaccination Calendar.'
      ||case when nullif(trim(p_provider_text),'') is not null
        then E'\nPractice / doctor: '||trim(p_provider_text)
        else ''
      end
      ||case when nullif(trim(p_notes),'') is not null
        then E'\n'||trim(p_notes)
        else ''
      end;

    v_event:=public.save_event_v1(
      v_event,
      p_household_id,
      v_calendar,
      v_title,
      v_description,
      p_scheduled_time is null,
      case when p_scheduled_time is null then null else v_start_at end,
      case when p_scheduled_time is null then null else v_end_at end,
      case when p_scheduled_time is null then p_scheduled_date else null end,
      case when p_scheduled_time is null then p_scheduled_date else null end,
      v_timezone,
      nullif(trim(p_location_text),''),
      private.vaccination_category_id(p_household_id),
      'household',
      v_participants,
      null,
      '[]'::jsonb
    );

    update public.child_vaccination_entries
    set linked_event_id=v_event,
        calendar_id=v_calendar,
        updated_at=now()
    where id=v_row.id;
  elsif v_event is not null then
    update public.calendar_events
    set deleted_at=now(),
        deleted_by_user_id=auth.uid(),
        updated_at=now()
    where id=v_event
      and household_id=p_household_id
      and deleted_at is null;

    update public.child_vaccination_entries
    set linked_event_id=null,
        calendar_id=null,
        updated_at=now()
    where id=v_row.id;
  end if;

  return v_row.id;
end;
$$;

revoke all on function public.save_child_vaccination_entry_v1(
  uuid,uuid,date,time,text,text,text,text,date,uuid,boolean
) from public,anon;
grant execute on function public.save_child_vaccination_entry_v1(
  uuid,uuid,date,time,text,text,text,text,date,uuid,boolean
) to authenticated;


-- German preventive child examinations (U-Untersuchungen / J1).
-- Current statutory baseline: G-BA Kinder-Richtlinie + Jugendgesundheitsuntersuchungs-Richtlinie.
create table if not exists public.child_checkup_schedule_templates(
  code text primary key,
  country_code text not null default 'DE',
  schedule_version text not null default 'G-BA 2026',
  checkup_name text not null,
  age_start_days integer,
  age_end_days integer,
  age_start_months integer,
  age_end_months integer,
  age_label text not null,
  timing_note text,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint child_checkup_template_days_check
    check(age_start_days is null or age_start_days>=0),
  constraint child_checkup_template_day_end_check
    check(age_end_days is null or age_end_days>=coalesce(age_start_days,0)),
  constraint child_checkup_template_months_check
    check(age_start_months is null or age_start_months>=0),
  constraint child_checkup_template_month_end_check
    check(age_end_months is null or age_end_months>=coalesce(age_start_months,0))
);

alter table public.child_checkup_schedule_templates enable row level security;

drop policy if exists child_checkup_schedule_templates_select on public.child_checkup_schedule_templates;
create policy child_checkup_schedule_templates_select
on public.child_checkup_schedule_templates
for select to authenticated
using (true);

revoke all on table public.child_checkup_schedule_templates from anon,public;
grant select on table public.child_checkup_schedule_templates to authenticated;

insert into public.child_checkup_schedule_templates(
  code,country_code,schedule_version,checkup_name,
  age_start_days,age_end_days,age_start_months,age_end_months,
  age_label,timing_note,sort_order,active
)
values
  (
    'de_gba_2026_u1','DE','G-BA 2026','U1',
    0,0,null,null,
    'Immediately after birth',
    'Usually performed directly after birth.',
    10,true
  ),
  (
    'de_gba_2026_u2','DE','G-BA 2026','U2',
    3,10,null,null,
    '3rd–10th day of life',
    'Standard examination period. The G-BA tolerance window extends to the 14th day of life.',
    20,true
  ),
  (
    'de_gba_2026_u3','DE','G-BA 2026','U3',
    28,35,null,null,
    '4th–5th week of life',
    'Includes assessment of early development; hip ultrasound is typically part of U3.',
    30,true
  ),
  (
    'de_gba_2026_u4','DE','G-BA 2026','U4',
    null,null,3,4,
    '3–4 months',
    'Preventive child examination in the 3rd–4th month of life.',
    40,true
  ),
  (
    'de_gba_2026_u5','DE','G-BA 2026','U5',
    null,null,6,7,
    '6–7 months',
    'Preventive child examination in the 6th–7th month of life.',
    50,true
  ),
  (
    'de_gba_2026_u6','DE','G-BA 2026','U6',
    null,null,10,12,
    '10–12 months',
    'Preventive child examination in the 10th–12th month of life.',
    60,true
  ),
  (
    'de_gba_2026_u7','DE','G-BA 2026','U7',
    null,null,21,24,
    '21–24 months',
    'Preventive child examination in the 21st–24th month of life.',
    70,true
  ),
  (
    'de_gba_2026_u7a','DE','G-BA 2026','U7a',
    null,null,34,36,
    '34–36 months',
    'Preventive child examination in the 34th–36th month of life.',
    80,true
  ),
  (
    'de_gba_2026_u8','DE','G-BA 2026','U8',
    null,null,46,48,
    '46–48 months',
    'Preventive child examination in the 46th–48th month of life.',
    90,true
  ),
  (
    'de_gba_2026_u9','DE','G-BA 2026','U9',
    null,null,60,64,
    '60–64 months',
    'Preventive child examination before school age.',
    100,true
  ),
  (
    'de_gba_2026_j1','DE','G-BA 2026','J1',
    null,null,156,168,
    '13–14 years',
    'Statutory youth health examination. Some insurers also offer additional U/J examinations outside the standard statutory schedule.',
    110,true
  )
on conflict(code) do update set
  country_code=excluded.country_code,
  schedule_version=excluded.schedule_version,
  checkup_name=excluded.checkup_name,
  age_start_days=excluded.age_start_days,
  age_end_days=excluded.age_end_days,
  age_start_months=excluded.age_start_months,
  age_end_months=excluded.age_end_months,
  age_label=excluded.age_label,
  timing_note=excluded.timing_note,
  sort_order=excluded.sort_order,
  active=excluded.active;


create table if not exists public.child_checkup_entries(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  child_profile_id uuid not null,
  template_code text references public.child_checkup_schedule_templates(code) on delete set null,
  schedule_version text not null default 'G-BA 2026',
  checkup_name text not null,
  recommended_start_date date,
  recommended_end_date date,
  scheduled_date date,
  scheduled_time time,
  location_text text,
  provider_text text,
  notes text,
  status text not null default 'recommended',
  completed_date date,
  calendar_id uuid references public.calendars(id) on delete set null,
  linked_event_id uuid references public.calendar_events(id) on delete set null,
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint child_checkup_entries_child_fk
    foreign key(household_id,child_profile_id)
    references public.family_profiles(household_id,id)
    on delete cascade,
  constraint child_checkup_entries_status_check
    check(status in ('recommended','scheduled','completed','not_applicable')),
  constraint child_checkup_entries_name_check
    check(length(trim(checkup_name)) between 1 and 80)
);

create unique index if not exists child_checkup_entries_template_uidx
  on public.child_checkup_entries(child_profile_id,template_code)
  where template_code is not null;

create index if not exists child_checkup_entries_household_child_idx
  on public.child_checkup_entries(household_id,child_profile_id,status);

create index if not exists child_checkup_entries_schedule_idx
  on public.child_checkup_entries(household_id,scheduled_date)
  where scheduled_date is not null;

alter table public.child_checkup_entries enable row level security;

drop policy if exists child_checkup_entries_select on public.child_checkup_entries;
create policy child_checkup_entries_select
on public.child_checkup_entries
for select to authenticated
using(private.has_module_access(household_id,'vaccinations','read'));

drop policy if exists child_checkup_entries_insert on public.child_checkup_entries;
create policy child_checkup_entries_insert
on public.child_checkup_entries
for insert to authenticated
with check(private.has_module_access(household_id,'vaccinations','full'));

drop policy if exists child_checkup_entries_update on public.child_checkup_entries;
create policy child_checkup_entries_update
on public.child_checkup_entries
for update to authenticated
using(private.has_module_access(household_id,'vaccinations','full'))
with check(private.has_module_access(household_id,'vaccinations','full'));

drop policy if exists child_checkup_entries_delete on public.child_checkup_entries;
create policy child_checkup_entries_delete
on public.child_checkup_entries
for delete to authenticated
using(private.has_module_access(household_id,'vaccinations','full'));

revoke all on table public.child_checkup_entries from anon,public;
grant select,insert,update,delete on table public.child_checkup_entries to authenticated;


create or replace function public.initialize_child_checkup_plan_v1(
  p_household_id uuid,
  p_child_profile_id uuid
)
returns integer
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_birth_date date;
  v_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'vaccinations','full') then
    raise exception 'Vaccinations & Check-ups write access required';
  end if;

  select birth_date into v_birth_date
  from public.family_profiles
  where id=p_child_profile_id
    and household_id=p_household_id
    and active
    and profile_type='child';

  if not found then raise exception 'Child profile not found'; end if;
  if v_birth_date is null then raise exception 'Date of birth is required'; end if;

  insert into public.child_checkup_entries(
    household_id,child_profile_id,template_code,schedule_version,
    checkup_name,recommended_start_date,recommended_end_date,
    status,created_by_user_id
  )
  select
    p_household_id,
    p_child_profile_id,
    t.code,
    t.schedule_version,
    t.checkup_name,
    case
      when t.age_start_days is not null then (v_birth_date+t.age_start_days)
      when t.age_start_months is not null then (v_birth_date+make_interval(months=>t.age_start_months))::date
      else null
    end,
    case
      when t.age_end_days is not null then (v_birth_date+t.age_end_days)
      when t.age_end_months is not null then (v_birth_date+make_interval(months=>t.age_end_months))::date
      when t.age_start_days is not null then (v_birth_date+t.age_start_days)
      when t.age_start_months is not null then (v_birth_date+make_interval(months=>t.age_start_months))::date
      else null
    end,
    'recommended',
    auth.uid()
  from public.child_checkup_schedule_templates t
  where t.country_code='DE'
    and t.schedule_version='G-BA 2026'
    and t.active
  on conflict(child_profile_id,template_code)
  where template_code is not null
  do update set
    recommended_start_date=case
      when child_checkup_entries.status='completed' then child_checkup_entries.recommended_start_date
      else excluded.recommended_start_date
    end,
    recommended_end_date=case
      when child_checkup_entries.status='completed' then child_checkup_entries.recommended_end_date
      else excluded.recommended_end_date
    end,
    schedule_version=excluded.schedule_version,
    checkup_name=excluded.checkup_name,
    updated_at=now();

  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.initialize_child_checkup_plan_v1(uuid,uuid) from public,anon;
grant execute on function public.initialize_child_checkup_plan_v1(uuid,uuid) to authenticated;


-- Extend birth-date setup so one action initializes both vaccination and U/J plans.
create or replace function public.set_child_birth_date_v1(
  p_household_id uuid,
  p_child_profile_id uuid,
  p_birth_date date
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'vaccinations','full') then
    raise exception 'Vaccinations & Check-ups write access required';
  end if;
  if p_birth_date is null or p_birth_date>current_date then
    raise exception 'Use a valid date of birth';
  end if;

  update public.family_profiles
  set birth_date=p_birth_date,
      updated_at=now()
  where id=p_child_profile_id
    and household_id=p_household_id
    and active
    and profile_type='child';

  if not found then raise exception 'Child profile not found'; end if;

  perform public.initialize_child_vaccination_plan_v1(
    p_household_id,
    p_child_profile_id
  );
  perform public.initialize_child_checkup_plan_v1(
    p_household_id,
    p_child_profile_id
  );

  return true;
end;
$$;

revoke all on function public.set_child_birth_date_v1(uuid,uuid,date) from public,anon;
grant execute on function public.set_child_birth_date_v1(uuid,uuid,date) to authenticated;


create or replace function public.save_child_checkup_entry_v1(
  p_entry_id uuid,
  p_household_id uuid,
  p_scheduled_date date,
  p_scheduled_time time,
  p_location_text text,
  p_provider_text text,
  p_notes text,
  p_status text,
  p_completed_date date,
  p_calendar_id uuid,
  p_add_to_calendar boolean
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_row public.child_checkup_entries%rowtype;
  v_child_name text;
  v_timezone text;
  v_event uuid;
  v_calendar uuid;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_participants jsonb;
  v_title text;
  v_description text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'vaccinations','full') then
    raise exception 'Vaccinations & Check-ups write access required';
  end if;
  if p_status not in ('recommended','scheduled','completed','not_applicable') then
    raise exception 'Invalid check-up status';
  end if;

  select * into v_row
  from public.child_checkup_entries
  where id=p_entry_id
    and household_id=p_household_id
  for update;

  if v_row.id is null then raise exception 'Check-up entry not found'; end if;

  select display_name into v_child_name
  from public.family_profiles
  where id=v_row.child_profile_id
    and household_id=p_household_id
    and active
    and profile_type='child';

  if v_child_name is null then raise exception 'Child profile not found'; end if;

  if p_status='scheduled' and p_scheduled_date is null then
    raise exception 'Appointment date is required for scheduled check-ups';
  end if;

  if p_status='completed'
     and coalesce(p_completed_date,p_scheduled_date) is null
  then
    raise exception 'Completion date is required';
  end if;

  if p_add_to_calendar and p_scheduled_date is null then
    raise exception 'Set an appointment date before adding to Calendar';
  end if;

  if p_add_to_calendar
     and not private.has_module_access(p_household_id,'calendar','full')
  then
    raise exception 'Calendar write access required';
  end if;

  update public.child_checkup_entries
  set scheduled_date=p_scheduled_date,
      scheduled_time=p_scheduled_time,
      location_text=nullif(trim(p_location_text),''),
      provider_text=nullif(trim(p_provider_text),''),
      notes=nullif(trim(p_notes),''),
      status=p_status,
      completed_date=case
        when p_status='completed' then coalesce(p_completed_date,p_scheduled_date,current_date)
        else null
      end,
      updated_at=now()
  where id=v_row.id;

  v_event:=v_row.linked_event_id;

  if p_add_to_calendar and p_status<>'not_applicable' then
    if p_calendar_id is not null then
      select id into v_calendar
      from public.calendars
      where id=p_calendar_id
        and household_id=p_household_id
        and active;
    end if;

    if v_calendar is null then
      select id into v_calendar
      from public.calendars
      where household_id=p_household_id
        and active
      order by is_default desc,name
      limit 1;
    end if;

    if v_calendar is null then raise exception 'No active calendar found'; end if;

    select timezone into v_timezone
    from public.households
    where id=p_household_id;

    if p_scheduled_time is not null then
      v_start_at := (p_scheduled_date+p_scheduled_time) at time zone v_timezone;
      v_end_at := v_start_at+interval '45 minutes';
    end if;

    v_participants:=jsonb_build_array(
      jsonb_build_object(
        'profile_id',v_row.child_profile_id,
        'participant_role','participant',
        'can_edit',false
      )
    );

    v_title:=v_row.checkup_name||' · '||v_child_name;
    v_description:='German preventive child health examination tracked in Famioo.'
      ||case when nullif(trim(p_provider_text),'') is not null
        then E'\nPractice / doctor: '||trim(p_provider_text)
        else ''
      end
      ||case when nullif(trim(p_notes),'') is not null
        then E'\n'||trim(p_notes)
        else ''
      end;

    v_event:=public.save_event_v1(
      v_event,
      p_household_id,
      v_calendar,
      v_title,
      v_description,
      p_scheduled_time is null,
      case when p_scheduled_time is null then null else v_start_at end,
      case when p_scheduled_time is null then null else v_end_at end,
      case when p_scheduled_time is null then p_scheduled_date else null end,
      case when p_scheduled_time is null then p_scheduled_date else null end,
      v_timezone,
      nullif(trim(p_location_text),''),
      private.vaccination_category_id(p_household_id),
      'household',
      v_participants,
      null,
      '[]'::jsonb
    );

    update public.child_checkup_entries
    set linked_event_id=v_event,
        calendar_id=v_calendar,
        updated_at=now()
    where id=v_row.id;
  elsif v_event is not null then
    update public.calendar_events
    set deleted_at=now(),
        deleted_by_user_id=auth.uid(),
        updated_at=now()
    where id=v_event
      and household_id=p_household_id
      and deleted_at is null;

    update public.child_checkup_entries
    set linked_event_id=null,
        calendar_id=null,
        updated_at=now()
    where id=v_row.id;
  end if;

  return v_row.id;
end;
$$;

revoke all on function public.save_child_checkup_entry_v1(
  uuid,uuid,date,time,text,text,text,text,date,uuid,boolean
) from public,anon;
grant execute on function public.save_child_checkup_entry_v1(
  uuid,uuid,date,time,text,text,text,text,date,uuid,boolean
) to authenticated;
