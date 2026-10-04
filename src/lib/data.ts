import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { FamilyProfile, Household, ModuleAccess, ModuleCode } from './types'

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
    .select('id,name,timezone')
    .in('id', ids)
    .is('archived_at', null)

  if (households.error) throw households.error

  const roleById = new Map(memberships.data.map((row) => [row.household_id, row.role]))
  return (households.data ?? [])
    .map((row) => ({ ...row, role: roleById.get(row.id) as Household['role'] }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function loadProfiles(householdId: string): Promise<FamilyProfile[]> {
  const result = await supabase
    .from('family_profiles')
    .select('id,household_id,linked_user_id,display_name,profile_type,color_key,avatar_emoji,avatar_path')
    .eq('household_id', householdId)
    .eq('active', true)
    .order('display_name')

  if (result.error) throw result.error
  return (result.data ?? []) as FamilyProfile[]
}

export async function loadModules(householdId: string): Promise<ModuleAccess[]> {
  const [modulesResult, entitlementResult] = await Promise.all([
    supabase
      .from('modules')
      .select('code,name,description,icon_key,is_core,sort_order')
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('household_modules')
      .select('module_code,enabled,valid_until')
      .eq('household_id', householdId),
  ])

  if (modulesResult.error) throw modulesResult.error
  if (entitlementResult.error) throw entitlementResult.error

  const access = new Map(
    (entitlementResult.data ?? []).map((row) => [
      row.module_code,
      row.enabled && (!row.valid_until || new Date(row.valid_until).getTime() > Date.now()),
    ]),
  )

  return (modulesResult.data ?? []).map((row) => ({
    code: row.code as ModuleCode,
    name: row.name,
    description: row.description,
    icon_key: row.icon_key,
    is_core: row.is_core,
    enabled: row.is_core || Boolean(access.get(row.code)),
  }))
}
