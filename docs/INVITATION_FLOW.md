# Famioo household invitations — controlled rollout

## Correct lifecycle

1. **Owner requests an invitation.** The Edge Function validates the owner and the recipient email.
2. **Existing registered email**: create a pending invitation for the existing Auth user without duplicating them; request a Supabase Magic Link email to the already-registered address. Both email and in-app invitations should guide them to sign in and accept.
3. **New email**: request an invitation through Supabase Auth (via custom SMTP) and create a pending household invitation record. Supabase accepting the request **does not confirm email delivery**.
4. **Recipient opens Famioo** via the Auth invitation or Magic Link email. They can install the current web app on their Home Screen using their mobile browser; installation is optional for acceptance. They sign in (or request a fresh sign-in link). Newly invited Auth users set their password on the acceptance screen.
5. **Recipient explicitly accepts.** RPC `accept_household_invitation_v2` checks exact Auth user ID, verified email, pending status and expiry; it atomically grants membership and records acceptance.
6. **Only then** does the person appear as an active member. Open the newly joined household automatically. Pending invitations have a separate section in Users Settings. Owners can resend a fresh link or revoke an outstanding invitation.

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


## Invitation email and current web-app installation

The trusted Famioo web-app URL is **https://famioo.netlify.app/app**. This is a progressive web app (PWA), not an App Store binary:
- iPhone/iPad: open in **Safari → Share → Add to Home Screen**.
- Android: open in **Chrome → Install app** or **Add to Home screen** when available.
- Desktop: open the link in a browser; install if offered.
- Recipients may sign in and accept their household invitation without first installing the PWA.
- After an actual App Store / Play Store release, replace the secondary installation link with the respective official store destinations; retain Auth sign-in and household acceptance as separate secured steps.

**Configure both Supabase Auth email templates** in the [Auth Email Templates dashboard](https://supabase.com/dashboard/project/pqnotyfcypxsspyhtcqn/auth/templates). The Edge Function requests these emails; it cannot override the project-wide template HTML. Customize both the `Invite user` and `Magic Link` templates, or existing Famioo users will only receive the default sign-in email.

Suggested *Invite user* template:

```html
<h2>You're invited to join a household on Famioo</h2>
<p>Open the secure invitation below to finish signing in and choose your password. Accept the household invitation inside Famioo to join.</p>
<p><a href="{{ .ConfirmationURL }}">Open your Famioo invitation</a></p>
<p>Use Famioo on your phone: <a href="https://famioo.netlify.app/app">Open or install the Famioo web app</a>.</p>
<p>iPhone: Safari → Share → Add to Home Screen. Android: Chrome → Install app / Add to Home screen.</p>
<p>If the sign-in link expires, open the app and select "Email me a sign-in link (invited members)".</p>
```

Suggested *Magic Link* template (used for existing-user invitations, owner resends and requested sign-ins):

```html
<h2>Your Famioo sign-in link</h2>
<p>A secure sign-in link was requested. If someone invited you to a household, sign in and select Accept invitation inside Famioo.</p>
<p><a href="{{ .ConfirmationURL }}">Sign in to Famioo</a></p>
<p>Use Famioo on your phone: <a href="https://famioo.netlify.app/app">Open or install the Famioo web app</a>.</p>
<p>iPhone: Safari → Share → Add to Home Screen. Android: Chrome → Install app / Add to Home screen.</p>
```

**Email delivery prerequisites:** Use verified custom SMTP; confirm the Email provider is enabled. Set the Auth Site URL to `https://famioo.netlify.app` and allow `https://famioo.netlify.app/app` as a redirect URL. Set `FAMIOO_APP_URL=https://famioo.netlify.app` for the Edge Function or use the pinned public origin fallback. Check the actual *Invite user* and *Magic Link* messages in the recipient's inbox and spam folder. Supabase Auth links expire independently of the seven-day household offer, often much sooner. The owner can resend a sign-in link while the invitation remains pending; the user can request a link on the sign-in page.

**Do not interpret a successful Auth API response as proof of delivery.** The returned `delivery: requested` means only that Supabase accepted the request. Never activate a member merely because an email was requested or opened.

## Pre-release verification of the October 22 improvements

- New recipient: email arrives, CTA targets Famioo, first login opens pending household invitation, password selection works, explicit acceptance activates exactly one membership and navigates into the new household.
- Existing Famioo user: no duplicate Auth account; separate Magic Link email arrives, the recipient logs in, pending offer is visible even if they already belong to a different household, and acceptance switches to the newly joined household.
- Expired Auth link: recipient can request a new sign-in link or owner can use Resend email without canceling the pending invitation; rate limits and SMTP failures produce actionable errors.
- iPhone Safari: install guidance is available from the email and Famioo Mobile app settings; the app works before and after Add to Home Screen. Test session handling when the email opens in a different browser context from the installed PWA.
- Verify redirect exactness and no localhost fallback. Test cancel, expiry, wrong email identity, already-member, and malformed invitation ID cases.
- Ensure no other household data, existing accounts, stored contacts or SOS recipients are changed.
- Obtain separate owner approval for the live backend migrations and function rollout, then independent release approval for Netlify.


## Password setup and recovery for already-active household members

An active member can have a Supabase Auth password set without having seen Famioo's invitation acceptance password screen. Existing accounts may have been created directly by a household owner. Never silently overwrite those passwords, and never store owner-supplied temporary passwords in application code, a public Git history, or logs.

The login screen now offers **Forgot password?**. This calls `supabase.auth.resetPasswordForEmail` for the member's own email address, using the already configured `<origin>/app` redirect. After Supabase authenticates the email recovery link and emits `PASSWORD_RECOVERY`, the app shows a dedicated **Choose your new password** form with confirmation and a 12-character minimum; `supabase.auth.updateUser` changes only that signed-in recipient's password. Then they sign in again. Their membership and role are unaffected.

In **Settings → Users**, the household owner also has a **Password link** button beside each active adult's email account. This *requests* the same recovery email after confirmation; it never sets a password on behalf of the user. Supabase SMTP must be configured, and a successful request does not prove delivery. Do not send live reset emails without the owner's intentional button click.

Validate with one existing adult account that the recovery email arrives, the link authenticates the correct account and opens the password form, the new password works, and the prior household membership and role are preserved. Check expired link, mismatched passwords, wrong email, and the existing login/passkey flow. Netlify release approval remains separate from committing this source.
