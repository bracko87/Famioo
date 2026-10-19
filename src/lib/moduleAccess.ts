import { FREE_MODULE_CODES } from './accountPlan'
import type { ModuleAccess, ModuleCode } from './types'

/** Routes for which the current user must actually have module access.
 * Home, Settings and Premium catalogue remain available to everyone. */
const MODULE_ROUTES: ReadonlyArray<readonly [string, ModuleCode]> = [
  ['/app/calendar/connections', 'calendar_connections'],
  ['/app/calendar', 'calendar'],
  ['/app/tasks', 'tasks'],
  ['/app/checklists', 'checklists'],
  ['/app/safety', 'safety'],
  ['/app/location', 'location'],
  ['/app/messenger', 'messenger'],
  ['/app/contacts', 'contacts'],
  ['/app/memo', 'memo'],
  ['/app/rewards', 'projects'],
  ['/app/travel', 'travel'],
  ['/app/vehicles', 'vehicles'],
  ['/app/pets', 'pets'],
  ['/app/inbox', 'inbox_scan'],
  ['/app/emergency', 'contacts'],
  ['/app/memories', 'memories'],
  ['/app/check-in', 'location'],
  ['/app/pickup-authorization', 'contacts'],
  ['/app/home-remote', 'home_remote'],
  ['/app/voice', 'voice_integration'],
  ['/app/shopping', 'shopping'],
  ['/app/costs', 'costs'],
  ['/app/school', 'school'],
  ['/app/home-care', 'home_care'],
  ['/app/life-admin', 'life_admin'],
  ['/app/projects', 'projects'],
  ['/app/meals', 'meals'],
  ['/app/files', 'files'],
  ['/app/vaccinations', 'vaccinations'],
  ['/app/tickets', 'tickets'],
  ['/app/assistant', 'assistant'],
]

export function requiredModuleForPath(pathname: string): ModuleCode | null {
  const path = pathname.toLowerCase().replace(/\/+$/, '')
  return MODULE_ROUTES.find(([prefix]) => path === prefix || path.startsWith(prefix + '/'))?.[1] ?? null
}

/** Connections from free modules to locked premium targets are hidden.
 * From an unlocked paid module to a locked paid target they may be greyed out.
 */
export function moduleConnectionState(
  modules: readonly ModuleAccess[],
  source: ModuleCode,
  target: ModuleCode,
): 'active' | 'locked' | 'hidden' {
  const sourceAccess = modules.find((module) => module.code === source)
  const targetAccess = modules.find((module) => module.code === target)
  if (!sourceAccess?.enabled || !targetAccess) return 'hidden'
  if (targetAccess.enabled) return 'active'
  return !FREE_MODULE_CODES.has(source) && !FREE_MODULE_CODES.has(target) ? 'locked' : 'hidden'
}
