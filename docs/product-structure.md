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

Every enabled module is represented consistently in household navigation and on the Home dashboard. The Home dashboard reserves its right column for future non-module dashboard content.

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

The Modules tab owns module availability and entitlement information. Module controls should not be mixed into the General tab.

Categories, Templates, Users, Permissions and Layers are reserved as independent configuration areas so future features can connect to them without redesigning the Settings page.

## Naming rule

The household name belongs in the application header and in fields where the household itself is being configured. It should not be repeated as the main title on every page.
