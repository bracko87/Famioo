# Supabase database workflow

Famioo uses the Supabase project:

- Project: `Famioo`
- Ref: `pqnotyfcypxsspyhtcqn`
- Region: Frankfurt (`eu-central-1`)

## Rule from this point forward

Every database change must follow this order:

1. Create a numbered SQL migration in `supabase/migrations/`.
2. Commit the migration to this repository.
3. Apply that exact migration to the Famioo Supabase project.
4. Run Supabase security and performance advisors.
5. Verify the affected feature and RLS behavior.

Do not make ad-hoc production schema changes without a matching repository migration.

## Foundation already applied

The clean foundation was created before this repository existed. Supabase currently records these migrations:

1. `001_core_multi_household_identity`
2. `002_modules_and_entitlements`
3. `003_calendar_recurrence_and_reminders`
4. `004_tasks_and_checklists`
5. `005_notifications_and_preferences`
6. `006_household_bootstrap_invitations_and_tenant_guards`
7. `007_foundation_security_and_index_hardening`
8. `008_calendar_occurrence_and_atomic_event_rpcs`
9. `009_recurrence_guard_and_module_rpc_hardening`

A consolidated baseline of this initial schema should be kept with the project before any destructive reset or new environment is created. Future changes start at migration 010 and are GitHub-first.

## Multi-tenant rule

One Supabase project serves many independent households. Household-owned data must carry a `household_id`, and RLS must verify active household membership. Never use one Supabase project per family.

## Client configuration

The browser application uses only the Supabase publishable key. Never commit service-role keys, database passwords, worker tokens, or other secrets.
