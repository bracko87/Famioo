export type HouseholdRole = 'owner' | 'admin' | 'user'
export type ModulePermission = 'full' | 'read' | 'restricted'

export type Household = {
  id: string
  name: string
  timezone: string
  default_language: 'en' | 'de' | 'sr'
  week_starts_on: 0 | 1
  date_format: 'DD.MM.YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'
  time_format: '24h' | '12h'
  role: HouseholdRole
}

export type FamilyProfile = {
  id: string
  household_id: string
  linked_user_id: string | null
  display_name: string
  profile_type: 'adult' | 'child' | 'profile_only'
  color_key: string
  avatar_emoji: string | null
  avatar_path: string | null
  birth_date: string | null
}

export type ModuleCode =
  | 'calendar'
  | 'calendar_connections'
  | 'tasks'
  | 'checklists'
  | 'safety'
  | 'location'
  | 'messenger'
  | 'contacts'
  | 'memo'
  | 'rewards'
  | 'travel'
  | 'vehicles'
  | 'pets'
  | 'inbox_scan'
  | 'emergency_info'
  | 'calendar_context'
  | 'memories'
  | 'shopping'
  | 'costs'
  | 'school'
  | 'home_care'
  | 'life_admin'
  | 'projects'
  | 'meals'
  | 'files'
  | 'assistant'
  | 'vaccinations'
  | 'tickets'

export type ModuleAccess = {
  code: ModuleCode
  name: string
  description: string
  icon_key: string
  is_core: boolean
  entitled: boolean
  enabled: boolean
  access_level: ModulePermission
  can_write: boolean
}

export type CalendarOccurrence = {
  event_id: string
  occurrence_key: string
  household_id: string
  calendar_id: string
  category_id: string | null
  title: string
  description: string | null
  all_day: boolean
  occurrence_start_at: string | null
  occurrence_end_at: string | null
  occurrence_start_date: string | null
  occurrence_end_date: string | null
  event_timezone: string
  location_text: string | null
}

export type EventCategory = {
  id: string
  name: string
  color_key: string
}

export type CalendarRow = {
  id: string
  name: string
  color_key: string
  is_default: boolean
}
