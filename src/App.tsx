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
            <line x1="50" y1="48" x2="50" y2="8" />
            <line x1="50" y1="48" x2="75" y2="14" />
            <line x1="50" y1="48" x2="88" y2="27" />
            <line x1="50" y1="48" x2="92" y2="42" />
            <line x1="50" y1="48" x2="90" y2="59" />
            <line x1="50" y1="48" x2="83" y2="73" />
            <line x1="50" y1="48" x2="71" y2="85" />
            <line x1="50" y1="48" x2="58" y2="92" />
            <line x1="50" y1="48" x2="37" y2="91" />
            <line x1="50" y1="48" x2="22" y2="83" />
            <line x1="50" y1="48" x2="10" y2="69" />
            <line x1="50" y1="48" x2="8" y2="51" />
            <line x1="50" y1="48" x2="13" y2="32" />
            <line x1="50" y1="48" x2="27" y2="16" />
          </g>

          <g className="launch-network-links">
            <line x1="50" y1="8" x2="75" y2="14" />
            <line x1="75" y1="14" x2="88" y2="27" />
            <line x1="88" y1="27" x2="92" y2="42" />
            <line x1="92" y1="42" x2="90" y2="59" />
            <line x1="90" y1="59" x2="83" y2="73" />
            <line x1="83" y1="73" x2="71" y2="85" />
            <line x1="71" y1="85" x2="58" y2="92" />
            <line x1="58" y1="92" x2="37" y2="91" />
            <line x1="37" y1="91" x2="22" y2="83" />
            <line x1="22" y1="83" x2="10" y2="69" />
            <line x1="10" y1="69" x2="8" y2="51" />
            <line x1="8" y1="51" x2="13" y2="32" />
            <line x1="13" y1="32" x2="27" y2="16" />
            <line x1="27" y1="16" x2="50" y2="8" />

            <line x1="27" y1="16" x2="75" y2="14" />
            <line x1="13" y1="32" x2="88" y2="27" />
            <line x1="8" y1="51" x2="92" y2="42" />
            <line x1="10" y1="69" x2="90" y2="59" />
            <line x1="22" y1="83" x2="83" y2="73" />
            <line x1="37" y1="91" x2="71" y2="85" />
            <line x1="27" y1="16" x2="13" y2="32" />
            <line x1="75" y1="14" x2="92" y2="42" />
            <line x1="10" y1="69" x2="37" y2="91" />
            <line x1="90" y1="59" x2="71" y2="85" />
          </g>

          <g className="launch-network-nodes">
            <circle cx="50" cy="8" r=".65" />
            <circle cx="75" cy="14" r=".65" />
            <circle cx="88" cy="27" r=".65" />
            <circle cx="92" cy="42" r=".65" />
            <circle cx="90" cy="59" r=".65" />
            <circle cx="83" cy="73" r=".65" />
            <circle cx="71" cy="85" r=".65" />
            <circle cx="58" cy="92" r=".65" />
            <circle cx="37" cy="91" r=".65" />
            <circle cx="22" cy="83" r=".65" />
            <circle cx="10" cy="69" r=".65" />
            <circle cx="8" cy="51" r=".65" />
            <circle cx="13" cy="32" r=".65" />
            <circle cx="27" cy="16" r=".65" />
          </g>
        </svg>

        <span className="launch-orbit launch-orbit-1" title="Calendar"><CalendarDays size={19} /></span>
        <span className="launch-orbit launch-orbit-2" title="Tasks"><ClipboardList size={19} /></span>
        <span className="launch-orbit launch-orbit-3" title="Checklists"><CheckSquare size={18} /></span>
        <span className="launch-orbit launch-orbit-4" title="Shopping"><ShoppingBag size={19} /></span>
        <span className="launch-orbit launch-orbit-5" title="Household Costs"><Receipt size={19} /></span>
        <span className="launch-orbit launch-orbit-6" title="School & Kita"><GraduationCap size={19} /></span>
        <span className="launch-orbit launch-orbit-7" title="Home Care"><Wrench size={19} /></span>
        <span className="launch-orbit launch-orbit-8" title="Life Admin"><FileText size={19} /></span>
        <span className="launch-orbit launch-orbit-9" title="Projects"><FolderKanban size={19} /></span>
        <span className="launch-orbit launch-orbit-10" title="Meals & Recipes"><Utensils size={19} /></span>
        <span className="launch-orbit launch-orbit-11" title="Files"><Folder size={19} /></span>
        <span className="launch-orbit launch-orbit-12" title="Vaccinations"><Syringe size={19} /></span>
        <span className="launch-orbit launch-orbit-13" title="Tickets"><Ticket size={19} /></span>
        <span className="launch-orbit launch-orbit-14" title="AI Assistant"><Sparkles size={19} /></span>

        <div className="launch-brand">
          <div className="launch-brand-logo" aria-hidden="true">
            <span className="launch-petal launch-petal-purple" />
            <span className="launch-petal launch-petal-pink" />
            <span className="launch-petal launch-petal-green" />
            <span className="launch-petal launch-petal-blue" />
          </div>
          <strong className="launch-brand-name">Famio</strong>
          <i className="launch-loader" aria-hidden="true" />
        </div>
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
