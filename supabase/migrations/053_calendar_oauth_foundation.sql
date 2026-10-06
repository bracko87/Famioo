-- Famioo migration 053
-- OAuth state and encrypted token storage for Calendar Connections.
-- These tables are service-only: authenticated users receive no direct grants.

create table if not exists public.calendar_oauth_states(
  state text primary key,
  provider text not null check(provider in ('microsoft','google')),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  target_calendar_id uuid not null,
  import_mode text not null check(import_mode in ('busy','title','full')),
  display_name text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '10 minutes'),
  used_at timestamptz null,
  constraint calendar_oauth_states_target_fk
    foreign key(household_id,target_calendar_id)
    references public.calendars(household_id,id)
);

create index if not exists calendar_oauth_states_expiry_idx
  on public.calendar_oauth_states(expires_at,used_at);


create table if not exists public.calendar_connection_tokens(
  connection_id uuid primary key references public.calendar_connections(id) on delete cascade,
  provider text not null check(provider in ('microsoft','google')),
  access_token_ciphertext text not null,
  access_token_iv text not null,
  refresh_token_ciphertext text null,
  refresh_token_iv text null,
  token_expires_at timestamptz null,
  scope_text text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.calendar_oauth_states enable row level security;
alter table public.calendar_connection_tokens enable row level security;

revoke all on public.calendar_oauth_states from anon,authenticated;
revoke all on public.calendar_connection_tokens from anon,authenticated;
