# Famioo Native Release Plan — Android & iOS

This document is a permanent release requirement for the future native Famioo mobile applications.

The current Famioo PWA remains the product foundation. When Famioo is packaged/published as Android and iOS apps, the native applications must add the device-level capabilities that a browser/PWA cannot reliably provide.

Last updated: 2026-10-09

## Mandatory release rule

Before publishing the native Android app or native iOS app:

1. Implement the native Family Safety extensions for that platform.
2. Test the complete SOS flow end-to-end on real physical devices.
3. Test both sender and recipient behavior.
4. Test foreground, background and locked-screen behavior.
5. Test location, notifications and internet calling separately.
6. Record any platform limitation that cannot be solved.
7. Do not mark the native app release-ready until the platform-specific Safety checklist below has passed.

Android and iOS must both be implemented and tested. Passing on one platform does not count as completion for the other.

---

# Family Safety — existing PWA foundation

The following functionality is already part of the shared Famioo application/backend and should be reused by the native apps:

- Family Safety / SOS module
- mobile-only hold-to-SOS trigger
- household safety alerts
- optional current-location capture
- active-alert map
- responder status / "I'm responding"
- resolve / "I'm safe"
- household safety-contact phone numbers
- one-tap cellular call shortcut when a phone number exists
- one-tap SMS shortcut when a phone number exists
- Famioo internet-call foundation
- urgent Safety notifications
- recent resolved-alert history
- persistent Family Safety data in Supabase

The native apps should enhance this system, not replace it.

---

# Required native upgrades

## 1. Live SOS location

PWA today:
- captures a location snapshot after an SOS
- displays that location on the Safety map

Native requirement:
- while an SOS remains active, update the sender's location periodically in the background, subject to platform permission
- show last update time and location accuracy
- stop background tracking immediately when SOS is resolved/cancelled
- provide a visible privacy explanation before enabling background location
- handle revoked permission cleanly
- never delay sending the SOS while waiting for GPS

Acceptance test:
- trigger SOS
- lock the sender phone
- physically move the sender device
- recipient map must update within the designed interval
- resolve SOS
- background updates must stop

## 2. Native emergency notifications

PWA today:
- uses Web Push where available
- requests urgent/high-priority behavior
- sound/vibration behavior ultimately depends on browser/OS rules

Native requirement:
- dedicated Family Safety notification category/channel
- highest appropriate notification priority permitted by the platform
- lock-screen presentation where permitted
- clear action to open the active SOS
- notification must identify the household member who triggered the alert
- repeated/updated alert behavior must avoid notification spam

Android:
- configure native notification channel specifically for SOS
- investigate full-screen/heads-up behavior subject to current Android/Google Play rules

iOS:
- use native APNs notification handling
- investigate Critical Alerts only if Famioo qualifies and obtains the required Apple entitlement
- otherwise use the highest permitted normal notification behavior

Acceptance test:
- app foreground
- app background
- app terminated
- screen locked
- Do Not Disturb / silent-mode behavior documented
- tapping notification must open the correct active Safety alert

## 3. Native internet calling

PWA today:
- browser-to-browser WebRTC audio foundation
- STUN-based connectivity
- not guaranteed on every restrictive network

Native requirement:
- keep Famioo-to-Famioo internet calling
- add production TURN infrastructure before relying on it as a Safety fallback
- incoming call must work when the app is not visible, within platform rules
- native call UI where supported
- call connected to the relevant active SOS alert

Android:
- integrate native incoming-call notification/call UX
- test locked screen and background reception

iOS:
- use PushKit for genuine incoming VoIP call signaling where appropriate
- use CallKit for system incoming-call UI
- comply with Apple's requirement that VoIP pushes represent real calls

Acceptance test:
- Wi-Fi ↔ Wi-Fi
- mobile data ↔ mobile data
- Wi-Fi ↔ mobile data
- restrictive NAT test through TURN
- foreground/background/locked screen
- answer/decline/end call
- microphone permission denied/revoked

## 4. Hardware / lock-screen SOS triggers

PWA today:
- cannot monitor physical side/volume buttons while locked/backgrounded

Android native:
- investigate a compliant hardware-button SOS shortcut
- possible approaches must be checked against current Android APIs and Google Play policy
- AccessibilityService must not be used casually; if considered, explicit disclosure/consent and Play policy compliance are mandatory
- hardware trigger must never be the only SOS path

iOS native:
- do not attempt to override Apple's own Emergency SOS side/volume combinations
- investigate supported alternatives:
  - lock-screen widget/action
  - Shortcuts integration
  - Action Button support where Apple APIs permit it
  - Apple Watch companion action

Acceptance test:
- screen locked
- app backgrounded
- accidental-trigger protection
- user can cancel accidental activation before alert is sent where appropriate

## 5. Smartwatch support

Planned later native extension:
- Apple Watch
- Wear OS

Desired functions:
- discreet SOS trigger
- "I'm safe"
- active-alert acknowledgement
- optional haptic confirmation

This is not required for the first native release unless explicitly moved into release scope.

## 6. Discreet SOS mode

Planned native extension:
- trigger family alert without an obvious alarm on the sender device
- useful when a child does not want to attract attention
- recipient devices should still receive the normal Safety alert

Must be designed carefully so users understand whether the sender device makes sound/vibration.

---

# Platform limitations that remain even after native wrapping

Native apps improve the Safety system substantially, but some limits remain:

- If the phone is completely powered off, Famioo cannot run or send an SOS.
- Poor/no network connectivity can delay delivery.
- GPS can be unavailable or inaccurate indoors.
- iOS does not allow Famioo to replace Apple's own Emergency SOS hardware combinations.
- Silent/DND bypass is subject to OS permissions/entitlements.
- Cellular calls and SMS normally require user/system interaction; Famioo should not assume it can silently place a normal carrier call.
- Native capabilities require actual native integrations. Simply placing the current web app inside a generic WebView wrapper is not sufficient.

---

# Android physical-device test matrix

Minimum before Android release:

- [ ] SOS trigger while app open
- [ ] SOS trigger after fresh app start
- [ ] location permission granted
- [ ] location permission denied
- [ ] precise location unavailable
- [ ] live/background SOS tracking while phone locked
- [ ] recipient receives SOS while app open
- [ ] recipient receives SOS while app backgrounded
- [ ] recipient receives SOS while app terminated, where Android allows
- [ ] lock-screen notification behavior
- [ ] notification tap opens correct alert
- [ ] vibration/sound behavior documented
- [ ] Call button with valid phone number
- [ ] SMS button with valid phone number
- [ ] missing phone number → Internet Call available
- [ ] Internet Call on Wi-Fi
- [ ] Internet Call on mobile data
- [ ] Internet Call through TURN/restrictive network
- [ ] incoming call background/locked screen
- [ ] answer/decline/end
- [ ] "I'm responding"
- [ ] multiple responders
- [ ] "I'm safe" / resolve
- [ ] resolved alert stops background location
- [ ] accidental SOS hold behavior
- [ ] offline/no-network behavior
- [ ] hardware/lock-screen SOS trigger if included in release
- [ ] Google Play policy review for every Safety-specific native permission/API

Test at minimum on:
- one current Android version
- one older still-supported Android version
- at least two physical phone models from different manufacturers

---

# iOS physical-device test matrix

Minimum before iOS release:

- [ ] SOS trigger while app open
- [ ] SOS trigger after fresh app start
- [ ] location permission granted
- [ ] location permission denied
- [ ] precise location disabled
- [ ] live/background SOS tracking while iPhone locked
- [ ] recipient receives SOS while app open
- [ ] recipient receives SOS while app backgrounded
- [ ] recipient receives SOS while app terminated, subject to iOS rules
- [ ] lock-screen notification behavior
- [ ] notification tap opens correct alert
- [ ] sound/haptic behavior documented
- [ ] Call button with valid phone number
- [ ] SMS/iMessage handoff with valid phone number
- [ ] missing phone number → Famioo Internet Call available
- [ ] Internet Call on Wi-Fi
- [ ] Internet Call on cellular data
- [ ] Internet Call through TURN/restrictive network
- [ ] PushKit incoming VoIP signaling
- [ ] CallKit incoming-call UI
- [ ] incoming call with phone locked
- [ ] answer/decline/end
- [ ] "I'm responding"
- [ ] multiple responders
- [ ] "I'm safe" / resolve
- [ ] resolved alert stops background location
- [ ] accidental SOS hold behavior
- [ ] offline/no-network behavior
- [ ] lock-screen/widget/Shortcut/Action Button path if included
- [ ] App Store/privacy review for background location, notifications and VoIP

Test at minimum on:
- one current iOS version
- one older still-supported iOS version
- at least two physical iPhone generations

---

# Cross-platform end-to-end tests

These must also pass:

- [ ] Android child → Android adult
- [ ] Android child → iPhone adult
- [ ] iPhone child → Android adult
- [ ] iPhone child → iPhone adult
- [ ] multiple adults receive one SOS
- [ ] one adult marks "I'm responding" and all others see it
- [ ] one adult resolves and all devices update
- [ ] location map displays correctly on both platforms
- [ ] Internet Call Android ↔ iPhone
- [ ] phone-number Call/Text fallbacks available where configured
- [ ] household member without phone number can still receive/use Internet Call

---

# Release decision

Family Safety native work is considered complete only when:

- Android checklist passes
- iOS checklist passes
- cross-platform checklist passes
- any known limitations are documented
- no Safety regression exists in the PWA/shared backend
- real-device testing has been completed, not emulator-only testing

Reference this document whenever Famioo packaging/publishing for Android or iOS begins.
