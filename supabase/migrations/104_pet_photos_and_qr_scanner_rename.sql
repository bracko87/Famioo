-- Famioo migration 104
-- Persistent pet profile photos and QR Scanner naming.

alter table public.family_pets
  add column if not exists photo_path text;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'pet-media','pet-media',false,5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists pet_media_select on storage.objects;
create policy pet_media_select
on storage.objects for select to authenticated
using(
  bucket_id='pet-media'
  and exists(
    select 1 from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'pets','read')
  )
);

drop policy if exists pet_media_insert on storage.objects;
create policy pet_media_insert
on storage.objects for insert to authenticated
with check(
  bucket_id='pet-media'
  and exists(
    select 1 from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'pets','full')
  )
);

drop policy if exists pet_media_update on storage.objects;
create policy pet_media_update
on storage.objects for update to authenticated
using(
  bucket_id='pet-media'
  and exists(
    select 1 from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'pets','full')
  )
)
with check(
  bucket_id='pet-media'
  and exists(
    select 1 from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'pets','full')
  )
);

drop policy if exists pet_media_delete on storage.objects;
create policy pet_media_delete
on storage.objects for delete to authenticated
using(
  bucket_id='pet-media'
  and exists(
    select 1 from public.household_members hm
    where hm.user_id=auth.uid()
      and hm.status='active'
      and hm.household_id::text=(storage.foldername(name))[1]
      and private.has_module_access(hm.household_id,'pets','full')
  )
);

update public.modules
set name='QR Scanner',
    description='Scan QR codes and automatically organize links, events and digital tickets'
where code='tickets';

update public.billing_products
set name='QR Scanner',
    updated_at=now()
where product_code='module_tickets';
