-- Account-scoped storage limits for individually forced-Free users.
-- Paid household space is neither downgraded nor altered; other members retain
-- their household allocation. Existing files are NEVER automatically removed.
--
-- 1 GiB Files = the forced-Free user's own stored uploads across households.
-- 100 MiB Memories = distinct photos the user adds to albums across households.
-- Shared photos and files contributed by other members remain viewable.

create or replace function public.free_account_storage_usage_v1()
returns table (
  files_used_bytes bigint,
  files_quota_bytes bigint,
  memories_used_bytes bigint,
  memories_quota_bytes bigint
)
language plpgsql
stable security definer
set search_path=public,private,pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_plan_overrides
    where user_id=auth.uid() and plan='free'
  ) then
    raise exception 'Individual Free plan required';
  end if;

  return query
  select
    (select coalesce(sum(f.file_size),0)::bigint
     from public.household_files f
     where f.created_by_user_id=auth.uid()
       and f.status in ('pending','active'))::bigint,
    1073741824::bigint,
    (select coalesce(sum(f.file_size),0)::bigint
     from public.household_files f
     where f.id in (
       select distinct mp.file_id from public.family_memory_photos mp
       where mp.created_by_user_id=auth.uid()
     ))::bigint,
    104857600::bigint;
end;
$$;

revoke all on function public.free_account_storage_usage_v1() from public,anon;
grant execute on function public.free_account_storage_usage_v1() to authenticated;

-- This retains the existing household quota, role checks, and storage object
-- reservation workflow, adding an independent Free-user ceiling.
create or replace function public.reserve_household_file_v1(
  p_household_id uuid,
  p_title text,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_category text,
  p_notes text
)
returns table(file_id uuid, storage_path text)
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_ent record;
  v_id uuid:=gen_random_uuid();
  v_safe_name text;
  v_path text;
  v_personal_used bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_module_access(p_household_id,'files','full') then
    raise exception 'Files write access required';
  end if;
  if coalesce(trim(p_title),'')='' then raise exception 'File title is required'; end if;
  if coalesce(trim(p_file_name),'')='' then raise exception 'File name is required'; end if;
  if p_file_size is null or p_file_size<=0 then raise exception 'File size is required'; end if;
  if p_file_size>52428800 then raise exception 'Files can be up to 50 MB each'; end if;
  if p_category not in ('document','photo','receipt','school','home','other') then
    raise exception 'Invalid file category';
  end if;

  -- Serialise this user's reservations so parallel uploads cannot both exceed
  -- their individual 1 GiB allocation.
  if exists (
    select 1 from public.user_plan_overrides
    where user_id=auth.uid() and plan='free'
  ) then
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
    select coalesce(sum(f.file_size),0)::bigint
      into v_personal_used
    from public.household_files f
    where f.created_by_user_id=auth.uid()
      and f.status in ('pending','active');
    if v_personal_used+p_file_size>1073741824 then
      raise exception 'Your Free account has reached its 1 GB Files upload allowance';
    end if;
  end if;

  select * into v_ent from public.files_storage_entitlement_v1(p_household_id);
  if not v_ent.can_upload then
    if v_ent.needs_storage_offer then
      raise exception 'Storage is in downgrade grace. Keep 10 GB storage or reduce usage below 1 GB before uploading.';
    end if;
    raise exception 'Files storage limit reached';
  end if;

  if v_ent.used_bytes+p_file_size>v_ent.quota_bytes then
    raise exception 'This upload would exceed the Files storage limit';
  end if;

  v_safe_name:=regexp_replace(trim(p_file_name),'[^A-Za-z0-9._-]+','-','g');
  if v_safe_name='' then v_safe_name:='file'; end if;
  v_path:=p_household_id::text||'/'||v_id::text||'/'||v_safe_name;

  insert into public.household_files(
    id,household_id,title,file_name,storage_path,mime_type,file_size,category,notes,status,created_by_user_id
  )
  values(
    v_id,p_household_id,trim(p_title),trim(p_file_name),v_path,nullif(trim(p_mime_type),''),
    p_file_size,p_category,nullif(trim(p_notes),''),'pending',auth.uid()
  );

  return query select v_id,v_path;
end;
$$;

revoke all on function public.reserve_household_file_v1(uuid,text,text,text,bigint,text,text) from public,anon;
grant execute on function public.reserve_household_file_v1(uuid,text,text,text,bigint,text,text) to authenticated;

-- Enforce Memories quota at table level so direct inserts, the add-existing
-- workflow and event-photo imports are all covered (not just the upload UI).
create or replace function private.enforce_free_account_memories_v1()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_used bigint;
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_plan_overrides
    where user_id=auth.uid() and plan='free'
  ) then return new; end if;

  if new.created_by_user_id is distinct from auth.uid() then
    raise exception 'You can only add photos as your own user account';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 1));

  select coalesce(sum(f.file_size),0)::bigint into v_used
  from public.household_files f
  where f.id in (
    select distinct p.file_id
    from public.family_memory_photos p
    where p.created_by_user_id=auth.uid()
      and p.id is distinct from new.id
    union
    select new.file_id
  );

  if v_used>104857600 then
    raise exception 'Your Free account has reached its 100 MB Memories allowance';
  end if;
  return new;
end;
$$;

drop trigger if exists free_account_memories_quota_guard on public.family_memory_photos;
create trigger free_account_memories_quota_guard
before insert or update of file_id,created_by_user_id on public.family_memory_photos
for each row execute function private.enforce_free_account_memories_v1();
