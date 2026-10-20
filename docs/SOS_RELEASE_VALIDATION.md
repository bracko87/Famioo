# Family Safety — SOS staging acceptance and release checks

This is a high-priority feature. Passing a web build does **not** prove
delivery to another phone. Validate the flow on real devices before making
any claims about family/emergency notification reliability.

## Scope

- Prepare household phone numbers via the existing protected profile-phone RPC
- Prepare local emergency and trusted-service numbers via shared Family Contacts
- Dedicated direct dial buttons open the device telephone app; Famioo never
  places emergency-service calls automatically
- Single-tap "SEND FAMILY SOS NOW" replaces the 2-second hold
- A server-side active alert and household notification queue follow immediately
- Optional geolocation is requested after the alert and never blocks submission
- Other logged-in users see an urgent in-app banner while Famioo is open
- Native audible/critical alert, background tracking and hardware triggers
  remain gated on actual Android/iOS implementations

## Database release dependency

Apply `supabase/migrations/110_safety_sos_notify_all_household.sql` on the
Famioo Supabase project before describing push as household-wide.
The original function in migration 080 only selected adults when any adult
recipient existed. Migration 110 sends notification rows to every other
active household login, retaining the existing duplicate-safe source_key.
Never confuse a queued notification with a received device push.

## Phone-number save dependency

Apply `supabase/migrations/111_fix_safety_phone_validation.sql` to the Famioo
Supabase backend. Migration 081 accidentally used a double backslash in the
PostgreSQL phone regex. The updated check constraint and save RPC accept
international `+country code` phone numbers consistently with the frontend.

Test saving a valid number in Safety, then confirm the **same** number appears
in Family Contacts → Contacts → household members. Verify saving a malformed
number is rejected and saving someone else's number is limited by the original
ownership/admin permission checks. A Netlify deployment does not run this
migration by itself.

## Simplified SOS setup and contact management

Once a household has **at least one saved household phone number**, the entire
three-part setup panel disappears from Safety/SOS. It returns if that final
saved household number is removed. Emergency-service contacts and additional
household numbers are recommended but **do not block setup completion**.
A family SOS can always be sent even without a saved telephone number.

Household numbers are managed in Family Contacts → Your Famioo household,
with **Edit / remove number**. Clearing a number updates only the linked
profile's `contact_phone`, not the member, their login or their ability to
receive Famioo in-app alerts. Emergency service numbers continue to be
managed through the shared Family Contacts directory.

Push configuration and **Send test** remain accessible for every device at
Settings → Notifications & Security, linked from Family Contacts. Contact
readiness is **not** proof of push delivery.

## Medical & Safety / Emergency Information permission fix

Deploy `supabase/migrations/115_fix_emergency_guardian_contact_access.sql`
to the Famioo Supabase project after migration 093. It repairs a 403
`permission denied for table family_contacts` triggered by Emergency
Information guardian RLS rules and write RPCs checking the protected
`family_contacts` table as an unprivileged user.

Migration 115 uses a narrowly scoped authenticated household-membership
SECURITY DEFINER helper. It preserves the directory's no-direct-table-access
policy, active household role/module checks and existing records.

- [ ] Medical & Safety opens without 403 when guardian list is empty
- [ ] Existing emergency service contacts display; contacts remain private
- [ ] Add/edit a family emergency profile with a linked doctor contact
- [ ] Assign, edit and remove a guardian emergency contact
- [ ] Verify a caller from another household cannot see or assign contacts
- [ ] Confirm direct SELECT on `public.family_contacts` remains forbidden

## Required device tests

- [ ] Set up a household with at least two **different** user logins on two phones
- [ ] Verify each phone has a current push subscription and notification permission
- [ ] Send a test push to each device from Settings → Notifications & Security
- [ ] Save exactly one household phone, with zero emergency-service contacts; verify SOS setup disappears, and open Family Contacts to change numbers
- [ ] Remove a stored number in Family Contacts without removing that household member; verify SOS setup returns if fewer than one number remains
- [ ] Prepare additional household numbers and verify all phones remain visible in Family Contacts
- [ ] Save a local emergency-service contact (optional for readiness); dial link opens the native phone dialer and setup stays dismissed
- [ ] Test no available network / disabled location: error surfaced, no false "sent" claim
- [ ] Test a phone without geolocation: SOS notification is still queued
- [ ] Trigger once; confirm only one active alert is created and repeated taps do not queue duplicates
- [ ] Recipient with Famioo open: red SOS banner appears, links to active Safety alert
- [ ] Recipient in background: push appears if supported/enabled, record arrival time
- [ ] Recipient screen locked: verify notification appears where OS allows
- [ ] Recipient acknowledges as responding, sender sees acknowledgement
- [ ] Caller uses the correct family number and a saved emergency dial link
- [ ] Resolve/false-alarm handling clears active alert and banner
- [ ] Test absent phone numbers: configuration warning appears without blocking urgent SOS
- [ ] Test with child login: household-wide notification row created after migration 110
- [ ] Test alerts under poor connectivity and document delivery limits

## Known platform limitations

- PWA push can be delayed or blocked by the OS/browser, permissions, network
  and battery optimization. The worker processes notifications asynchronously.
- An SOS does **not** call police, ambulance or any emergency service.
- Incoming browser WebRTC calls are not reliable in background/locked-phone mode;
  TURN and native call integration are required for production-grade calls.
- The PWA cannot guarantee an alarm sound, bypass silent/DND, or show
  critical alerts on iOS. Native notifications need per-platform implementation
  and eligibility checks (see `docs/NATIVE_RELEASE_SAFETY_PLAN.md`).
- Do not use an untested Famioo SOS as a replacement for local emergency services.
