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

9. [ ] Pets — NEXT
   - pet profiles
   - vet appointments, vaccinations and medication
   - insurance, documents and recurring care

10. [ ] Family Inbox / Scan
    - photograph/upload letters, flyers, invitations and school notices
    - extract useful information
    - suggest Calendar / Task / File / School actions

11. [ ] Emergency Information
    - emergency contacts
    - doctors and insurance
    - important family medical/safety notes
    - fast guardian access

12. [ ] Comments & Photos on Calendar Events
    - comments/discussion on events
    - photos and file attachments
    - keep planning context with the event

13. [ ] Family Photo Albums / Memories
    - shared albums
    - connect photos to Calendar events and dates
    - birthdays, trips, holidays and school events

14. [ ] Family Check-In
    - I'm home
    - I'm safe
    - Pick me up
    - Running late
    - optional location and Calendar context

15. [ ] Pickup Authorization
    - approved child pickup person for the day
    - one-time authorization
    - guardian confirmation

16. [ ] Home Presence Board
    - Home / School / Work / Away
    - expected home soon
    - optional Calendar + Location integration

17. [ ] QR / Ticket Wallet — redesign from scratch
    - current temporary scope remains Scan QR → open website
    - future Wallet flow will be newly defined before implementation

18. [ ] TV Remote / Home Remote
    - supported TV/streaming-device controls
    - rooms and permissions
    - later possible smart-home shortcuts

19. [ ] Alexa / Voice Integration
    - calendar queries
    - add shopping items/tasks
    - reminders and selected Famioo voice actions

20. [ ] Multiple Circles / Groups
    - household
    - extended family / grandparents
    - optional friend or other private circles

21. [ ] Crash / Journey Safety
    - journey monitoring
    - missed-arrival alerts
    - later device-assisted crash detection where APIs allow it

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
