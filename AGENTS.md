# Agent instructions — Famioo

These repository instructions are the **source of truth for every coding assistant**, including separate ChatGPT conversations, Codex, and other connected agents. Read before creating commits or releasing code.

## Branch policy (effective 2026-10-19)

- **Development branch: `staging`.** All ordinary bug fixes, improvements, UI work, and module changes must be committed to `staging`.
- **Production branch: `main`.** Netlify production continues to deploy from `main`.
- **Do not push application changes directly to `main`** unless the user explicitly approves a break-glass emergency exception. GitHub's default branch may still be `main`; for tools, explicitly specify `branch: staging`.
- Fetch the latest branch heads before editing; synchronize upstream changes without overwriting anyone else's work. Do not force-push or reset away existing commits.
- If your tools cannot write to `staging`, stop and explain rather than writing to `main`.

## Release and validation

- Aim for **two manual release windows daily** (morning/evening, Europe/Berlin), not an unattended scheduled push or automatic merge.
- At each window, open and review a `staging` → `main` PR, wait for the existing `.github/workflows/ci.yml` build to pass, then merge once.
- Keep normal application tests/builds intact. Run `npm run build` locally during development when practical. Local builds do not consume GitHub Actions minutes.
- Avoid a continuously open staging → main PR when many staging pushes are planned; each update may start billable CI.
- Urgent fixes can be released outside the windows with validation.
- Do not change the application architecture, Netlify deployment configuration, or production data to save GitHub Actions minutes.

## Cross-chat rule

Every assistant/chat working on Famioo should check this file and `docs/CONTROLLED_RELEASES.md` before modifying the repo. ProPeloton Manager and Game Control Center have their own deployment rules and are not covered by this policy.

This file documents the working convention; it does **not** technically block direct `main` pushes. Use GitHub branch protection/rules when available for enforceable restrictions.
