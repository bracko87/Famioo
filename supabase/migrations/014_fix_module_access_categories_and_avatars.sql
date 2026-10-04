-- Famioo migration 014
-- Fix module-access function execution, expand default event categories,
-- and add private household avatar storage.

grant execute on function private.has_module_access(uuid,text,text) to authenticated;

-- Keep the helper outside the exposed API schema; authenticated users can only
-- reach it through policies/functions that validate household membership.

update public.event_categories
set name='Medical', icon_key='medical', updated_at=now()
where is_system
  and lower(name)='doctor';

insert into public.event_categories(
  household_id,name,color_key,icon_key,sort_order,is_system,created_by_user_id
)
select h.id,v.name,v.color_key,v.icon_key,v.sort_order,true,h.created_by_user_id
from public.households h
cross join (
  values
    ('Family'::text,'purple'::text,'family'::text,10),
    ('Work'::text,'blue'::text,'work'::text,20),
    ('School'::text,'indigo'::text,'school'::text,30),
    ('Medical'::text,'green'::text,'medical'::text,40),
    ('Birthday'::text,'pink'::text,'birthday'::text,50),
    ('Travel'::text,'orange'::text,'travel'::text,60),
    ('Sport'::text,'teal'::text,'sport'::text,70),
    ('Other'::text,'slate'::text,'other'::text,80)
) as v(name,color_key,icon_key,sort_order)
where not exists (
  select 1
  from public.event_categories ec
  where ec.household_id=h.id
    and lower(ec.name)=lower(v.name)
);

insert into storage.buckets(
  id,name,public,file_size_limit,allowed_mime_types
)
values(
  'profile-avatars',
  'profile-avatars',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists profile_avatars_select_member on storage.objects;
create policy profile_avatars_select_member
on storage.objects
for select
to authenticated
using (
  bucket_id='profile-avatars'
  and private.is_household_member(
    nullif(split_part(name,'/',1),'')::uuid
  )
);

drop policy if exists profile_avatars_insert_admin_or_self on storage.objects;
create policy profile_avatars_insert_admin_or_self
on storage.objects
for insert
to authenticated
with check (
  bucket_id='profile-avatars'
  and (
    private.is_household_admin(
      nullif(split_part(name,'/',1),'')::uuid
    )
    or split_part(name,'/',2)=auth.uid()::text
  )
);

drop policy if exists profile_avatars_update_admin_or_self on storage.objects;
create policy profile_avatars_update_admin_or_self
on storage.objects
for update
to authenticated
using (
  bucket_id='profile-avatars'
  and (
    private.is_household_admin(
      nullif(split_part(name,'/',1),'')::uuid
    )
    or split_part(name,'/',2)=auth.uid()::text
  )
)
with check (
  bucket_id='profile-avatars'
  and (
    private.is_household_admin(
      nullif(split_part(name,'/',1),'')::uuid
    )
    or split_part(name,'/',2)=auth.uid()::text
  )
);

drop policy if exists profile_avatars_delete_admin_or_self on storage.objects;
create policy profile_avatars_delete_admin_or_self
on storage.objects
for delete
to authenticated
using (
  bucket_id='profile-avatars'
  and (
    private.is_household_admin(
      nullif(split_part(name,'/',1),'')::uuid
    )
    or split_part(name,'/',2)=auth.uid()::text
  )
);
