import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { FREE_MODULE_CODES } from './accountPlan'
import type {
  FamilyProfile,
  Household,
  HouseholdRole,
  ModuleAccess,
  ModuleCode,
  ModulePermission,
} from './types'

export async function loadHouseholds(user: User): Promise<Household[]> {
  const memberships = await supabase
    .from('household_members')
    .select('household_id,role')
    .eq('user_id', user.id)
    .eq('status', 'active')

  if (memberships.error) throw memberships.error
  if (!memberships.data?.length) return []

  const ids = memberships.data.map((row) => row.household_id)
  const households = await supabase
    .from('households')
    .select('id,name,timezone,default_language,week_starts_on,date_format,time_format')
    .in('id', ids)
    .is('archived_at', null)

  if (households.error) throw households.error

  const planResult = await supabase
    .from('household_plan_overrides')
    .select('household_id,plan')
    .in('household_id', ids)
  if (planResult.error) throw planResult.error
  const freeHouseholdIds = new Set((planResult.data ?? [])
    .filter(row => row.plan === 'free')
    .map(row => row.household_id))

  const roleById = new Map(memberships.data.map((row) => [row.household_id, row.role]))

  return (households.data ?? [])
    .map((row) => ({
      ...row,
      role: roleById.get(row.id) as HouseholdRole,
      plan: freeHouseholdIds.has(row.id) ? 'free' as const : 'standard' as const,
    }))
    .sort((a, b) => a.name.localeCompare(b.name)) as Household[]
}

export async function loadProfiles(householdId: string): Promise<FamilyProfile[]> {
  const result = await supabase
    .from('family_profiles')
    .select('id,household_id,linked_user_id,display_name,profile_type,color_key,avatar_emoji,avatar_path,birth_date')
    .eq('household_id', householdId)
    .eq('active', true)
    .order('display_name')

  if (result.error) throw result.error
  return (result.data ?? []) as FamilyProfile[]
}

export async function loadModules(householdId: string, householdPlan: Household['plan']): Promise<ModuleAccess[]> {
  const { data: authData } = await supabase.auth.getUser()
  const userId = authData.user?.id

  const [modulesResult, entitlementResult, permissionResult, membershipResult] = await Promise.all([
    supabase
      .from('modules')
      .select('code,name,description,icon_key,is_core,sort_order')
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('household_modules')
      .select('module_code,enabled,valid_until')
      .eq('household_id', householdId),
    supabase
      .from('module_role_permissions')
      .select('module_code,role,access_level')
      .eq('household_id', householdId),
    userId
      ? supabase
          .from('household_members')
          .select('role')
          .eq('household_id', householdId)
          .eq('user_id', userId)
          .eq('status', 'active')
          .single()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (modulesResult.error) throw modulesResult.error
  if (entitlementResult.error) throw entitlementResult.error
  if (permissionResult.error) throw permissionResult.error
  if (membershipResult.error) throw membershipResult.error

  // Household-only test grants are distinct from the standard Free catalogue
  // and from paid household_modules/billing rows. Missing table means the
  // backend migration has not shipped yet: fail closed, without breaking login.
  const trialUnlocks = new Set<ModuleCode>()
  if (householdPlan === 'free') {
    const testResult = await supabase
      .from('household_test_module_unlocks')
      .select('module_code')
      .eq('household_id', householdId)

    if (testResult.error) {
      if (testResult.error.code !== '42P01' && testResult.error.code !== 'PGRST205') {
        throw testResult.error
      }
    } else {
      for (const grant of testResult.data ?? []) {
        if (grant.module_code === 'shopping') trialUnlocks.add('shopping')
      }
    }
  }

  const currentRole = (membershipResult.data?.role ?? 'user') as HouseholdRole

  const entitlement = new Map(
    (entitlementResult.data ?? []).map((row) => [
      row.module_code,
      row.enabled && (!row.valid_until || new Date(row.valid_until).getTime() > Date.now()),
    ]),
  )

  const permission = new Map(
    (permissionResult.data ?? [])
      .filter((row) => row.role === currentRole)
      .map((row) => [row.module_code, row.access_level as ModulePermission]),
  )

  const mapped: ModuleAccess[] = (modulesResult.data ?? []).map((row) => {
    // The entire household shares the same Free/Premium tier, regardless
    // of account email or inherited legacy is_core metadata.
    const isFreeModule = FREE_MODULE_CODES.has(row.code as ModuleCode)
    const trialEnabled = trialUnlocks.has(row.code as ModuleCode)
    const entitled = householdPlan === 'free'
      ? isFreeModule || trialEnabled
      : row.is_core || Boolean(entitlement.get(row.code))
    const accessLevel: ModulePermission = currentRole === 'owner'
      ? 'full'
      : permission.get(row.code) ??
        (currentRole === 'admin' || (householdPlan === 'free' && trialEnabled) ? 'full' : 'read')

    return {
      code: row.code as ModuleCode,
      name: row.name,
      description: row.description,
      icon_key: row.icon_key,
      is_core: householdPlan === 'free' ? isFreeModule : row.is_core,
      entitled,
      enabled: entitled && accessLevel !== 'restricted',
      access_level: accessLevel,
      can_write: entitled && accessLevel === 'full',
    }
  })
  return mapped
}
