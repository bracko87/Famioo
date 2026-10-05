-- Famioo migration 032
-- First functional Life Admin module: documents, contracts, renewals, insurance,
-- subscriptions, deadlines, archive, Calendar links and attachments.

create table if not exists public.life_admin_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  item_type text not null,
  title text not null,
  provider text,
  reference_number text,
  start_date date,
  due_date date,
  renewal_date date,
  expiry_date date,
  amount numeric(12,2),
  currency text not null default 'EUR',
  frequency text not null default 'none',
  auto_renew boolean not null default false,
  cancellation_notice_days smallint,
  responsible_profile_id uuid,
  notes text,
  add_to_calendar boolean not null default false,
  linked_event_id uuid references public.calendar_events(id) on delete set null,
  status text not null default 'active',
  archived_at timestamptz,
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint life_admin_items_type_check
    check (item_type in ('document','contract','insurance','subscription','deadline')),
  constraint life_admin_items_title_check
    check (length(trim(title)) between 1 and 180),
  constraint life_admin_items_amount_check
    check (amount is null or amount >= 0),
  constraint life_admin_items_frequency_check
    check (frequency in ('none','monthly','quarterly','yearly')),
  constraint life_admin_items_notice_check
    check (cancellation_notice_days is null or cancellation_notice_days between 0 and 3650),
  constraint life_admin_items_status_check
    check (status in ('active','archived')),
  constraint life_admin_items_responsible_fk
    foreign key(household_id,responsible_profile_id)
    references public.family_profiles(household_id,id)
);

create index if not exists life_admin_items_household_status_idx
  on public.life_admin_items(household_id,status,item_type);

create index if not exists life_admin_items_due_idx
  on public.life_admin_items(household_id,due_date)
  where status='active' and due_date is not null;

create index if not exists life_admin_items_renewal_idx
  on public.life_admin_items(household_id,renewal_date)
  where status='active' and renewal_date is not null;

create index if not exists life_admin_items_expiry_idx
  on public.life_admin_items(household_id,expiry_date)
  where status='active' and expiry_date is not null;

alter table public.life_admin_items enable row level security;

drop policy if exists life_admin_items_select on public.life_admin_items;
create policy life_admin_items_select
on public.life_admin_items for select to authenticated
using (private.has_module_access(household_id,'life_admin','read'));

drop policy if exists life_admin_items_insert on public.life_admin_items;
create policy life_admin_items_insert
on public.life_admin_items for insert to authenticated
with check (private.has_module_access(household_id,'life_admin','full'));

drop policy if exists life_admin_items_update on public.life_admin_items;
create policy life_admin_items_update
on public.life_admin_items for update to authenticated
using (private.has_module_access(household_id,'life_admin','full'))
with check (private.has_module_access(household_id,'life_admin','full'));

drop policy if exists life_admin_items_delete on public.life_admin_items;
create policy life_admin_items_delete
on public.life_admin_items for delete to authenticated
using (private.has_module_access(household_id,'life_admin','full'));

grant select,insert,update,delete on public.life_admin_items to authenticated;


create table if not exists public.life_admin_attachments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  life_admin_item_id uuid not null references public.life_admin_items(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_size bigint,
  created_by_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists life_admin_attachments_item_idx
  on public.life_admin_attachments(life_admin_item_id,created_at);

alter table public.life_admin_attachments enable row level security;

drop policy if exists life_admin_attachments_select on public.life_admin_attachments;
create policy life_admin_attachments_select
on public.life_admin_attachments for select to authenticated
using (private.has_module_access(household_id,'life_admin','read'));

drop policy if exists life_admin_attachments_insert on public.life_admin_attachments;
create policy life_admin_attachments_insert
on public.life_admin_attachments for insert to authenticated
with check (private.has_module_access(household_id,'life_admin','full'));

drop policy if exists life_admin_attachments_delete on public.life_admin_attachments;
create policy life_admin_attachments_delete
on public.life_admin_attachments for delete to authenticated
using (private.has_module_access(household_id,'life_admin','full'));

grant select,insert,delete on public.life_admin_attachments to authenticated;


with household_rows as (
  select id as household_id from public.households
)
insert into public.event_categories(
  household_id,name,color_key,icon_key,sort_order,is_system,active,created_by_user_id
)
select
  h.household_id,
  'Life Admin',
  'purple',
  'life-admin-default',
  coalesce((select max(ec.sort_order) from public.event_categories ec where ec.household_id=h.household_id),0)+10,
  true,
  true,
  null
from household_rows h
where not exists(
  select 1
  from public.event_categories ec
  where ec.household_id=h.household_id
    and lower(ec.name)='life admin'
    and ec.active
);

insert into public.module_category_availability(
  household_id,module_code,category_id,enabled,updated_at
)
select ec.household_id,m.code,ec.id,
       case when m.code='calendar' then true else false end,
       now()
from public.event_categories ec
cross join (values ('calendar'),('tasks'),('checklists'),('school')) as m(code)
where ec.active
  and lower(ec.name)='life admin'
on conflict(household_id,module_code,category_id)
do update set enabled=excluded.enabled,updated_at=now();


insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'life-admin-attachments',
  'life-admin-attachments',
  false,
  15728640,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict(id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists life_admin_attachment_objects_select on storage.objects;
create policy life_admin_attachment_objects_select
on storage.objects for select to authenticated
using (
  bucket_id='life-admin-attachments'
  and exists(
    select 1
    from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'life_admin','read')
  )
);

drop policy if exists life_admin_attachment_objects_insert on storage.objects;
create policy life_admin_attachment_objects_insert
on storage.objects for insert to authenticated
with check (
  bucket_id='life-admin-attachments'
  and exists(
    select 1
    from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'life_admin','full')
  )
);

drop policy if exists life_admin_attachment_objects_delete on storage.objects;
create policy life_admin_attachment_objects_delete
on storage.objects for delete to authenticated
using (
  bucket_id='life-admin-attachments'
  and exists(
    select 1
    from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'life_admin','full')
  )
);


create or replace function private.life_admin_category_id(p_household_id uuid)
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
    and lower(name)='life admin'
  order by created_at
  limit 1;

  if v_category is null then
    select id into v_category
    from public.event_categories
    where household_id=p_household_id and active
    order by sort_order,name
    limit 1;
  end if;

  return v_category;
end;
$$;

revoke all on function private.life_admin_category_id(uuid) from public;


create or replace function public.save_life_admin_item_v1(
  p_id uuid,
  p_household_id uuid,
  p_item_type text,
  p_title text,
  p_provider text,
  p_reference_number text,
  p_start_date date,
  p_due_date date,
  p_renewal_date date,
  p_expiry_date date,
  p_amount numeric,
  p_currency text,
  p_frequency text,
  p_auto_renew boolean,
  p_cancellation_notice_days smallint,
  p_responsible_profile_id uuid,
  p_notes text,
  p_add_to_calendar boolean
)
returns uuid
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_id uuid;
  v_event_id uuid;
  v_calendar_id uuid;
  v_action_date date;
  v_event_title text;
  v_description text;
  v_timezone text;
  v_participants jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  if not private.has_module_access(p_household_id,'life_admin','full') then
    raise exception 'Life Admin write access required';
  end if;

  if p_item_type not in ('document','contract','insurance','subscription','deadline') then
    raise exception 'Invalid Life Admin type';
  end if;

  if nullif(trim(p_title),'') is null then
    raise exception 'Title is required';
  end if;

  if p_amount is not null and p_amount < 0 then
    raise exception 'Amount cannot be negative';
  end if;

  if p_frequency not in ('none','monthly','quarterly','yearly') then
    raise exception 'Invalid frequency';
  end if;

  if p_cancellation_notice_days is not null
     and (p_cancellation_notice_days < 0 or p_cancellation_notice_days > 3650)
  then
    raise exception 'Cancellation notice must be between 0 and 3650 days';
  end if;

  if p_responsible_profile_id is not null and not exists(
    select 1 from public.family_profiles
    where id=p_responsible_profile_id
      and household_id=p_household_id
      and active
  ) then
    raise exception 'Responsible household member not found';
  end if;

  v_action_date:=coalesce(p_due_date,p_renewal_date,p_expiry_date);

  if p_add_to_calendar then
    if v_action_date is null then
      raise exception 'Add a due, renewal or expiry date before adding this item to Calendar';
    end if;

    if not private.has_module_access(p_household_id,'calendar','full') then
      raise exception 'Calendar write access required';
    end if;
  end if;

  if p_id is null then
    insert into public.life_admin_items(
      household_id,item_type,title,provider,reference_number,start_date,due_date,
      renewal_date,expiry_date,amount,currency,frequency,auto_renew,
      cancellation_notice_days,responsible_profile_id,notes,add_to_calendar,
      created_by_user_id
    )
    values(
      p_household_id,p_item_type,trim(p_title),nullif(trim(p_provider),''),
      nullif(trim(p_reference_number),''),p_start_date,p_due_date,p_renewal_date,
      p_expiry_date,p_amount,coalesce(nullif(trim(p_currency),''),'EUR'),
      p_frequency,coalesce(p_auto_renew,false),p_cancellation_notice_days,
      p_responsible_profile_id,nullif(trim(p_notes),''),
      coalesce(p_add_to_calendar,false),auth.uid()
    )
    returning id into v_id;
  else
    select id,linked_event_id
      into v_id,v_event_id
    from public.life_admin_items
    where id=p_id
      and household_id=p_household_id
      and status='active'
    for update;

    if v_id is null then raise exception 'Life Admin item not found'; end if;

    update public.life_admin_items
    set item_type=p_item_type,
        title=trim(p_title),
        provider=nullif(trim(p_provider),''),
        reference_number=nullif(trim(p_reference_number),''),
        start_date=p_start_date,
        due_date=p_due_date,
        renewal_date=p_renewal_date,
        expiry_date=p_expiry_date,
        amount=p_amount,
        currency=coalesce(nullif(trim(p_currency),''),'EUR'),
        frequency=p_frequency,
        auto_renew=coalesce(p_auto_renew,false),
        cancellation_notice_days=p_cancellation_notice_days,
        responsible_profile_id=p_responsible_profile_id,
        notes=nullif(trim(p_notes),''),
        add_to_calendar=coalesce(p_add_to_calendar,false),
        updated_at=now()
    where id=v_id;
  end if;

  if p_responsible_profile_id is not null then
    v_participants:=jsonb_build_array(
      jsonb_build_object(
        'profile_id',p_responsible_profile_id,
        'participant_role','participant',
        'can_edit',false
      )
    );
  end if;

  if p_add_to_calendar then
    if v_event_id is not null then
      select calendar_id into v_calendar_id
      from public.calendar_events
      where id=v_event_id
        and household_id=p_household_id
        and deleted_at is null;
    end if;

    if v_calendar_id is null then
      select id into v_calendar_id
      from public.calendars
      where household_id=p_household_id
        and active
      order by is_default desc,name
      limit 1;
    end if;

    if v_calendar_id is null then
      raise exception 'No active calendar found';
    end if;

    select timezone into v_timezone
    from public.households
    where id=p_household_id;

    v_event_title:='Life Admin: '||trim(p_title);
    v_description:=concat_ws(
      E'\n',
      case when nullif(trim(p_provider),'') is not null then 'Provider: '||trim(p_provider) end,
      case when nullif(trim(p_reference_number),'') is not null then 'Reference: '||trim(p_reference_number) end,
      nullif(trim(p_notes),'')
    );

    v_event_id:=public.save_event_v1(
      v_event_id,
      p_household_id,
      v_calendar_id,
      v_event_title,
      nullif(v_description,''),
      true,
      null,
      null,
      v_action_date,
      v_action_date,
      v_timezone,
      null,
      private.life_admin_category_id(p_household_id),
      'household',
      v_participants,
      null,
      '[]'::jsonb
    );

    update public.life_admin_items
    set linked_event_id=v_event_id,updated_at=now()
    where id=v_id;
  elsif v_event_id is not null then
    update public.calendar_events
    set deleted_at=now(),
        deleted_by_user_id=auth.uid(),
        updated_at=now()
    where id=v_event_id
      and household_id=p_household_id
      and deleted_at is null;

    update public.life_admin_items
    set linked_event_id=null,updated_at=now()
    where id=v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_life_admin_item_v1(
  uuid,uuid,text,text,text,text,date,date,date,date,numeric,text,text,boolean,smallint,uuid,text,boolean
) from public;

grant execute on function public.save_life_admin_item_v1(
  uuid,uuid,text,text,text,text,date,date,date,date,numeric,text,text,boolean,smallint,uuid,text,boolean
) to authenticated;


create or replace function public.archive_life_admin_item_v1(
  p_id uuid,
  p_household_id uuid,
  p_restore boolean
)
returns void
language plpgsql
security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
  v_event uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  if not private.has_module_access(p_household_id,'life_admin','full') then
    raise exception 'Life Admin write access required';
  end if;

  select linked_event_id into v_event
  from public.life_admin_items
  where id=p_id and household_id=p_household_id
  for update;

  if not found then raise exception 'Life Admin item not found'; end if;

  if p_restore then
    update public.life_admin_items
    set status='active',archived_at=null,updated_at=now()
    where id=p_id and household_id=p_household_id;
  else
    if v_event is not null then
      update public.calendar_events
      set deleted_at=now(),deleted_by_user_id=auth.uid(),updated_at=now()
      where id=v_event
        and household_id=p_household_id
        and deleted_at is null;
    end if;

    update public.life_admin_items
    set status='archived',
        archived_at=now(),
        linked_event_id=null,
        add_to_calendar=false,
        updated_at=now()
    where id=p_id and household_id=p_household_id;
  end if;
end;
$$;

revoke all on function public.archive_life_admin_item_v1(uuid,uuid,boolean) from public;
grant execute on function public.archive_life_admin_item_v1(uuid,uuid,boolean) to authenticated;
