-- Famioo migration 049
-- Prepare client-side end-to-end encryption without falsely marking existing data as E2EE.
-- No plaintext encryption keys are stored in these tables.

create table if not exists public.household_encryption_settings(
  household_id uuid primary key references public.households(id) on delete cascade,
  mode text not null default 'server_private'
    check(mode in ('server_private','client_e2ee')),
  key_version integer not null default 1 check(key_version>=1),
  rollout_status text not null default 'prepared'
    check(rollout_status in ('prepared','pilot','active')),
  updated_at timestamptz not null default now()
);

insert into public.household_encryption_settings(household_id)
select id from public.households
on conflict(household_id) do nothing;

alter table public.household_encryption_settings enable row level security;

drop policy if exists household_encryption_settings_read on public.household_encryption_settings;
create policy household_encryption_settings_read
on public.household_encryption_settings
for select
to authenticated
using(private.is_household_member(household_id));

drop policy if exists household_encryption_settings_admin_update on public.household_encryption_settings;
create policy household_encryption_settings_admin_update
on public.household_encryption_settings
for update
to authenticated
using(private.is_household_admin_or_owner(household_id))
with check(private.is_household_admin_or_owner(household_id));

grant select,update on public.household_encryption_settings to authenticated;


create table if not exists public.user_device_public_keys(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_label text not null,
  algorithm text not null default 'ECDH-P256'
    check(algorithm in ('ECDH-P256')),
  public_key_jwk jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.user_device_public_keys enable row level security;

drop policy if exists user_device_public_keys_self_read on public.user_device_public_keys;
create policy user_device_public_keys_self_read
on public.user_device_public_keys
for select
to authenticated
using(user_id=auth.uid());

drop policy if exists user_device_public_keys_self_insert on public.user_device_public_keys;
create policy user_device_public_keys_self_insert
on public.user_device_public_keys
for insert
to authenticated
with check(user_id=auth.uid());

drop policy if exists user_device_public_keys_self_update on public.user_device_public_keys;
create policy user_device_public_keys_self_update
on public.user_device_public_keys
for update
to authenticated
using(user_id=auth.uid())
with check(user_id=auth.uid());

grant select,insert,update on public.user_device_public_keys to authenticated;


create table if not exists public.household_key_wraps(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  device_key_id uuid not null references public.user_device_public_keys(id) on delete cascade,
  key_version integer not null check(key_version>=1),
  wrap_algorithm text not null default 'ECDH-P256-HKDF-AESGCM',
  wrapped_household_key text not null,
  wrap_iv text not null,
  created_by_user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  unique(household_id,device_key_id,key_version)
);

alter table public.household_key_wraps enable row level security;

drop policy if exists household_key_wraps_member_read on public.household_key_wraps;
create policy household_key_wraps_member_read
on public.household_key_wraps
for select
to authenticated
using(
  private.is_household_member(household_id)
  and exists(
    select 1 from public.user_device_public_keys dk
    where dk.id=device_key_id and dk.user_id=auth.uid() and dk.active
  )
);

drop policy if exists household_key_wraps_admin_insert on public.household_key_wraps;
create policy household_key_wraps_admin_insert
on public.household_key_wraps
for insert
to authenticated
with check(private.is_household_admin_or_owner(household_id));

grant select,insert on public.household_key_wraps to authenticated;


create table if not exists public.private_data_envelopes(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  module_code text not null references public.modules(code) on delete restrict,
  record_id uuid not null,
  payload_kind text not null default 'record',
  cipher text not null default 'AES-GCM-256'
    check(cipher in ('AES-GCM-256')),
  key_version integer not null check(key_version>=1),
  iv text not null,
  ciphertext text not null,
  schema_version integer not null default 1 check(schema_version>=1),
  created_by_user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(household_id,module_code,record_id,payload_kind)
);

alter table public.private_data_envelopes enable row level security;

drop policy if exists private_data_envelopes_member_read on public.private_data_envelopes;
create policy private_data_envelopes_member_read
on public.private_data_envelopes
for select
to authenticated
using(private.has_module_access(household_id,module_code,'read'));

drop policy if exists private_data_envelopes_full_write on public.private_data_envelopes;
create policy private_data_envelopes_full_write
on public.private_data_envelopes
for all
to authenticated
using(private.has_module_access(household_id,module_code,'full'))
with check(private.has_module_access(household_id,module_code,'full'));

grant select,insert,update,delete on public.private_data_envelopes to authenticated;


alter table public.household_files
  add column if not exists encryption_mode text not null default 'server_private'
    check(encryption_mode in ('server_private','client_e2ee')),
  add column if not exists encryption_version integer null,
  add column if not exists encryption_iv text null;
