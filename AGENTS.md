# Famioo — mandatory instructions for all coding assistants

These rules apply to every ChatGPT conversation, Codex task, IDE assistant and other coding agent. Read this file and `docs/CONTROLLED_RELEASES.md` on `main` before changing code.

## Branch policy — PUBLIC development, main only (2026-10-20)
- The repository is intentionally PUBLIC while in development. **Only `main` is active for ordinary development**, fixes, documentation, tests and new modules. Work from the latest `main` head, explicitly select `branch: main` in write tools, and never push to or merge from the legacy `staging` branch.
- `staging` remains untouched as a backup; do not delete it, re-enable its workflows or create new staging branches. When source code becomes private at launch, revisit Actions billing and deployment settings separately.
- Never assume publishing GitHub code means the live Famioo app should be published. **Netlify is already connected to `main`**; all development pushes could redeploy the real website if its builds are active.
- **Before beginning main-only development, the owner must set Famioo's Netlify build status to Stopped builds** in Project configuration → Developer settings → Continuous deployment → Build settings. Do not push any release or feature to `main` until this has been explicitly confirmed by the owner.
- The last published site should remain live while builds are stopped. Never reactivate Netlify builds, trigger a manual deploy, change the production branch, or apply Supabase migrations/Edge Functions without explicit owner authorization.
- Make routine `main` commits only while builds are confirmed stopped. All development checks must run locally (`npm run build` and relevant tests) and GitHub Actions on standard Linux runners can validate source while the repository is public; Netlify deployment remains separate.
- `.github/workflows/ci.yml` is retained for `main` build checks. Github Actions standard runners are free in public repos, but storage, larger runners and Netlify build/deploy credits can still incur costs.

## Mandatory invitation rollout safety
- `supabase/migrations/116_invitation_acceptance_before_membership.sql`, `supabase/functions/manage-household-user/index.ts` and invitation UI are a coordinated feature, **not automatically authorized for the live backend/site** by merging source code into `main`.
- Before allowing a deployment to reach users, follow `docs/INVITATION_FLOW.md`: validate database migration and Edge Function deployment in the Famioo Supabase project, configure and test SMTP, test new/existing user acceptance, and obtain the owner's explicit release approval.
- No assistant should claim a feature is live merely because source is on `main`, and no unapproved production database writes, RLS modifications, Auth invites, real email sends, or user deletion should be performed.

## Security
- Never commit secrets, Supabase service-role credentials, private keys, real payment/card data, family records, contact lists, or medical information to a public repository. Keep secrets in Supabase/Netlify protected configuration, not Git history.
- Public source code and historical commits may be copied and cannot be made confidential retroactively by switching the repository back to private.
- Check the latest Git state before any write; never force-push or overwrite another worker's commits.

## Scope
- Famioo changes only. Do not edit Airlinerra, ProPeloton Manager, Tennis Legacy, Game Control Center or other repositories under Famioo tasks.
- This is a working instruction; actual Netlify deployment protection comes from **Stopped builds**, and any GitHub write permissions are controlled separately by the repository owner.
