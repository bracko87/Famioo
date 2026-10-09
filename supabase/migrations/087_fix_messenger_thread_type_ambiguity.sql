-- Famioo migration 087
-- Fix Family Messenger thread bootstrap ambiguity.
-- messenger_threads_v1 returns a column named thread_type, so the partial
-- ON CONFLICT predicate in migration 084 could be parsed as either the
-- PL/pgSQL output variable or messenger_threads.thread_type.
-- Avoid the ambiguous conflict target entirely.

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
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.is_household_member(p_household_id) then raise exception 'Household access required'; end if;

  -- The household chat is unique through the existing partial unique index.
  -- ON CONFLICT DO NOTHING needs no predicate expression, so it cannot clash
  -- with the RETURNS TABLE output variable named thread_type.
  insert into public.messenger_threads(
    household_id,thread_type,title,created_by_user_id,created_at,updated_at
  )
  values(
    p_household_id,'household','Family chat',v_user,now(),now()
  )
  on conflict do nothing;

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
