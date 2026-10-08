import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckSquare, ClipboardList, FileText, Folder, FolderKanban, GraduationCap, Receipt, ShoppingBag, Sparkles, Syringe, Ticket, Utensils, Wrench } from 'lucide-react'
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
import { CalendarConnectionsPage } from './pages/CalendarConnectionsPage'
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
import { MealsPage } from './pages/MealsPage'
import { RecipeDetailPage } from './pages/RecipeDetailPage'
import { FilesPage } from './pages/FilesPage'
import { VaccinationPage } from './pages/VaccinationPage'
import { TicketWalletPage } from './pages/TicketWalletPage'
import { AssistantPage } from './pages/AssistantPage'

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="desktop-loading-mark">
        <div className="loading-mark" />
        <strong>Opening Famioo…</strong>
      </div>

      <div className="mobile-launch-screen" aria-label="Opening Famioo">
        <svg className="launch-network" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <g className="launch-network-spokes">
            <line x1="50" y1="50" x2="18" y2="12" />
            <line x1="50" y1="50" x2="77" y2="18" />
            <line x1="50" y1="50" x2="9" y2="27" />
            <line x1="50" y1="50" x2="91" y2="30" />
            <line x1="50" y1="50" x2="28" y2="38" />
            <line x1="50" y1="50" x2="70" y2="40" />
            <line x1="50" y1="50" x2="7" y2="51" />
            <line x1="50" y1="50" x2="94" y2="55" />
            <line x1="50" y1="50" x2="23" y2="64" />
            <line x1="50" y1="50" x2="78" y2="68" />
            <line x1="50" y1="50" x2="10" y2="76" />
            <line x1="50" y1="50" x2="90" y2="80" />
            <line x1="50" y1="50" x2="34" y2="88" />
            <line x1="50" y1="50" x2="68" y2="90" />
          </g>
          <g className="launch-network-links">
            <line x1="18" y1="12" x2="77" y2="18" />
            <line x1="18" y1="12" x2="28" y2="38" />
            <line x1="77" y1="18" x2="70" y2="40" />
            <line x1="9" y1="27" x2="28" y2="38" />
            <line x1="91" y1="30" x2="70" y2="40" />
            <line x1="9" y1="27" x2="7" y2="51" />
            <line x1="91" y1="30" x2="94" y2="55" />
            <line x1="28" y1="38" x2="23" y2="64" />
            <line x1="70" y1="40" x2="78" y2="68" />
            <line x1="7" y1="51" x2="23" y2="64" />
            <line x1="94" y1="55" x2="78" y2="68" />
            <line x1="23" y1="64" x2="10" y2="76" />
            <line x1="78" y1="68" x2="90" y2="80" />
            <line x1="10" y1="76" x2="34" y2="88" />
            <line x1="90" y1="80" x2="68" y2="90" />
            <line x1="34" y1="88" x2="68" y2="90" />
            <line x1="28" y1="38" x2="70" y2="40" />
            <line x1="23" y1="64" x2="78" y2="68" />
          </g>
        </svg>

        <span className="launch-orbit launch-orbit-1" title="Calendar"><CalendarDays size={18} /></span>
        <span className="launch-orbit launch-orbit-2" title="Tasks"><ClipboardList size={18} /></span>
        <span className="launch-orbit launch-orbit-3" title="Checklists"><CheckSquare size={17} /></span>
        <span className="launch-orbit launch-orbit-4" title="Shopping"><ShoppingBag size={18} /></span>
        <span className="launch-orbit launch-orbit-5" title="Household Costs"><Receipt size={18} /></span>
        <span className="launch-orbit launch-orbit-6" title="School & Kita"><GraduationCap size={18} /></span>
        <span className="launch-orbit launch-orbit-7" title="Home Care"><Wrench size={18} /></span>
        <span className="launch-orbit launch-orbit-8" title="Life Admin"><FileText size={18} /></span>
        <span className="launch-orbit launch-orbit-9" title="Projects"><FolderKanban size={18} /></span>
        <span className="launch-orbit launch-orbit-10" title="Meals & Recipes"><Utensils size={18} /></span>
        <span className="launch-orbit launch-orbit-11" title="Files"><Folder size={18} /></span>
        <span className="launch-orbit launch-orbit-12" title="Vaccinations"><Syringe size={18} /></span>
        <span className="launch-orbit launch-orbit-13" title="Tickets"><Ticket size={18} /></span>
        <span className="launch-orbit launch-orbit-14" title="AI Assistant"><Sparkles size={18} /></span>

        <strong className="launch-wordmark">Famioo</strong>
        <span className="launch-tagline">Family life, organized.</span>
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

  const loadContext = useCallback(async (preferredHouseholdId?: string, foreground = true) => {
    if (foreground) setLoading(true)
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
      if (foreground) setLoading(false)
    }
  }, [user.id])

  useEffect(() => {
    void loadContext()
  }, [loadContext])

  async function switchHousehold(nextId: string) {
    await loadContext(nextId, true)
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
        refresh: () => loadContext(household.id, false),
      }}
    >
      <Routes>
        <Route path="/app" element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="calendar/connections" element={<CalendarConnectionsPage />} />
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
          <Route path="meals" element={<MealsPage />} />
          <Route path="meals/recipes/:recipeId" element={<RecipeDetailPage />} />
          <Route path="files" element={<FilesPage />} />
          <Route path="vaccinations" element={<VaccinationPage />} />
          <Route path="tickets" element={<TicketWalletPage />} />
          <Route path="assistant" element={<AssistantPage />} />
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

    const timer = window.setTimeout(() => setIntroReady(true), 3500)
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
