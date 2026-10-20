import type { User } from '@supabase/supabase-js'
import type { ModuleAccess, ModuleCode } from './types'

/**
 * Temporary, explicitly requested individual Free account.
 * Keep this separate from household billing and permissions.
 *
 * The matching SQL migration (108) stores the restriction by auth user ID
 * and enforces module access server-side after it is applied.
 */
const FREE_TEST_ACCOUNT_EMAIL = 'aleksandarlevnajic@gmail.com'

/** Canonical free modules, plus their legacy submodule access codes. */
export const FREE_MODULE_CODES: ReadonlySet<ModuleCode> = new Set<ModuleCode>([
  'calendar', 'calendar_connections', 'tasks', 'checklists',
  'safety', 'contacts', 'emergency_info', 'pickup_authorization',
  'messenger', 'memories', 'files',
])

export const MERGED_MODULE_CODES: ReadonlySet<ModuleCode> = new Set<ModuleCode>([
  'emergency_info', 'pickup_authorization', 'checkin',
  'calendar_context', 'rewards',
])

export function isFreePlanAccount(user: Pick<User, 'email'>): boolean {
  return user.email?.trim().toLowerCase() === FREE_TEST_ACCOUNT_EMAIL
}

/**
 * Frontend view of effective permissions for the one Free test account.
 * Does not change the household entitlements and does not replace RLS.
 */
export function limitModulesForFreeAccount(
  modules: ModuleAccess[],
  user: Pick<User, 'email'>,
): ModuleAccess[] {
  if (!isFreePlanAccount(user)) return modules
  return modules.map(module => {
    if (!FREE_MODULE_CODES.has(module.code)) {
      return { ...module, is_core: false, entitled: false, enabled: false, can_write: false }
    }

    // An account's free modules are available even if its household hasn't
    // bought those modules. Preserve role-based read/restricted permissions.
    const allowedByRole = module.access_level !== 'restricted'
    return {
      ...module,
      is_core: true,
      entitled: true,
      enabled: allowedByRole,
      can_write: allowedByRole && module.access_level === 'full',
    }
  })
}

/** Block paid pages even when an old bookmark or direct URL is used. */
const PAID_PAGE_PATHS = [
  '/app/location', '/app/check-in', '/app/memo', '/app/rewards',
  '/app/travel', '/app/vehicles', '/app/pets', '/app/inbox',
  '/app/home-remote', '/app/shopping', '/app/costs',
  '/app/school', '/app/home-care', '/app/life-admin',
  '/app/projects', '/app/meals', '/app/vaccinations',
  '/app/tickets', '/app/assistant', '/app/voice',
] as const

export function isPaidPage(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '').toLowerCase()
  return PAID_PAGE_PATHS.some(root => path === root || path.startsWith(root + '/'))
}
