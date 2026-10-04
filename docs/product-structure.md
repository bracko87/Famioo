# Famioo product structure

This document defines the terms used by the Famioo frontend and database.

## Application shell

The application shell is always available and is not a purchasable module.

Current shell areas:

- Home
- Settings
- authentication and onboarding
- household selector
- notifications
- current profile
- footer/weather
- navigation

Home is a dashboard page, not a module.

## Modules

Modules are functional Famioo features. A household can have core modules and optional unlocked modules.

Core modules:

- Calendar
- Tasks
- Checklists

Optional modules currently reserved in the system:

- Shopping
- Household Costs
- School & Kita
- Home Care
- Life Admin
- Projects & Chores
- Meals & Recipes
- Files
- Assistant

Every enabled module is represented consistently in household navigation and on the Home dashboard. The Home dashboard keeps module banners in the left column and reserves the right column for future dashboard content.

The Home promotion carousel can advertise both implemented and future modules. Promotions rotate automatically every seven seconds.

## Roles

Famioo has exactly three household roles:

### Owner

- The user who creates the household starts as Owner.
- Owner can invite users by email.
- Owner can create users directly.
- Owner can assign Admin or User roles.
- Owner can edit the module permission matrix.
- Owner always has Full access to every available module.

### Admin

- Admin is assigned by the Owner.
- Admin cannot assign roles.
- Admin cannot edit the permission matrix.
- Admin access to each module is controlled by the permission matrix.

### User

- User is the standard household role.
- User access to each module is controlled by the permission matrix.
- A User can have Full, Read only, or Restricted access depending on the module.

## Module permissions

Each module has an access level for Admin and User roles:

- Full — view and update
- Read only — view without changes
- Restricted — no module access

Owner is always Full.

Permissions are stored per household and per module. Core module database policies enforce the matrix.

## Settings sections

Settings sections organize configuration. They are not modules.

Current Settings tabs:

- General
- Modules
- Categories
- Templates
- Users
- Permissions
- Layers
- Weather

The Modules tab owns module availability and entitlement information. Module controls are not mixed into General.

General settings include household name, timezone, language, week start, date format and time format.

Users contains household members and role management.

Permissions contains the module-by-role access matrix.

Categories, Templates and Layers remain independent configuration areas so future features can connect to them without redesigning Settings.

## Page heading rule

The household name belongs in the application header and in fields where the household itself is being configured.

Module pages use only one small uppercase page label at the top. Large repeated page titles and descriptions are not used before the main module content.
