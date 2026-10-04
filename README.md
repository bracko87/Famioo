# Famioo

Clean rebuild of the Famioo family organizer.

## Architecture

- React + TypeScript + Vite
- Supabase Auth + Postgres
- One application/database for many independent households
- Row Level Security isolates every household
- Household-level module entitlements
- Core first: Home, Calendar, Tasks, Checklists
- Paid modules are added only after the core is stable

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set the Famioo Supabase project URL and publishable key.
3. Run `npm install`.
4. Run `npm run dev`.

The old Dayora/Famio experiments are reference only and are not copied into this codebase.
