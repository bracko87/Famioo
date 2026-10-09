-- Famioo migration 095
-- Family Photo Albums / Memories V1.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'memories',
  'Family Photo Albums / Memories',
  'Shared family photo albums connected to dates and Calendar events',
  'images',
  47,
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
select h.id,'memories',r.role,'full'
from public.households h
cross join (values ('owner'::text),('admin'::text),('user'::text)) as r(role)
on conflict(household_id,module_code,role)
do update set access_level='full',updated_at=now();

create table if not exists public.family_memory_albums(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check(length(trim(title)) between 1 and 160),
  album_type text not null default 'family' check(album_type in ('birthday','trip','holiday','school','family','other')),
  memory_date date,
  event_id uuid references public.calendar_events(id) on delete set null,
  description text,
  cover_file_id uuid references public.household_files(id) on delete set null,
  archived_at timestamptz,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists family_memory_albums_household_idx
  on public.family_memory_albums(household_id,archived_at,memory_date desc,created_at desc);

create index if not exists family_memory_albums_event_idx
  on public.family_memory_albums(event_id) where event_id is not null;

create table if not exists public.family_memory_photos(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  album_id uuid not null references public.family_memory_albums(id) on delete cascade,
  file_id uuid not null references public.household_files(id) on delete cascade,
  caption text,
  taken_date date,
  sort_order integer not null default 0,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(album_id,file_id)
);

create index if not exists family_memory_photos_album_idx
  on public.family_memory_photos(album_id,sort_order,created_at,id);

alter table public.family_memory_albums enable row level security;
alter table public.family_memory_photos enable row level security;

drop policy if exists family_memory_albums_read on public.family_memory_albums;
create policy family_memory_albums_read
on public.family_memory_albums
for select to authenticated
using(private.has_module_access(household_id,'memories','read'));

drop policy if exists family_memory_albums_write on public.family_memory_albums;
drop policy if exists family_memory_albums_insert on public.family_memory_albums;
drop policy if exists family_memory_albums_update on public.family_memory_albums;
drop policy if exists family_memory_albums_delete on public.family_memory_albums;

create policy family_memory_albums_insert
on public.family_memory_albums
for insert to authenticated
with check(
  private.has_module_access(household_id,'memories','full')
  and created_by_user_id=auth.uid()
  and (
    event_id is null
    or exists(
      select 1 from public.calendar_events ce
      where ce.id=event_id and ce.household_id=household_id and ce.deleted_at is null
    )
  )
);

create policy family_memory_albums_update
on public.family_memory_albums
for update to authenticated
using(private.has_module_access(household_id,'memories','full'))
with check(
  private.has_module_access(household_id,'memories','full')
  and (
    event_id is null
    or exists(
      select 1 from public.calendar_events ce
      where ce.id=event_id and ce.household_id=household_id and ce.deleted_at is null
    )
  )
);

create policy family_memory_albums_delete
on public.family_memory_albums
for delete to authenticated
using(private.has_module_access(household_id,'memories','full'));

drop policy if exists family_memory_photos_write on public.family_memory_photos;
drop policy if exists family_memory_photos_insert on public.family_memory_photos;
drop policy if exists family_memory_photos_update on public.family_memory_photos;
drop policy if exists family_memory_photos_delete on public.family_memory_photos;

create policy family_memory_photos_insert
on public.family_memory_photos
for insert to authenticated
with check(
  private.has_module_access(household_id,'memories','full')
  and created_by_user_id=auth.uid()
  and exists(
    select 1 from public.family_memory_albums a
    where a.id=album_id and a.household_id=household_id and a.archived_at is null
  )
  and exists(
    select 1 from public.household_files hf
    where hf.id=file_id and hf.household_id=household_id and hf.status='active'
      and coalesce(hf.mime_type,'') like 'image/%'
  )
);

create policy family_memory_photos_update
on public.family_memory_photos
for update to authenticated
using(private.has_module_access(household_id,'memories','full'))
with check(
  private.has_module_access(household_id,'memories','full')
  and exists(
    select 1 from public.family_memory_albums a
    where a.id=album_id and a.household_id=household_id and a.archived_at is null
  )
  and exists(
    select 1 from public.household_files hf
    where hf.id=file_id and hf.household_id=household_id and hf.status='active'
      and coalesce(hf.mime_type,'') like 'image/%'
  )
);

create policy family_memory_photos_delete
on public.family_memory_photos
for delete to authenticated
using(private.has_module_access(household_id,'memories','full'));

grant select,insert,update,delete on public.family_memory_albums,public.family_memory_photos to authenticated;

create or replace function public.save_family_memory_album_v1(
  p_id uuid,
  p_household_id uuid,
  p_title text,
  p_album_type text default 'family',
  p_memory_date date default null,
  p_event_id uuid default null,
  p_description text default null
)
returns uuid
language plpgsql
security invoker
set search_path=public,private,pg_temp
as $$
declare v_id uuid:=coalesce(p_id,gen_random_uuid());
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'memories','full') then
    raise exception 'Memories write access required';
  end if;
  if nullif(trim(coalesce(p_title,'')),'') is null then raise exception 'Album title is required'; end if;
  if p_album_type not in ('birthday','trip','holiday','school','family','other') then raise exception 'Invalid album type'; end if;

  if p_event_id is not null and not exists(
    select 1 from public.calendar_events ce
    where ce.id=p_event_id and ce.household_id=p_household_id and ce.deleted_at is null
  ) then raise exception 'Calendar event not found'; end if;

  insert into public.family_memory_albums(
    id,household_id,title,album_type,memory_date,event_id,description,created_by_user_id
  )
  values(
    v_id,p_household_id,trim(p_title),p_album_type,p_memory_date,p_event_id,
    nullif(trim(coalesce(p_description,'')),''),auth.uid()
  )
  on conflict(id) do update set
    title=excluded.title,
    album_type=excluded.album_type,
    memory_date=excluded.memory_date,
    event_id=excluded.event_id,
    description=excluded.description,
    updated_at=now();

  return v_id;
end;
$$;

create or replace function public.attach_family_memory_photo_v1(
  p_household_id uuid,
  p_album_id uuid,
  p_file_id uuid,
  p_caption text default null,
  p_taken_date date default null
)
returns uuid
language plpgsql
security invoker
set search_path=public,private,pg_temp
as $$
declare
  v_id uuid;
  v_event_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'memories','full') then
    raise exception 'Memories write access required';
  end if;

  select event_id into v_event_id
  from public.family_memory_albums
  where id=p_album_id and household_id=p_household_id and archived_at is null;

  if not found then raise exception 'Album not found'; end if;

  if not exists(
    select 1 from public.household_files hf
    where hf.id=p_file_id and hf.household_id=p_household_id
      and hf.status='active' and coalesce(hf.mime_type,'') like 'image/%'
  ) then raise exception 'Photo file not found'; end if;

  insert into public.family_memory_photos(
    household_id,album_id,file_id,caption,taken_date,created_by_user_id
  )
  values(
    p_household_id,p_album_id,p_file_id,nullif(trim(coalesce(p_caption,'')),''),
    p_taken_date,auth.uid()
  )
  on conflict(album_id,file_id) do update set
    caption=excluded.caption,
    taken_date=coalesce(excluded.taken_date,public.family_memory_photos.taken_date)
  returning id into v_id;

  update public.family_memory_albums
  set cover_file_id=coalesce(cover_file_id,p_file_id),updated_at=now()
  where id=p_album_id;

  update public.household_files
  set source_module='memories',source_record_id=p_album_id,updated_at=now()
  where id=p_file_id and household_id=p_household_id;

  if v_event_id is not null
     and private.has_module_access(p_household_id,'calendar_context','full') then
    insert into public.calendar_event_attachments(
      household_id,event_id,file_id,attachment_kind,caption,created_by_user_id
    )
    values(
      p_household_id,v_event_id,p_file_id,'photo',
      nullif(trim(coalesce(p_caption,'')),''),auth.uid()
    )
    on conflict(event_id,file_id) do nothing;
  end if;

  return v_id;
end;
$$;

create or replace function public.import_event_photos_to_memory_album_v1(
  p_household_id uuid,
  p_album_id uuid
)
returns integer
language plpgsql
security invoker
set search_path=public,private,pg_temp
as $$
declare
  v_event_id uuid;
  v_count integer:=0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'memories','full') then
    raise exception 'Memories write access required';
  end if;

  select event_id into v_event_id
  from public.family_memory_albums
  where id=p_album_id and household_id=p_household_id and archived_at is null;

  if not found then raise exception 'Album not found'; end if;
  if v_event_id is null then raise exception 'Album is not linked to a Calendar event'; end if;

  insert into public.family_memory_photos(
    household_id,album_id,file_id,caption,taken_date,created_by_user_id
  )
  select
    p_household_id,p_album_id,a.file_id,a.caption,
    coalesce(
      (select ce.start_date from public.calendar_events ce where ce.id=v_event_id and ce.all_day),
      (select (ce.start_at at time zone ce.event_timezone)::date from public.calendar_events ce where ce.id=v_event_id and not ce.all_day)
    ),
    auth.uid()
  from public.calendar_event_attachments a
  join public.household_files hf on hf.id=a.file_id and hf.household_id=p_household_id
  where a.household_id=p_household_id
    and a.event_id=v_event_id
    and a.attachment_kind='photo'
    and coalesce(hf.mime_type,'') like 'image/%'
  on conflict(album_id,file_id) do nothing;

  get diagnostics v_count=row_count;

  update public.family_memory_albums a
  set cover_file_id=coalesce(
      a.cover_file_id,
      (select p.file_id from public.family_memory_photos p where p.album_id=p_album_id order by p.created_at limit 1)
    ),
    updated_at=now()
  where a.id=p_album_id;

  return v_count;
end;
$$;

create or replace function public.remove_family_memory_photo_v1(
  p_household_id uuid,
  p_photo_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path=public,private,pg_temp
as $$
declare
  v_album_id uuid;
  v_file_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'memories','full') then
    raise exception 'Memories write access required';
  end if;

  delete from public.family_memory_photos
  where id=p_photo_id and household_id=p_household_id
  returning album_id,file_id into v_album_id,v_file_id;

  if v_album_id is null then return false; end if;

  update public.family_memory_albums a
  set cover_file_id=case
      when a.cover_file_id=v_file_id then
        (select p.file_id from public.family_memory_photos p where p.album_id=v_album_id order by p.sort_order,p.created_at limit 1)
      else a.cover_file_id
    end,
    updated_at=now()
  where a.id=v_album_id;

  return true;
end;
$$;

revoke all on function public.save_family_memory_album_v1(uuid,uuid,text,text,date,uuid,text) from public,anon;
revoke all on function public.attach_family_memory_photo_v1(uuid,uuid,uuid,text,date) from public,anon;
revoke all on function public.import_event_photos_to_memory_album_v1(uuid,uuid) from public,anon;
revoke all on function public.remove_family_memory_photo_v1(uuid,uuid) from public,anon;
grant execute on function public.save_family_memory_album_v1(uuid,uuid,text,text,date,uuid,text) to authenticated;
grant execute on function public.attach_family_memory_photo_v1(uuid,uuid,uuid,text,date) to authenticated;
grant execute on function public.import_event_photos_to_memory_album_v1(uuid,uuid) to authenticated;
grant execute on function public.remove_family_memory_photo_v1(uuid,uuid) to authenticated;
