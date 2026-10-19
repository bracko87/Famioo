# Famioo: controlled GitHub release process

## Normal development

- Use the `staging` branch for new application changes and fixes.
- Keep the GitHub-connected production deployment pointing to `main` in Netlify.
- Changes pushed to `staging` do not trigger the current GitHub Actions CI workflow (it triggers on `main` pushes and PRs targeting `main`).
- This is a working convention, **not enforced GitHub main-branch protection**. Tell every coding agent to use `staging`. An agent that pushes directly to `main` can still trigger CI and production deployment.

## Release windows

- Prefer **two release reviews per day**, morning and evening Europe/Berlin. These are manual windows, not automated merges.
- At each window, open a pull request from `staging` to `main`, review all changes, wait for the CI production build to pass, then merge once.
- Avoid leaving a staging-to-main PR open between windows if many staging commits will be pushed; an open PR can run CI on every new commit.
- Urgent fixes may receive an extra release once reviewed.
- No automatic merges and no scheduled pushes are enabled.

## CI and billing

- Existing `.github/workflows/ci.yml` stays unchanged: it already has concurrency cancellation and one build job.
- A build is still required for production changes. Do not bypass failed checks to save Actions minutes.
- GitHub Actions minutes are counted against the **monthly** allowance for eligible private-repository jobs.
- If the monthly allowance is exhausted, restore access via the account's approved billing budget or wait for the next reset before relying on CI results.
- For enforced control of direct `main` pushes, configure GitHub branch rules/protection separately in repository settings if available for your plan.
