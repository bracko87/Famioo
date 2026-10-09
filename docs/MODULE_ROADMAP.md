# Famioo Module Roadmap

Canonical ordered list of the Famioo modules and major family features planned for implementation.

Last updated: 2026-10-09

## Implementation order

1. [x] Family Safety / SOS — PWA V1 implemented
   - hold-to-SOS
   - household adult alerts
   - optional current location
   - adult "I'm responding" state
   - phone call / SMS shortcuts when a phone number is available
   - Famioo internet-call foundation
   - active-alert map
   - resolve / "I'm safe"
   - recent resolved-alert history
   - persistent mobile SOS shortcut
   - native Android + iOS implementation/testing is a mandatory future release gate
   - canonical native Safety release/test plan: `docs/NATIVE_RELEASE_SAFETY_PLAN.md`
   - later native extensions: live background SOS location, native incoming VoIP, lock-screen/watch/hardware-trigger research, critical/high-priority notifications, discreet SOS

2. [x] Family Location + Safe Places — PWA V1 implemented
   - shared family map with OpenStreetMap tiles
   - live / last-known locations while Famioo remains active
   - Home, School, Kita, Work, Grandparents and custom Safe Places
   - configurable geofence radius
   - automatic arrival / departure alerts
   - Household / Adults only / Private visibility controls
   - each linked member controls their own location sharing
   - native Android/iOS background/locked-screen location remains a later native enhancement

3. [x] Family Messenger — PWA V1 implemented
   - private household Family Chat
   - one-to-one direct family conversations
   - text messages
   - private photo sharing
   - browser/PWA voice notes
   - unread conversation counters
   - message push/in-app notifications
   - private Messenger media storage
   - later: video messages, reactions, editing/deleting and native call/message enhancements

4. [x] Family Contacts Directory — PWA V1 implemented
   - shared household directory
   - grandparents, relatives and babysitters
   - doctors, pharmacies, School/Kita contacts
   - neighbours, emergency contacts, services and custom contacts
   - phone, second phone, email, address, website and notes
   - one-tap Call / Text / Email / Map / Website actions
   - favourites and emergency-contact flags
   - search and contact-type filters
   - household-member contact cards remain synced automatically from Famioo profiles
   - manual directory contacts remain separate from login/member records

5. [x] Shared Memo / Someday — PWA V1 implemented
   - shared household ideas and notes
   - Places to Visit, Things to Do, Wishes, Notes, Ideas and Someday categories
   - pinned memos
   - optional links
   - search and category filtering
   - archive and restore
   - author / last-updated information
   - later: direct conversion into Calendar events, Tasks or Projects

6. [x] Child Rewards Economy — PWA V1 implemented
   - points from Projects & Chores count automatically
   - parent-defined point values for child-assigned Tasks
   - child balance cards
   - parent-managed reward catalogue
   - reward redemption with balance validation
   - earn/spend history
   - parent bonus/correction adjustments
   - reopening a rewarded task automatically removes its task award
   - later: streaks and achievements

7. [x] Travel & Trips — PWA V1 implemented
   - family trip cards with destination and date range
   - itinerary for transport, accommodation, activities and notes
   - booking references, times, locations and trip notes
   - trip documents and tickets linked from Famioo Files
   - packing / preparation checklist
   - optional automatic Calendar event creation and updates
   - mobile-responsive trip planner

8. [x] Vehicles — PWA V1 implemented
   - family vehicle profiles with make/model/plate/VIN/odometer
   - insurance, TÜV/inspection, service and maintenance records
   - due-date reminders with optional Calendar sync
   - tyre sets with season, size, tread depth and storage location
   - vehicle costs automatically mirrored into Household Costs
   - registration, insurance, inspection, service and invoice documents linked from Famioo Files
   - responsive desktop/mobile vehicle dashboard

9. [x] Pets — PWA V1 implemented
   - pet profiles with species, breed, sex, birth date, chip number, weight and notes
   - vet appointments, vaccinations, medication and health records
   - optional Calendar reminders for due health items
   - pet health costs mirrored into Household Costs
   - recurring care routines with one-tap completion and automatic next due date
   - pet insurance policies
   - vaccination, insurance, vet, prescription and registration documents linked from Famioo Files
   - responsive desktop/mobile pet dashboard

10. [x] Family Inbox / Scan — PWA V1 implemented
    - camera capture or image upload for letters, flyers, invitations and school notices
    - original scan retained securely in Famioo Files
    - AI extraction of title, summary, sender, event date, deadline and location
    - suggested Calendar, Task, File and School & Kita actions
    - one-click Apply / Dismiss review flow
    - optional child selection for School & Kita suggestions
    - AI Assistant allowance/accounting reused for extraction
    - responsive desktop/mobile inbox

11. [x] Emergency Information — PWA V1 implemented
    - per-family-member emergency profile
    - priority guardian/emergency contacts reused from Family Contacts
    - primary doctor linkage reused from Family Contacts
    - insurance provider, phone, member number and policy number
    - allergies, current medication, medical notes and safety notes
    - authenticated Quick Guardian View with large one-tap call actions
    - responsive desktop/mobile emergency dashboard

12. [x] Comments & Photos on Calendar Events — PWA V1 implemented
    - comments/discussion embedded directly in existing Calendar events
    - household-member attribution and timestamped conversation
    - photo uploads with in-event preview grid
    - file attachments with open/download access through private Famioo Files
    - optional attachment captions
    - comment and attachment removal controls
    - works with synced read-only external events while leaving source event data untouched
    - responsive desktop/mobile event context panel

13. [x] Family Photo Albums / Memories — PWA V1 implemented
    - shared albums for birthdays, trips, holidays, school, family and other memories
    - optional memory date and direct Calendar event linkage
    - upload new photos through private Famioo Files storage
    - add existing photos from Famioo Files without duplicating storage
    - import photos already attached to the linked Calendar event
    - new album photos also attach back to the linked Calendar event
    - automatic first-photo cover and album archive/restore
    - responsive desktop/mobile album gallery

14. [x] Family Check-In — PWA V1 implemented
    - one-tap I'm home, I'm safe, Pick me up and Running late updates
    - optional note and ETA for delays
    - optional one-time device location attached only when explicitly selected
    - optional Calendar event context from nearby occurrences
    - shared household feed with profile attribution and auto-refresh
    - map link for location-bearing check-ins
    - owner/admin or sender removal controls
    - responsive desktop/mobile check-in composer and feed

15. [x] Pickup Authorization — PWA V1 implemented
    - one-time authorization for a selected child/profile-only family member
    - approved pickup person reused from Family Contacts
    - pickup date with optional valid-from / valid-until window
    - adult guardian / owner / admin authorization controls
    - guardian confirmation after pickup
    - cancellation flow
    - expired-state handling for unconfirmed past authorizations
    - one-tap phone access to the approved pickup person
    - responsive desktop/mobile authorization dashboard

16. [ ] QR / Ticket Wallet — redesign from scratch — NEXT
    - current temporary scope remains Scan QR → open website
    - future Wallet flow will be newly defined before implementation

17. [x] TV Remote / Home Remote — PWA V1 implemented
    - room and TV / streaming / audio device setup
    - secure HTTPS bridge/webhook command relay
    - power, navigation, volume, mute, home and playback controls
    - owner/admin device configuration and per-profile control permissions
    - command audit log
    - direct local-network discovery/control reserved for later native Android/iOS wrappers

18. [x] Alexa / Voice Integration — Famioo-side V1 implemented
    - owner/admin enable/disable and per-action voice permissions
    - Calendar household-event queries
    - add Shopping items
    - create Tasks
    - read due-task reminders
    - rotatable hashed integration token and action log
    - built-in voice command simulator
    - Amazon Alexa Skill publication/account-linking remains an external Amazon-side deployment step

## Existing modules with planned upgrades

These already exist and are not counted as new modules above:

- Calendar — comments/photos, stronger external-calendar integration
- Tasks — Child Rewards integration
- Shopping — barcode scanning and deeper receipt comparison
- Household Costs — richer reporting and intelligence
- School & Kita — photo/OCR to suggested events
- Meals & Recipes — meal-plan templates, meal queue and stronger Shopping integration
- Files/Documents — document understanding and deeper privacy/encryption
- AI Assistant — deeper cross-module actions
- Projects & Chores
- Home Care
- Life Admin
- Checklists
- Prevention
- Notifications
- Household members / permissions

## Rule

When a planned module is implemented, mark it complete here and move the next unfinished item to **NEXT**. This file is the canonical source for “what comes next?”.

Every newly implemented module must also receive its own icon on the Famioo mobile loading screen in the same implementation cycle. Family Safety and Family Location are included from this point onward.

When native Android/iOS packaging begins, Family Safety is not considered release-complete until the mandatory implementation and real-device test gates in `docs/NATIVE_RELEASE_SAFETY_PLAN.md` pass on Android, iOS and cross-platform combinations.
