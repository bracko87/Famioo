# Famioo Alexa / Voice Integration — Step 1 audit

Date: 2026-10-19. Scope: `staging` only; `main`, live data, and
Amazon configuration intentionally unchanged.

## Architecture reviewed

- `src/pages/VoiceIntegrationPage.tsx` — setup, permission selection,
  token generation, simulator, action history; owner/admin UI.
- `supabase/functions/famioo-voice-command/index.ts` — server-side
  Supabase Edge endpoint, bearer authentication and four actions.
- `supabase/migrations/099_alexa_voice_integration.sql` — original schema
  and RPC implementation.
- `supabase/migrations/112_voice_integration_secure_settings.sql` —
  **new** database permission migration required for the hardening.
- `src/lib/accountPlan.ts` — legacy Free/core entitlement classification.

Supported intents: `calendar_query`, `shopping_add`, `task_add` and
`reminders_query`. The calendar query uses
`voice_calendar_household_events_v1`, which filters events to household
visibility. Voice data and responses should be considered sensitive in a
shared-speaker environment.

## Completed staging-only corrections

1. External integration token now also requires its linked user to remain an
   **active owner/admin** of the same household. Rotation alone is not the
   sole means of revocation.
2. Endpoint verifies the `voice_integration` entitlement before executing
   any command, in addition to the individual target module entitlement.
3. Reject oversized (over 4,096 characters) or malformed JSON bodies and
   invalid slot shapes. Limit task/shopping title, quantity and list name
   lengths; validate real calendar dates rather than silently treating
   malformed dates as today.
4. Shopping list selection uses literal `eq` instead of case-insensitive
   SQL wildcard `ilike`; accidental or malicious wildcard titles cannot
   choose an unintended list.
5. Unexpected backend errors do not return database diagnostics or exception
   details in speech/HTTP responses. Error details are kept in server logs.
6. Migration 112 revokes **direct INSERT/UPDATE/DELETE** on
   `voice_integration_settings` for authenticated clients. Existing
   owner/admin permission and token-rotation RPCs use guarded
   `SECURITY DEFINER` functions with explicit membership/role checks.
7. **New configurations** now start with no voice actions selected.
   Existing saved action permissions remain unchanged. The Voice Integration
   UI describes this as a **private testing foundation**, not a live
   Amazon Alexa connection.

## Validation and blockers

Source-level inspection after commits confirms the authorization checks,
validated request shapes, narrowed grants and opt-in permission defaults.
**No actual Supabase migration was applied** (Famioo project not available
through the connected Supabase account), and **no Edge Function was
deployed**. No test on a real Alexa device and no successful build or
live database permission test are claimed.

**Blockers before using Alexa outside a controlled private experiment:**

- **Idempotency/replay protection is implemented in `staging`**, but
  migration 113 and the new Edge Function must be deployed and tested before
  it can protect the live application. Each task/shopping request must carry
  `request_id` (16–160 safe characters; Alexa's `request.requestId` is suitable).
  Retry the **same** request with the **same** ID and slot values; each new
  utterance gets a **new** ID. The transaction and result receipt prevent
  concurrent retries from creating duplicate data.
  - Migration: `supabase/migrations/113_voice_command_idempotency.sql`
  - Simulator: “Retry previous write (no duplicate)” replays the exact
    previous write, including its ID and payload.
  - Reusing an ID for a different command or data returns HTTP 409.
  - Original response is stored per household/request ID for future replays.
  - Receipt cleanup/retention and production concurrency validation remain
    required before an Alexa public release.
- **Request throttling and abuse controls** with backend state and observable
  logs to limit stolen-token and high-volume requests.
- **Amazon Skill and OAuth account linking** do not exist yet. A long-lived
  shared bearer token must never ship in an Alexa device/client. The
  deployment's Supabase Edge JWT verification mode needs review before
  accepting external requests.
- **Subscription model**: migration 099 marks voice integration as
  `is_core=true`, and `accountPlan.ts` also includes it among Free
  modules. If Alexa is a paid option, update frontend **and server-side**
  entitlements in a separate approved billing release. Do not turn it paid
  while payment/entitlements are undecided.
- Household privacy: anyone close to a shared Echo might speak the
  command. Private events, sensitive/child data, SOS, purchases and
  privileged actions stay outside the initial Skill. Consider per-voice
  speaker restrictions only after realistic tests of identity limitations.

## Idempotency validation (migration 113)

This is a **migration + Edge deployment pair**. Do not deploy the Edge
mutation changes without migration 113 or new task/shopping commands will
fail (unavailable RPC). Apply earlier prerequisites (099 and 112) first.

1. In the Voice Integration simulator, enable `task_add`, create a test task,
   press **Retry previous write (no duplicate)** and verify that only **one**
   task exists. The second response should include `replayed:true` and the
   original `task_id`.
2. Repeat with `shopping_add`, including an empty shopping-list directory.
   Only one new item (and one new default list, if applicable) should exist.
3. Press **Run voice test** again (new ID) to confirm that a deliberate second
   spoken command can create another task or item.
4. Attempt the same `request_id` with changed title or intent via a controlled
   development call: expect HTTP 409 and zero additional writes.
5. Send at least two **concurrent** identical requests and confirm one write
   and two successful responses referencing the same record. Test both intents.
6. Send a mutation *without* a request ID; expect HTTP 400 and no new record.
7. Disable voice action or revoke linked owner/admin access. New requests and
   replays must be rejected, even if a valid idempotency receipt already exists.
8. Confirm `anon` and ordinary `authenticated` JWTs cannot invoke
   `voice_create_once_v1` or read `voice_command_receipts` directly.
9. Verify a database failure rolls back both new records and the receipt,
   making a legitimate retry possible after the error is corrected.
10. Inspect idempotency receipt growth after testing. Plan a controlled cleanup
    policy no earlier than 30 days after creation; no automatic purge is
    included in this migration.

## Release verification checklist

- [ ] Deploy database migrations 099 (if not applied), 112 and 113 in order to
  the **Famioo** Supabase project; confirm RLS and grants on settings.
- [ ] Deploy updated `famioo-voice-command` Edge Function into a controlled
  development/test environment (do not expose the shared token publicly).
- [ ] Authorized owner can save settings and rotate a token; ordinary member
  cannot change these.
- [ ] Direct table update of token_hash from a browser JWT fails.
- [ ] Old token rejects after rotation; disabled setting rejects all actions.
- [ ] Removing/demoting linked owner/admin immediately revokes token use.
- [ ] Other-household token cannot access a different household.
- [ ] Disabled or expired Voice/Calendar/Tasks/Shopping module is rejected.
- [ ] Malformed dates, oversized bodies, non-string slot values and
  wildcard list names do not mutate data.
- [ ] Household-only calendar queries never return private events.
- [ ] Backend returns generic failure to Alexa, without DB error details.
- [ ] Run the idempotency/concurrency tests above and add request rate-limiting
  tests before claiming launch-ready.
- [ ] Run `npm run build` and controlled PR checks before a manual merge.
