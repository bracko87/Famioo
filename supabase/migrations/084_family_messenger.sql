-- Famioo migration 084
-- Family Messenger V1: household chat, direct chats, text/photo/voice messages.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'messenger',
  'Family Messenger',
  'Private household and direct family messaging with text, photos and voice notes',
  'messages-circle',
  37,
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
select h.id,'messenger',r.role,'full'
from public.households h
cross join (values ('owner'::text),('admin'::text),('user'::text)) as r(role)
on conflict(household_id,module_code,role)
do update set access_level='full',updated_at=now();

create table if not exists public.messenger_threads(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  thread_type text not null check(thread_type in ('household','direct')),
  title text,
  direct_key text,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  check(
    (thread_type='household' and direct_key is null)
    or
    (thread_type='direct' and direct_key is not null)
  )
);

create unique index if not exists messenger_threads_one_household_chat_uidx
  on public.messenger_threads(household_id)
  where thread_type='household';

create unique index if not exists messenger_threads_direct_key_uidx
  on public.messenger_threads(household_id,direct_key)
  where thread_type='direct';

create index if not exists messenger_threads_household_activity_idx
  on public.messenger_threads(household_id,coalesce(last_message_at,created_at) desc);

create table if not exists public.messenger_thread_members(
  thread_id uuid not null references public.messenger_threads(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  archived_at timestamptz,
  primary key(thread_id,user_id)
);

create index if not exists messenger_thread_members_household_user_idx
  on public.messenger_thread_members(household_id,user_id,thread_id);

create table if not exists public.messenger_messages(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  thread_id uuid not null references public.messenger_threads(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  sender_profile_id uuid,
  message_type text not null default 'text'
    check(message_type in ('text','photo','voice')),
  body text,
  media_path text,
  media_name text,
  media_mime text,
  media_duration_s integer check(media_duration_s is null or media_duration_s between 0 and 7200),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  foreign key(household_id,sender_profile_id)
    references public.family_profiles(household_id,id)
    on delete set null,
  check(
    deleted_at is not null
    or nullif(trim(coalesce(body,'')),'') is not null
    or media_path is not null
  )
);

create index if not exists messenger_messages_thread_created_idx
  on public.messenger_messages(thread_id,created_at desc,id desc);

create table if not exists public.messenger_thread_reads(
  household_id uuid not null references public.households(id) on delete cascade,
  thread_id uuid not null references public.messenger_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key(thread_id,user_id)
);

alter table public.messenger_threads enable row level security;
alter table public.messenger_thread_members enable row level security;
alter table public.messenger_messages enable row level security;
alter table public.messenger_thread_reads enable row level security;

revoke all on public.messenger_threads,public.messenger_thread_members,public.messenger_messages,public.messenger_thread_reads
from public,anon,authenticated;
grant all on public.messenger_threads,public.messenger_thread_members,public.messenger_messages,public.messenger_thread_reads
to service_role;

create or replace function private.can_access_messenger_thread(
  p_thread_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,private,pg_temp
as $$
  select exists(
    select 1
    from public.messenger_threads t
    join public.household_members hm
      on hm.household_id=t.household_id
     and hm.user_id=p_user_id
     and hm.status='active'
    where t.id=p_thread_id
      and (
        t.thread_type='household'
        or exists(
          select 1
          from public.messenger_thread_members mtm
          where mtm.thread_id=t.id
            and mtm.user_id=p_user_id
            and mtm.archived_at is null
        )
      )
  );
$$;

revoke all on function private.can_access_messenger_thread(uuid,uuid)
from public,anon,authenticated;

create or replace function public.messenger_threads_v1(
  p_household_id uuid
)
returns table(
  id uuid,
  thread_type text,
  display_title text,
  other_user_id uuid,
  other_avatar_path text,
  last_message_body text,
  last_message_type text,
  last_message_at timestamptz,
  unread_count bigint
)
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_household_thread uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.is_household_member(p_household_id) then raise exception 'Household access required'; end if;

  insert into public.messenger_threads(
    household_id,thread_type,title,created_by_user_id,created_at,updated_at
  )
  values(
    p_household_id,'household','Family chat',v_user,now(),now()
  )
  on conflict(household_id) where thread_type='household'
  do update set updated_at=public.messenger_threads.updated_at
  returning public.messenger_threads.id into v_household_thread;

  return query
  with accessible as (
    select t.*
    from public.messenger_threads t
    where t.household_id=p_household_id
      and (
        t.thread_type='household'
        or exists(
          select 1
          from public.messenger_thread_members mtm
          where mtm.thread_id=t.id
            and mtm.user_id=v_user
            and mtm.archived_at is null
        )
      )
  ),
  direct_other as (
    select
      t.id as thread_id,
      hm.user_id as other_user_id,
      fp.display_name::text as other_name,
      fp.avatar_path as other_avatar_path
    from accessible t
    join public.messenger_thread_members mtm
      on mtm.thread_id=t.id
     and mtm.user_id<>v_user
     and mtm.archived_at is null
    join public.household_members hm
      on hm.household_id=t.household_id
     and hm.user_id=mtm.user_id
     and hm.status='active'
    left join lateral(
      select fp.display_name,fp.avatar_path
      from public.family_profiles fp
      where fp.household_id=t.household_id
        and fp.linked_user_id=hm.user_id
        and fp.active
      order by fp.created_at
      limit 1
    ) fp on true
    where t.thread_type='direct'
  )
  select
    t.id,
    t.thread_type,
    case
      when t.thread_type='household' then coalesce(nullif(trim(t.title),''),'Family chat')
      else coalesce(d.other_name,'Family member')
    end::text as display_title,
    d.other_user_id,
    d.other_avatar_path,
    lm.body::text,
    lm.message_type::text,
    lm.created_at,
    (
      select count(*)
      from public.messenger_messages m
      where m.thread_id=t.id
        and m.deleted_at is null
        and m.sender_user_id<>v_user
        and m.created_at>coalesce(
          (
            select r.last_read_at
            from public.messenger_thread_reads r
            where r.thread_id=t.id
              and r.user_id=v_user
          ),
          '-infinity'::timestamptz
        )
    )::bigint as unread_count
  from accessible t
  left join direct_other d on d.thread_id=t.id
  left join lateral(
    select m.body,m.message_type,m.created_at
    from public.messenger_messages m
    where m.thread_id=t.id
      and m.deleted_at is null
    order by m.created_at desc,m.id desc
    limit 1
  ) lm on true
  order by coalesce(lm.created_at,t.created_at) desc,t.created_at desc;
end;
$$;

revoke all on function public.messenger_threads_v1(uuid) from public,anon;
grant execute on function public.messenger_threads_v1(uuid) to authenticated;

create or replace function public.create_direct_messenger_thread_v1(
  p_household_id uuid,
  p_other_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_key text;
  v_thread uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.is_household_member(p_household_id) then raise exception 'Household access required'; end if;
  if p_other_user_id=v_user then raise exception 'Choose another family member'; end if;

  if not exists(
    select 1
    from public.household_members hm
    where hm.household_id=p_household_id
      and hm.user_id=p_other_user_id
      and hm.status='active'
  ) then
    raise exception 'Family member is not available for chat';
  end if;

  v_key:=case when v_user::text<p_other_user_id::text
    then v_user::text||':'||p_other_user_id::text
    else p_other_user_id::text||':'||v_user::text
  end;

  insert into public.messenger_threads(
    household_id,thread_type,direct_key,created_by_user_id,created_at,updated_at
  )
  values(p_household_id,'direct',v_key,v_user,now(),now())
  on conflict(household_id,direct_key) where thread_type='direct'
  do update set updated_at=public.messenger_threads.updated_at
  returning id into v_thread;

  insert into public.messenger_thread_members(thread_id,household_id,user_id,joined_at)
  values
    (v_thread,p_household_id,v_user,now()),
    (v_thread,p_household_id,p_other_user_id,now())
  on conflict(thread_id,user_id)
  do update set archived_at=null;

  return v_thread;
end;
$$;

revoke all on function public.create_direct_messenger_thread_v1(uuid,uuid) from public,anon;
grant execute on function public.create_direct_messenger_thread_v1(uuid,uuid) to authenticated;

create or replace function public.messenger_messages_v1(
  p_thread_id uuid,
  p_before timestamptz default null,
  p_limit integer default 60
)
returns table(
  id uuid,
  sender_user_id uuid,
  sender_profile_id uuid,
  sender_name text,
  sender_avatar_path text,
  message_type text,
  body text,
  media_path text,
  media_name text,
  media_mime text,
  media_duration_s integer,
  created_at timestamptz,
  edited_at timestamptz,
  is_mine boolean
)
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.can_access_messenger_thread(p_thread_id,v_user) then
    raise exception 'Conversation access required';
  end if;

  return query
  select
    m.id,
    m.sender_user_id,
    m.sender_profile_id,
    coalesce(fp.display_name,'Family member')::text,
    fp.avatar_path,
    m.message_type,
    case when m.deleted_at is null then m.body else 'Message deleted' end::text,
    case when m.deleted_at is null then m.media_path else null end,
    case when m.deleted_at is null then m.media_name else null end,
    case when m.deleted_at is null then m.media_mime else null end,
    case when m.deleted_at is null then m.media_duration_s else null end,
    m.created_at,
    m.edited_at,
    m.sender_user_id=v_user
  from public.messenger_messages m
  left join public.family_profiles fp
    on fp.household_id=m.household_id
   and fp.id=m.sender_profile_id
  where m.thread_id=p_thread_id
    and (p_before is null or m.created_at<p_before)
  order by m.created_at desc,m.id desc
  limit greatest(1,least(coalesce(p_limit,60),100));
end;
$$;

revoke all on function public.messenger_messages_v1(uuid,timestamptz,integer) from public,anon;
grant execute on function public.messenger_messages_v1(uuid,timestamptz,integer) to authenticated;

create or replace function public.send_messenger_message_v1(
  p_thread_id uuid,
  p_body text default null,
  p_message_type text default 'text',
  p_media_path text default null,
  p_media_name text default null,
  p_media_mime text default null,
  p_media_duration_s integer default null
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_household uuid;
  v_profile uuid;
  v_sender_name text:='Family member';
  v_message uuid;
  v_preview text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_message_type not in ('text','photo','voice') then raise exception 'Invalid message type'; end if;
  if p_message_type='text' and nullif(trim(coalesce(p_body,'')),'') is null then
    raise exception 'Message cannot be empty';
  end if;
  if p_message_type in ('photo','voice') and nullif(trim(coalesce(p_media_path,'')),'') is null then
    raise exception 'Media upload is required';
  end if;
  if p_media_duration_s is not null and p_media_duration_s not between 0 and 7200 then
    raise exception 'Invalid voice-note duration';
  end if;

  select t.household_id into v_household
  from public.messenger_threads t
  where t.id=p_thread_id;

  if v_household is null or not private.can_access_messenger_thread(p_thread_id,v_user) then
    raise exception 'Conversation access required';
  end if;

  if p_media_path is not null and split_part(p_media_path,'/',1)<>v_household::text then
    raise exception 'Invalid media path';
  end if;

  select fp.id,fp.display_name
  into v_profile,v_sender_name
  from public.family_profiles fp
  where fp.household_id=v_household
    and fp.linked_user_id=v_user
    and fp.active
  order by fp.created_at
  limit 1;

  insert into public.messenger_messages(
    household_id,thread_id,sender_user_id,sender_profile_id,
    message_type,body,media_path,media_name,media_mime,media_duration_s,created_at
  )
  values(
    v_household,p_thread_id,v_user,v_profile,
    p_message_type,nullif(trim(coalesce(p_body,'')),''),
    nullif(trim(coalesce(p_media_path,'')),''),
    nullif(trim(coalesce(p_media_name,'')),''),
    nullif(trim(coalesce(p_media_mime,'')),''),
    p_media_duration_s,now()
  )
  returning id into v_message;

  update public.messenger_threads
  set last_message_at=now(),updated_at=now()
  where id=p_thread_id;

  insert into public.messenger_thread_reads(
    household_id,thread_id,user_id,last_read_at
  )
  values(v_household,p_thread_id,v_user,now())
  on conflict(thread_id,user_id)
  do update set last_read_at=excluded.last_read_at;

  v_preview:=case p_message_type
    when 'photo' then 'Photo'
    when 'voice' then 'Voice message'
    else left(trim(coalesce(p_body,'')),120)
  end;

  insert into public.notifications(
    household_id,recipient_user_id,notification_type,
    title,body,entity_type,entity_id,scheduled_for,status,source_key
  )
  select
    v_household,
    recipients.user_id,
    'messenger_message',
    coalesce(v_sender_name,'Family member'),
    v_preview,
    'messenger_thread',
    p_thread_id,
    now(),
    'pending',
    'messenger:'||v_message::text||':'||recipients.user_id::text
  from (
    select hm.user_id
    from public.messenger_threads t
    join public.household_members hm
      on hm.household_id=t.household_id
     and hm.status='active'
    where t.id=p_thread_id
      and t.thread_type='household'
      and hm.user_id<>v_user

    union

    select mtm.user_id
    from public.messenger_thread_members mtm
    where mtm.thread_id=p_thread_id
      and mtm.archived_at is null
      and mtm.user_id<>v_user
  ) recipients
  on conflict(source_key) where source_key is not null do nothing;

  return v_message;
end;
$$;

revoke all on function public.send_messenger_message_v1(
  uuid,text,text,text,text,text,integer
) from public,anon;
grant execute on function public.send_messenger_message_v1(
  uuid,text,text,text,text,text,integer
) to authenticated;

create or replace function public.mark_messenger_thread_read_v1(
  p_thread_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_household uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.can_access_messenger_thread(p_thread_id,v_user) then
    raise exception 'Conversation access required';
  end if;

  select household_id into v_household
  from public.messenger_threads
  where id=p_thread_id;

  insert into public.messenger_thread_reads(
    household_id,thread_id,user_id,last_read_at
  )
  values(v_household,p_thread_id,v_user,now())
  on conflict(thread_id,user_id)
  do update set last_read_at=excluded.last_read_at;

  return true;
end;
$$;

revoke all on function public.mark_messenger_thread_read_v1(uuid) from public,anon;
grant execute on function public.mark_messenger_thread_read_v1(uuid) to authenticated;

insert into storage.buckets(
  id,name,public,file_size_limit,allowed_mime_types
)
values(
  'messenger-media',
  'messenger-media',
  false,
  15728640,
  array[
    'image/jpeg','image/png','image/webp','image/heic','image/heif',
    'audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-m4a'
  ]::text[]
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists messenger_media_select_household on storage.objects;
create policy messenger_media_select_household
on storage.objects
for select to authenticated
using(
  bucket_id='messenger-media'
  and exists(
    select 1
    from public.household_members hm
    where hm.household_id=((storage.foldername(name))[1])::uuid
      and hm.user_id=(select auth.uid())
      and hm.status='active'
  )
);

drop policy if exists messenger_media_insert_household on storage.objects;
create policy messenger_media_insert_household
on storage.objects
for insert to authenticated
with check(
  bucket_id='messenger-media'
  and exists(
    select 1
    from public.household_members hm
    where hm.household_id=((storage.foldername(name))[1])::uuid
      and hm.user_id=(select auth.uid())
      and hm.status='active'
  )
);
