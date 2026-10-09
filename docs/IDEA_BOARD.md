# Famioo Idea Board

This document collects future product ideas. Items here are ideas, not committed implementation scope unless explicitly moved into the roadmap.\n\nCanonical implementation roadmap: `docs/MODULE_ROADMAP.md`.

## User-requested ideas

### TV Remote / Home Remote
Status: Idea

A Famioo module that lets household members control supported TVs and living-room devices from the Famioo mobile app.

Possible scope:
- Apple TV / Android TV / Google TV / Fire TV where platform APIs permit it
- Power, volume, mute, navigation and playback controls
- Per-room device list
- Child permissions / restricted controls
- Optional shortcuts from the Famioo Home dashboard

### Family Safety / SOS
Status: PWA V1 implemented — native Android/iOS Safety extensions and real-device testing remain mandatory before native release

A child-friendly emergency feature that alerts trusted members of the same Famioo household/group if the child feels unsafe or is in danger.

Proposed V1:
- Large SOS button in Child Mode
- Press-and-hold to reduce accidental triggers
- Immediately create an active safety alert for the household
- Send push notifications to all selected adults/trusted members
- Include current location when the child has granted location permission
- Open a dedicated alert screen for adults with:
  - child/member name
  - time of alert
  - current/last known location
  - call child
  - message child
  - acknowledge "I am responding"
  - mark resolved
- Keep a short safety-alert history for guardians/admins
- Optional SMS fallback later
- No automatic emergency-services call in V1

Possible later extensions:
- discreet SOS mode
- live location updates while an SOS remains active
- safe-arrival / "I'm safe" button
- location-based safe zones
- smartwatch / lock-screen shortcut
- emergency contacts outside the Famioo household
- critical/high-priority notification support where the mobile OS permits it
- hardware-button / locked-phone SOS trigger where the mobile operating system permits it

Native implementation and test requirements are permanently documented in `docs/NATIVE_RELEASE_SAFETY_PLAN.md`.

Hardware-trigger feasibility:
- Current web/PWA version cannot listen for side/volume-button combinations while the phone is locked or the app is in the background.
- Android native version: investigate a dedicated SOS trigger that can work with the screen locked. Android accessibility key filtering can technically receive global key events, but use of AccessibilityService is policy-sensitive and requires explicit user enablement/disclosure, so it must not be the only SOS path.
- iPhone: third-party apps cannot replace/intercept Apple's side/volume Emergency SOS combinations. Use Apple's own Emergency SOS for true hardware emergency calling; Famioo should provide lock-screen/widget/watch/shortcut alternatives where supported.
- If the device is physically powered off, no Famioo trigger can work.
- Preferred Famioo fallback hierarchy: in-app hold-to-SOS button → lock-screen/widget/shortcut → smartwatch trigger → native Android hardware trigger if a compliant implementation is available.

### Family Messenger
Status: Approved idea

Private household/group chat with text, photo and voice messages, with video messages as a possible later extension.

### Family Contacts Directory
Status: PWA V1 implemented

A shared household directory for important people and services beyond Famioo account members.

Current Famioo foundation:
- Household member email/phone data is already exposed through `household_users_v1`.
- This is not yet a true shared contacts directory.

Planned directory scope:
- grandparents and relatives
- babysitters
- doctors and pharmacies
- School/Kita contacts
- neighbours
- emergency contacts
- addresses, phone numbers, email and notes
- optional links to Calendar events and Safety/SOS

### Comments & Photos Directly on Events
Status: Approved idea

Allow household members to add comments, photos and files directly to a Calendar event so planning and discussion stay with the event.

### Family Photo Albums Linked to Events
Status: Approved idea

Shared family albums connected to Calendar events/dates, with photos from birthdays, holidays, trips, school events and other memories.

### Child Rewards Economy
Status: Approved idea

Connect chores/tasks to configurable points or stars and allow parents to create a controlled reward catalogue for children.

### Shared Memo / Someday Area
Status: Approved idea

A shared place for undated ideas, notes, places to visit and future plans that can later be converted into Calendar events, Tasks or Projects.

## Existing future-module ideas

- Family Location / map and safe places
- Travel & Trips
- Vehicles
- Pets
- Family Inbox / Scan
- Emergency Information
- Alexa / Voice integration
- Family Contacts
- Child rewards / gamification
- QR / Ticket Wallet redesign

## Research candidates — not yet approved

### Multiple Circles / Groups
Separate private spaces for household, extended family, grandparents, friends, neighbours or a sports group.

### Safe Places / Arrival & Departure Alerts
Define places such as Home, School, Kita or Work and notify selected family members when someone arrives or leaves.

### Custom Dashboard Widgets
Let each household/member choose dashboard widgets such as upcoming events, chores, meals, favourite lists, family members or school items.

### Meal Plan Templates & Meal Queue
Save repeatable weekly meal plans and keep an unscheduled queue of meals to cook soon.

### Shopping Barcode Scanner
Scan product barcodes to add items to shopping lists quickly.

### Crash / Journey Safety
Longer-term safety concept using phone motion/location data to detect a likely crash or failed arrival and alert trusted family members.

### Family Check-In
Simple buttons such as "I'm home", "I'm safe", "Pick me up" and "Running late", optionally linked to location and calendar context.

### Pickup Authorization
For children: show who is approved to pick them up today, with optional one-time approval and guardian confirmation.

### Home Presence Board
Optional household view showing who is home, away, at school/work or expected home soon, based on calendar and location permissions.
