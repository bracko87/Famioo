import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckSquare, ClipboardList, House, ShoppingBag, Sparkles } from 'lucide-react'
import type { Session, User } from '@supabase/supabase-js'
import { Navigate, Route, Routes } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { loadHouseholds, loadModules, loadProfiles } from './lib/data'
import type { FamilyProfile, Household, ModuleAccess } from './lib/types'
import { HouseholdContext } from './context/HouseholdContext'
import { AppShell } from './components/AppShell'
import { AuthPage } from './pages/AuthPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { HomePage } from './pages/HomePage'
import { CalendarPage } from './pages/CalendarPage'
import { TasksPage } from './pages/TasksPage'
import { TaskArchivePage } from './pages/TaskArchivePage'
import { ChecklistsPage } from './pages/ChecklistsPage'
import { ChecklistArchivePage } from './pages/ChecklistArchivePage'
import { ShoppingPage } from './pages/ShoppingPage'
import { CostsPage } from './pages/CostsPage'
import { SchoolPage } from './pages/SchoolPage'
import { HomeCarePage } from './pages/HomeCarePage'
import { LifeAdminPage } from './pages/LifeAdminPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProjectsArchivePage } from './pages/ProjectsArchivePage'
import { SettingsPage } from './pages/SettingsPage'
import { ModulePlaceholderPage } from './pages/ModulePlaceholderPage'

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="desktop-loading-mark">
        <div className="loading-mark" />
        <strong>Opening Famioo…</strong>
      </div>

      <div className="mobile-launch-screen" aria-label="Opening Famioo">
        <span className="launch-orbit launch-orbit-1"><CalendarDays size={19} /></span>
        <span className="launch-orbit launch-orbit-2"><ClipboardList size={18} /></span>
        <span className="launch-orbit launch-orbit-3"><ShoppingBag size={18} /></span>
        <span className="launch-orbit launch-orbit-4"><House size={19} /></span>
        <span className="launch-orbit launch-orbit-5"><CheckSquare size={17} /></span>
        <span className="launch-orbit launch-orbit-6"><Sparkles size={18} /></span>

        <img className="launch-app-icon" src="/famioo-app-icon.svg" alt="" />
        <strong>Famioo</strong>
        <span>Family life, organized.</span>
        <i className="launch-loader" />
      </div>
    </main>
  )
}

function AuthenticatedApp({ user }: { user: User }) {
  const [households, setHouseholds] = useState<Household[]>([])
  const [householdId, setHouseholdId] = useState('')
  const [profiles, setProfiles] = useState<FamilyProfile[]>([])
  const [modules, setModules] = useState<ModuleAccess[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadContext = useCallback(async (preferredHouseholdId?: string) => {
    setLoading(true)
    setError('')

    try {
      const nextHouseholds = await loadHouseholds(user)
      setHouseholds(nextHouseholds)

      if (!nextHouseholds.length) {
        setHouseholdId('')
        setProfiles([])
        setModules([])
        return
      }

      const saved = localStorage.getItem('famioo-household-id')
      const chosen = nextHouseholds.find((item) => item.id === preferredHouseholdId)
        ?? nextHouseholds.find((item) => item.id === saved)
        ?? nextHouseholds[0]

      setHouseholdId(chosen.id)
      localStorage.setItem('famioo-household-id', chosen.id)

      const [nextProfiles, nextModules] = await Promise.all([
        loadProfiles(chosen.id),
        loadModules(chosen.id),
      ])

      setProfiles(nextProfiles)
      setModules(nextModules)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open Famioo.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void loadContext()
  }, [loadContext])

  async function switchHousehold(nextId: string) {
    await loadContext(nextId)
  }

  if (loading) return <LoadingScreen />

  if (error) {
    return (
      <main className="fatal-state">
        <strong>Famioo could not open.</strong>
        <span>{error}</span>
        <button onClick={() => void loadContext(householdId || undefined)}>Try again</button>
      </main>
    )
  }

  if (!households.length) {
    return <OnboardingPage user={user} onCreated={() => loadContext()} />
  }

  const household = households.find((item) => item.id === householdId) ?? households[0]

  return (
    <HouseholdContext.Provider
      value={{
        user,
        households,
        household,
        profiles,
        modules,
        switchHousehold,
        refresh: () => loadContext(household.id),
      }}
    >
      <Routes>
        <Route path="/app" element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tasks/archive" element={<TaskArchivePage />} />
          <Route path="checklists" element={<ChecklistsPage />} />
          <Route path="checklists/archive" element={<ChecklistArchivePage />} />
          <Route path="settings" element={<SettingsPage />} />

          <Route path="shopping" element={<ShoppingPage />} />
          <Route path="costs" element={<CostsPage />} />
          <Route path="school" element={<SchoolPage />} />
          <Route path="home-care" element={<HomeCarePage />} />
          <Route path="life-admin" element={<LifeAdminPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/archive" element={<ProjectsArchivePage />} />
          <Route path="meals" element={<ModulePlaceholderPage />} />
          <Route path="files" element={<ModulePlaceholderPage />} />
          <Route path="assistant" element={<ModulePlaceholderPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </HouseholdContext.Provider>
  )
}

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [introReady, setIntroReady] = useState(false)

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 900px)').matches
    if (!mobile) {
      setIntroReady(true)
      return
    }

    const timer = window.setTimeout(() => setIntroReady(true), 1800)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setReady(true)
    })

    return () => data.subscription.unsubscribe()
  }, [])

  const user = useMemo(() => session?.user ?? null, [session])

  if (!ready || !introReady) return <LoadingScreen />

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<AuthPage />} />
      </Routes>
    )
  }

  return <AuthenticatedApp user={user} />
}
