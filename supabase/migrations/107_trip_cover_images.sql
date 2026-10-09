-- Trip cover photos; follow the existing private pet-media storage pattern.
alter table public.family_trips add column if not exists photo_path text;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('trip-media','trip-media',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists trip_media_select on storage.objects;
create policy trip_media_select on storage.objects for select to authenticated
using(bucket_id='trip-media' and exists(
 select 1 from public.household_members m where m.user_id=auth.uid()
 and m.status='active' and m.household_id::text=(storage.foldername(name))[1]
 and private.has_module_access(m.household_id,'travel','read')
));
drop policy if exists trip_media_insert on storage.objects;
create policy trip_media_insert on storage.objects for insert to authenticated
with check(bucket_id='trip-media' and exists(
 select 1 from public.household_members m where m.user_id=auth.uid()
 and m.status='active' and m.household_id::text=(storage.foldername(name))[1]
 and private.has_module_access(m.household_id,'travel','full')
));
drop policy if exists trip_media_update on storage.objects;
create policy trip_media_update on storage.objects for update to authenticated
using(bucket_id='trip-media' and exists(
 select 1 from public.household_members m where m.user_id=auth.uid()
 and m.status='active' and m.household_id::text=(storage.foldername(name))[1]
 and private.has_module_access(m.household_id,'travel','full')
))
with check(bucket_id='trip-media' and exists(
 select 1 from public.household_members m where m.user_id=auth.uid()
 and m.status='active' and m.household_id::text=(storage.foldername(name))[1]
 and private.has_module_access(m.household_id,'travel','full')
));
drop policy if exists trip_media_delete on storage.objects;
create policy trip_media_delete on storage.objects for delete to authenticated
using(bucket_id='trip-media' and exists(
 select 1 from public.household_members m where m.user_id=auth.uid()
 and m.status='active' and m.household_id::text=(storage.foldername(name))[1]
 and private.has_module_access(m.household_id,'travel','full')
));