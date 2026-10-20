# Famioo — public development on main, deployment held separately

## Effective 2026-10-20
- GitHub repository is **public** during development; all source changes go to **`main` only**. The old `staging` branch remains as an inactive backup and receives no new changes.
- Famioo has an EXISTING Netlify-hosted website. `main` remains its Git-connected production branch. **GitHub commits and Netlify releases must be decoupled**: the owner must turn Netlify Project configuration → Developer settings → Continuous deployment → Build settings → **Stopped builds** ON before a code migration or main-only development.
- Stopping Netlify builds leaves the last published website available but blocks new Git-connected builds and deploy previews; do not confuse this with pausing the Netlify site/account.
- Do not reactivate builds or trigger a production deploy without explicit owner approval. Once reactivated, a subsequent commit or manual deploy can publish all accumulated `main` changes.
- Normal development uses local `npm run build`, suitable local tests and public-repository GitHub Actions CI on `main`. The `.github/workflows/ci.yml` workflow is enabled on `main` pushes, pull requests to main, and manual dispatch. It is not a deployment authorization.
- Standard public GitHub-hosted runners are free. Larger runners, storage, Netlify builds, and hosted services may incur costs.

## Invitation feature release gate — not automatically live
1. Read `docs/INVITATION_FLOW.md` completely before any release.
2. Apply and verify `supabase/migrations/116_invitation_acceptance_before_membership.sql` on the correct Famioo project, only when separately authorized.
3. Deploy and verify updated `supabase/functions/manage-household-user/index.ts`, only when separately authorized.
4. Configure custom Auth SMTP, trusted redirect URLs and test real invitation deliverability and acceptance of both new and existing users.
5. Validate existing household memberships, SOS and contact behavior; obtain explicit owner authorization before enabling Netlify builds and deploying the public frontend.

## Security and operational limits
- Do not commit real family/medical data, payment information or secrets. Git history can be copied while public.
- Don't overwrite existing backend data, migrate a different project's database, change Netlify production settings in code to bypass owner confirmation, or claim a successful frontend build verifies Auth/SMTP/RLS.
- No automated production deployment/release is authorized merely by pushing code to `main`.
