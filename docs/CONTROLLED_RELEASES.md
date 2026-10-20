# Famioo: controlled GitHub release process

## Normal development

- Use the `staging` branch for new application changes and fixes.
- Keep the GitHub-connected production deployment pointing to `main` in Netlify.
- Pushing code to `staging` **does not** trigger paid GitHub Actions CI. Developers should use `npm run build` locally while working. GitHub CI runs on reviewed PRs targeting `main`, on `main` pushes, and via explicit manual dispatch. Markdown/docs-only changes are excluded where configured.
- This is a working convention, **not enforced GitHub main-branch protection**. Tell every coding agent to use `staging`. An agent that pushes directly to `main` can still trigger CI and production deployment.

## Release windows

- Prefer **two release reviews per day**, morning and evening Europe/Berlin. These are manual windows, not automated merges.
- At each window, open a pull request from `staging` to `main`, review all changes, validate locally, confirm the release PR checks pass, then merge once after approval.
- Avoid leaving a staging-to-main PR open between windows if many staging commits will be pushed; an open PR can run CI on every new commit.
- Urgent fixes may receive an extra release once reviewed.
- No automatic merges and no scheduled pushes are enabled.

## CI and billing

- As of 2026-10-20, `.github/workflows/ci.yml` runs on pushes to `main`, pull requests targeting `main`, or manual dispatch; not on staging pushes or staging-target PRs. It retains concurrency cancellation, a single build job and docs-only exclusions. Changes remain on `staging` until owner-reviewed release. Staging development uses local build checks to avoid paid CI minutes.
- A build is still required for production changes. Do not bypass failed checks to save Actions minutes.
- GitHub Actions minutes are counted against the **monthly** allowance for eligible private-repository jobs.
- If the monthly allowance is exhausted, restore access via the account's approved billing budget or wait for the next reset before relying on CI results.
- For enforced control of direct `main` pushes, configure GitHub branch rules/protection separately in repository settings if available for your plan.
