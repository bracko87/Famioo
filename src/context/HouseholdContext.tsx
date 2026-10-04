import { createContext, useContext } from 'react'
import type { User } from '@supabase/supabase-js'
import type { FamilyProfile, Household, ModuleAccess } from '../lib/types'

export type HouseholdContextValue = {
  user: User
  households: Household[]
  household: Household
  profiles: FamilyProfile[]
  modules: ModuleAccess[]
  switchHousehold: (householdId: string) => Promise<void>
  refresh: () => Promise<void>
}

export const HouseholdContext = createContext<HouseholdContextValue | null>(null)

export function useHousehold() {
  const value = useContext(HouseholdContext)
  if (!value) throw new Error('HouseholdContext is unavailable')
  return value
}
