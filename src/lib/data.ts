import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
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

  const roleById = new Map(memberships.data.map((row) => [row.household_id, row.role]))

  return (households.data ?? [])
    .map((row) => ({
      ...row,
      role: roleById.get(row.id) as HouseholdRole,
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

export async function loadModules(householdId: string): Promise<ModuleAccess[]> {
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

  return (modulesResult.data ?? []).map((row) => {
    const entitled = row.is_core || Boolean(entitlement.get(row.code))
    const accessLevel: ModulePermission = currentRole === 'owner'
      ? 'full'
      : permission.get(row.code) ?? (currentRole === 'admin' ? 'full' : 'read')

    return {
      code: row.code as ModuleCode,
      name: row.name,
      description: row.description,
      icon_key: row.icon_key,
      is_core: row.is_core,
      entitled,
      enabled: entitled && accessLevel !== 'restricted',
      access_level: accessLevel,
      can_write: entitled && accessLevel === 'full',
    }
  })
}
