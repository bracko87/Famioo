-- Famioo migration 086
-- Shared Memo / Someday V1.

insert into public.modules(code,name,description,icon_key,sort_order,is_core,is_active)
values(
  'memo',
  'Memo / Someday',
  'Shared household ideas, notes, places to visit and things to do later',
  'sticky-note',
  39,
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
select h.id,'memo',r.role,'full'
from public.households h
cross join (values ('owner'::text),('admin'::text),('user'::text)) as r(role)
on conflict(household_id,module_code,role)
do update set access_level='full',updated_at=now();

create table if not exists public.family_memos(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  category text not null default 'idea'
    check(category in ('idea','place','activity','wish','note','someday')),
  title text not null check(length(trim(title)) between 1 and 180),
  body text,
  link_url text,
  is_pinned boolean not null default false,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  updated_by_user_id uuid not null references auth.users(id) on delete cascade,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(body is null or length(body)<=12000),
  check(link_url is null or length(trim(link_url))<=1000)
);

create index if not exists family_memos_household_active_idx
  on public.family_memos(household_id,archived_at,is_pinned desc,updated_at desc);

create index if not exists family_memos_household_category_idx
  on public.family_memos(household_id,category,archived_at);

alter table public.family_memos enable row level security;

revoke all on public.family_memos from public,anon,authenticated;
grant all on public.family_memos to service_role;

create or replace function public.family_memos_v1(
  p_household_id uuid,
  p_include_archived boolean default false
)
returns table(
  id uuid,
  category text,
  title text,
  body text,
  link_url text,
  is_pinned boolean,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  archived_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  created_by_name text,
  updated_by_name text
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
    fm.id,
    fm.category,
    fm.title,
    fm.body,
    fm.link_url,
    fm.is_pinned,
    fm.created_by_user_id,
    fm.updated_by_user_id,
    fm.archived_at,
    fm.created_at,
    fm.updated_at,
    coalesce(created_profile.display_name,'Family member')::text,
    coalesce(updated_profile.display_name,'Family member')::text
  from public.family_memos fm
  left join lateral(
    select fp.display_name
    from public.family_profiles fp
    where fp.household_id=fm.household_id
      and fp.linked_user_id=fm.created_by_user_id
      and fp.active
    order by fp.created_at
    limit 1
  ) created_profile on true
  left join lateral(
    select fp.display_name
    from public.family_profiles fp
    where fp.household_id=fm.household_id
      and fp.linked_user_id=fm.updated_by_user_id
      and fp.active
    order by fp.created_at
    limit 1
  ) updated_profile on true
  where fm.household_id=p_household_id
    and (coalesce(p_include_archived,false) or fm.archived_at is null)
  order by
    (fm.archived_at is null) desc,
    fm.is_pinned desc,
    fm.updated_at desc,
    lower(fm.title);
end;
$$;

revoke all on function public.family_memos_v1(uuid,boolean) from public,anon;
grant execute on function public.family_memos_v1(uuid,boolean) to authenticated;

create or replace function public.save_family_memo_v1(
  p_household_id uuid,
  p_id uuid default null,
  p_category text default 'idea',
  p_title text default null,
  p_body text default null,
  p_link_url text default null,
  p_is_pinned boolean default false
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

  if p_category not in ('idea','place','activity','wish','note','someday') then
    raise exception 'Invalid memo category';
  end if;

  if nullif(trim(coalesce(p_title,'')),'') is null then
    raise exception 'Memo title is required';
  end if;

  if p_link_url is not null
     and nullif(trim(p_link_url),'') is not null
     and trim(p_link_url) !~* '^https?://'
  then
    raise exception 'Link must start with http:// or https://';
  end if;

  if p_id is null then
    insert into public.family_memos(
      household_id,category,title,body,link_url,is_pinned,
      created_by_user_id,updated_by_user_id,created_at,updated_at
    )
    values(
      p_household_id,p_category,trim(p_title),
      nullif(trim(coalesce(p_body,'')),''),
      nullif(trim(coalesce(p_link_url,'')),''),
      coalesce(p_is_pinned,false),
      v_user,v_user,now(),now()
    )
    returning id into v_id;
  else
    update public.family_memos
    set category=p_category,
        title=trim(p_title),
        body=nullif(trim(coalesce(p_body,'')),''),
        link_url=nullif(trim(coalesce(p_link_url,'')),''),
        is_pinned=coalesce(p_is_pinned,false),
        updated_by_user_id=v_user,
        updated_at=now()
    where id=p_id
      and household_id=p_household_id
      and archived_at is null
    returning id into v_id;

    if v_id is null then raise exception 'Memo not found'; end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_family_memo_v1(
  uuid,uuid,text,text,text,text,boolean
) from public,anon;
grant execute on function public.save_family_memo_v1(
  uuid,uuid,text,text,text,text,boolean
) to authenticated;

create or replace function public.set_family_memo_pinned_v1(
  p_household_id uuid,
  p_id uuid,
  p_is_pinned boolean
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

  update public.family_memos
  set is_pinned=coalesce(p_is_pinned,false),
      updated_by_user_id=auth.uid(),
      updated_at=now()
  where household_id=p_household_id
    and id=p_id
    and archived_at is null;

  return found;
end;
$$;

revoke all on function public.set_family_memo_pinned_v1(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_family_memo_pinned_v1(uuid,uuid,boolean) to authenticated;

create or replace function public.archive_family_memo_v1(
  p_household_id uuid,
  p_id uuid,
  p_archived boolean default true
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

  update public.family_memos
  set archived_at=case when coalesce(p_archived,true) then now() else null end,
      is_pinned=case when coalesce(p_archived,true) then false else is_pinned end,
      updated_by_user_id=auth.uid(),
      updated_at=now()
  where household_id=p_household_id
    and id=p_id;

  return found;
end;
$$;

revoke all on function public.archive_family_memo_v1(uuid,uuid,boolean) from public,anon;
grant execute on function public.archive_family_memo_v1(uuid,uuid,boolean) to authenticated;
