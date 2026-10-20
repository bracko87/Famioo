# Famioo household invitations — controlled rollout

## Correct lifecycle

1. **Owner requests an invitation.** The Edge Function validates the owner and the recipient email.
2. **Existing registered email**: create an in-app pending invitation for the existing Auth user without duplicating the user or sending an Auth email. Ask them to sign in.
3. **New email**: request an invitation through Supabase Auth (via custom SMTP) and create a pending household invitation record. Supabase accepting the request **does not confirm email delivery**.
4. **Recipient signs in** via the email invite link (or their existing Famioo credentials). Newly invited Auth users set their password on the acceptance screen.
5. **Recipient explicitly accepts.** RPC `accept_household_invitation_v2` checks exact Auth user ID, verified email, pending status and expiry; it atomically grants membership and records acceptance.
6. **Only then** does the person appear as an active member. Pending invitations have a separate section in Users Settings. Owners can revoke an outstanding invitation.

## Deployment order — mandatory

- Store development code on **public `main`** while the Famioo Netlify site's builds are set to **Stopped builds**. Source commits alone do not authorize a deployment.
- **First** apply `supabase/migrations/116_invitation_acceptance_before_membership.sql` to the Famioo Supabase project `pqnotyfcypxsspyhtcqn` (not another project's DB).
- **Next** deploy `supabase/functions/manage-household-user/index.ts` to that same project's Edge Functions. Preserve its service role key and JWT verification; it already enforces owner checks for invitation creation/revocation. Verify function deployment.
- **Then** configure a **custom SMTP provider** in Supabase Authentication → SMTP Settings and confirm the Site URL and Redirect URL allowlist. If configuring `FAMIOO_APP_URL` for the Edge Function, use the trusted public HTTPS site origin (no trailing slash); add `<origin>/app` to Auth allowed redirect URLs. Never use an untrusted request Origin as a redirect.
- **Only after backend readiness and end-to-end acceptance tests** obtain explicit owner approval to reactivate Netlify builds and deploy the frontend from `main`. An SPA build alone does not validate Auth email delivery, Edge Function or RLS.

## Manual acceptance checklist

- [ ] The invite form to a **new** email results in a pending invitation but no `household_members` row or `family_profiles` row for that recipient.
- [ ] Verify a real Auth invite email arrives (also check spam). Test failed SMTP: show an error and do not grant household access.
- [ ] Use the link, choose a password, select **Accept invitation**, and confirm exactly one active member and matching profile are created.
- [ ] Confirm the signed-in recipient with an existing account receives an **in-app** pending invitation; no duplicate Auth account is created.
- [ ] Test wrong account (including emails with `.com` vs `.de`): it cannot accept someone else's invitation.
- [ ] Verify the user cannot accept before email verification or after expiry/cancellation.
- [ ] Verify owner revocation removes the pending offer without deleting the recipient's Auth account.
- [ ] Verify the standard **Create user** flow still works and onboarding without an invitation remains available.
- [ ] Verify an existing active member is not silently demoted or reset. This migration intentionally does not convert legacy active members back into pending.
- [ ] Confirm original household member's roles, data, and SOS notification recipients are unaffected.

**Important:** Supabase's default email service is not suitable for production use and may refuse messages to addresses outside the project's team. Use custom SMTP and Auth logs to troubleshoot email delivery. Never claim an email arrived based solely on a successful Auth API response.

## Existing duplicated Auth users

An older invitation may have already created/activated a household member. This migration does not automatically remove, merge or change any such records. Two similar display names with different email addresses are **different** Auth accounts. Before removing any, verify which email account the intended recipient can access, compare last sign-in and confirmation fields, and confirm linked household membership.
