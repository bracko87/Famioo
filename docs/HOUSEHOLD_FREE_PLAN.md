# Household Free plan — October 2026

## Source of truth

The active household tier is read from `public.household_plan_overrides`, **not** the email address of a specific household member. The table stores only `plan='free'` overrides. If there is no override, the existing household entitlement model applies.

- `private.has_module_access` enforces the canonical Free allowlist for every active member, including future invitees. Roles and any module-level read restrictions still apply.
- `src/lib/data.ts` reads the same household tier for the homepage, promotional carousel, module navigation, Premium catalogue, and floating assistant visibility.
- The canonical Free list is in `src/lib/accountPlan.ts`. Keep its codes synchronized with migration `118_household_free_plan_enforcement.sql` and server authorization before changing the offer.
- Optional entries that used to be enabled in `household_modules` are disabled **without deleting rows**. Their pre-downgrade `enabled` and `valid_until` values are saved to `public.household_module_plan_backup`.
- `family_memory_photos` has a quota guard for new Free-household additions (100 MiB of distinct referenced files), and `free_household_memories_usage_v1` returns the same shared usage.
- Files storage is determined by `files_storage_entitlement_v1`. With no active paid billing or storage add-ons the quota is 1 GiB. Existing stored files are not removed.

## Restore a household to its previous plan (manual, approval required)

1. Confirm the intended household and billing status. Never restore purchases or charges automatically.
2. Reconcile which previous optional modules should be re-enabled. If authorized, update individual `household_modules` rows using `household_module_plan_backup` for that household (retain module codes, dates, and any additions since the downgrade).
3. Delete that household's `household_plan_overrides` row only after explicit approval.
4. Check `private.has_module_access`, homepage modules, module role permissions, paid billing status, and storage limits before publishing.
5. Do not change `modules.is_core` globally to correct a single household; legacy values may require a separately tested catalogue migration.

**Never** clear the backup, files, photos, calendars, SOS information, memberships, passwords, or invitations as part of this rollback.

## Release and verification

The production database change and a GitHub source update are independent of the Netlify frontend release. Famioo's Netlify builds are deliberately stopped; request separate release approval. After deployment, both active household members should use the same effective Free module catalogue and promo slideshow. AI Assistant's floating button must be absent for Free households. Reopen the installed iOS web app after the new deployment so that the service worker loads the latest assets.

Server verification should check:
- Exactly the expected household has a Free override; all member roles are intact.
- The signed-in Owner and Admin see identical enabled Free-module sets. `assistant`, `shopping` and other Premium modules must return false from `private.has_module_access`.
- Free Files tier is 1 GiB, shared Memories quota is 100 MiB, paid monthly billing is zero.
- No optional `household_modules` record is enabled, and previous values remain in the backup.
- Both PWA installations display the same Free Home modules and promotions after a confirmed Netlify release.
