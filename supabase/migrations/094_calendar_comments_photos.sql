-- Famioo migration 094
-- Comments & Photos on Calendar Events V1.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'calendar_context',
  'Calendar Comments & Photos',
  'Discussion, photos and file attachments kept with Calendar events',
  'messages-square',
  46,
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
select h.id,'calendar_context',r.role,'full'
from public.households h
cross join (values ('owner'::text),('admin'::text),('user'::text)) as r(role)
on conflict(household_id,module_code,role)
do update set access_level='full',updated_at=now();

create table if not exists public.calendar_event_comments(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  body text not null check(length(trim(body)) between 1 and 2000),
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calendar_event_comments_event_idx
  on public.calendar_event_comments(event_id,created_at,id);

create table if not exists public.calendar_event_attachments(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  file_id uuid not null references public.household_files(id) on delete cascade,
  attachment_kind text not null default 'file' check(attachment_kind in ('photo','file')),
  caption text,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(event_id,file_id)
);

create index if not exists calendar_event_attachments_event_idx
  on public.calendar_event_attachments(event_id,created_at desc,id);

alter table public.calendar_event_comments enable row level security;
alter table public.calendar_event_attachments enable row level security;

drop policy if exists calendar_event_comments_read on public.calendar_event_comments;
create policy calendar_event_comments_read
on public.calendar_event_comments
for select to authenticated
using(
  private.has_module_access(household_id,'calendar_context','read')
  and exists(
    select 1 from public.calendar_events ce
    where ce.id=event_id and ce.household_id=household_id and ce.deleted_at is null
  )
);

drop policy if exists calendar_event_comments_write on public.calendar_event_comments;
create policy calendar_event_comments_write
on public.calendar_event_comments
for all to authenticated
using(
  private.has_module_access(household_id,'calendar_context','full')
  and exists(
    select 1 from public.calendar_events ce
    where ce.id=event_id and ce.household_id=household_id and ce.deleted_at is null
  )
)
with check(
  private.has_module_access(household_id,'calendar_context','full')
  and created_by_user_id=auth.uid()
  and exists(
    select 1 from public.calendar_events ce
    where ce.id=event_id and ce.household_id=household_id and ce.deleted_at is null
  )
);

drop policy if exists calendar_event_attachments_read on public.calendar_event_attachments;
create policy calendar_event_attachments_read
on public.calendar_event_attachments
for select to authenticated
using(
  private.has_module_access(household_id,'calendar_context','read')
  and exists(
    select 1 from public.calendar_events ce
    where ce.id=event_id and ce.household_id=household_id and ce.deleted_at is null
  )
  and exists(
    select 1 from public.household_files hf
    where hf.id=file_id and hf.household_id=household_id and hf.status='active'
  )
);

drop policy if exists calendar_event_attachments_write on public.calendar_event_attachments;
create policy calendar_event_attachments_write
on public.calendar_event_attachments
for all to authenticated
using(
  private.has_module_access(household_id,'calendar_context','full')
  and exists(
    select 1 from public.calendar_events ce
    where ce.id=event_id and ce.household_id=household_id and ce.deleted_at is null
  )
)
with check(
  private.has_module_access(household_id,'calendar_context','full')
  and created_by_user_id=auth.uid()
  and exists(
    select 1 from public.calendar_events ce
    where ce.id=event_id and ce.household_id=household_id and ce.deleted_at is null
  )
  and exists(
    select 1 from public.household_files hf
    where hf.id=file_id and hf.household_id=household_id and hf.status='active'
  )
);

grant select,insert,update,delete on public.calendar_event_comments,public.calendar_event_attachments to authenticated;

create or replace function public.add_calendar_event_comment_v1(
  p_household_id uuid,
  p_event_id uuid,
  p_body text
)
returns uuid
language plpgsql
security invoker
set search_path=public,private,pg_temp
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'calendar_context','full') then
    raise exception 'Calendar discussion write access required';
  end if;
  if nullif(trim(coalesce(p_body,'')),'') is null then raise exception 'Comment is required'; end if;
  if length(trim(p_body))>2000 then raise exception 'Comment is too long'; end if;

  insert into public.calendar_event_comments(household_id,event_id,body,created_by_user_id)
  values(p_household_id,p_event_id,trim(p_body),auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.delete_calendar_event_comment_v1(
  p_household_id uuid,
  p_comment_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  delete from public.calendar_event_comments
  where id=p_comment_id
    and household_id=p_household_id
    and (
      created_by_user_id=auth.uid()
      or exists(
        select 1 from public.household_members hm
        where hm.household_id=p_household_id and hm.user_id=auth.uid()
          and hm.status='active' and hm.role in ('owner','admin')
      )
    );

  return found;
end;
$$;

create or replace function public.attach_calendar_event_file_v1(
  p_household_id uuid,
  p_event_id uuid,
  p_file_id uuid,
  p_attachment_kind text default 'file',
  p_caption text default null
)
returns uuid
language plpgsql
security invoker
set search_path=public,private,pg_temp
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'calendar_context','full') then
    raise exception 'Calendar attachment write access required';
  end if;
  if p_attachment_kind not in ('photo','file') then raise exception 'Invalid attachment kind'; end if;

  insert into public.calendar_event_attachments(
    household_id,event_id,file_id,attachment_kind,caption,created_by_user_id
  )
  values(
    p_household_id,p_event_id,p_file_id,p_attachment_kind,
    nullif(trim(coalesce(p_caption,'')),''),auth.uid()
  )
  on conflict(event_id,file_id) do update set
    attachment_kind=excluded.attachment_kind,
    caption=excluded.caption
  returning id into v_id;

  update public.household_files
  set source_module='calendar_context',source_record_id=p_event_id,updated_at=now()
  where id=p_file_id and household_id=p_household_id;

  return v_id;
end;
$$;

create or replace function public.delete_calendar_event_attachment_v1(
  p_household_id uuid,
  p_attachment_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'calendar_context','full') then
    raise exception 'Calendar attachment write access required';
  end if;

  delete from public.calendar_event_attachments
  where id=p_attachment_id and household_id=p_household_id;

  return found;
end;
$$;

revoke all on function public.add_calendar_event_comment_v1(uuid,uuid,text) from public,anon;
revoke all on function public.delete_calendar_event_comment_v1(uuid,uuid) from public,anon;
revoke all on function public.attach_calendar_event_file_v1(uuid,uuid,uuid,text,text) from public,anon;
revoke all on function public.delete_calendar_event_attachment_v1(uuid,uuid) from public,anon;
grant execute on function public.add_calendar_event_comment_v1(uuid,uuid,text) to authenticated;
grant execute on function public.delete_calendar_event_comment_v1(uuid,uuid) to authenticated;
grant execute on function public.attach_calendar_event_file_v1(uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.delete_calendar_event_attachment_v1(uuid,uuid) to authenticated;
