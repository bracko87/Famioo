import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CarFront, CheckSquare, ClipboardList, ContactRound, FileText, Folder, FolderKanban, Gift, GraduationCap, MapPinned, MessageCircle, PawPrint, Plane, Receipt, ScanLine, ShieldAlert, ShoppingBag, Sparkles, StickyNote, Syringe, Ticket, Utensils, Wrench } from 'lucide-react'
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
import { SafetyPage } from './pages/SafetyPage'
import { LocationPage } from './pages/LocationPage'
import { MessengerPage } from './pages/MessengerPage'
import { ContactsPage } from './pages/ContactsPage'
import { MemoPage } from './pages/MemoPage'
import { RewardsPage } from './pages/RewardsPage'
import { TravelPage } from './pages/TravelPage'
import { VehiclesPage } from './pages/VehiclesPage'
import { PetsPage } from './pages/PetsPage'
import { InboxScanPage } from './pages/InboxScanPage'
import { BrandMark } from './components/Brand'

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
            <line x1="50" y1="49" x2="44" y2="8" />
            <line x1="50" y1="49" x2="74" y2="13" />
            <line x1="50" y1="49" x2="84" y2="27" />
            <line x1="50" y1="49" x2="94" y2="40" />
            <line x1="50" y1="49" x2="82" y2="55" />
            <line x1="50" y1="49" x2="91" y2="69" />
            <line x1="50" y1="49" x2="68" y2="80" />
            <line x1="50" y1="49" x2="57" y2="93" />
            <line x1="50" y1="49" x2="35" y2="87" />
            <line x1="50" y1="49" x2="18" y2="80" />
            <line x1="50" y1="49" x2="8" y2="64" />
            <line x1="50" y1="49" x2="21" y2="50" />
            <line x1="50" y1="49" x2="10" y2="30" />
            <line x1="50" y1="49" x2="30" y2="17" />
            <line x1="50" y1="49" x2="31" y2="38" />
            <line x1="50" y1="49" x2="70" y2="44" />
            <line x1="50" y1="49" x2="48" y2="72" />
            <line x1="50" y1="49" x2="26" y2="62" />
            <line x1="50" y1="49" x2="73" y2="63" />
          </g>

          <g className="launch-network-links">
            <line x1="44" y1="8" x2="74" y2="13" />
            <line x1="74" y1="13" x2="84" y2="27" />
            <line x1="84" y1="27" x2="94" y2="40" />
            <line x1="94" y1="40" x2="82" y2="55" />
            <line x1="82" y1="55" x2="91" y2="69" />
            <line x1="91" y1="69" x2="68" y2="80" />
            <line x1="68" y1="80" x2="57" y2="93" />
            <line x1="57" y1="93" x2="35" y2="87" />
            <line x1="35" y1="87" x2="18" y2="80" />
            <line x1="18" y1="80" x2="8" y2="64" />
            <line x1="8" y1="64" x2="21" y2="50" />
            <line x1="21" y1="50" x2="10" y2="30" />
            <line x1="10" y1="30" x2="30" y2="17" />
            <line x1="30" y1="17" x2="44" y2="8" />

            <line x1="30" y1="17" x2="74" y2="13" />
            <line x1="10" y1="30" x2="84" y2="27" />
            <line x1="21" y1="50" x2="82" y2="55" />
            <line x1="8" y1="64" x2="68" y2="80" />
            <line x1="18" y1="80" x2="57" y2="93" />
            <line x1="35" y1="87" x2="91" y2="69" />
            <line x1="44" y1="8" x2="84" y2="27" />
            <line x1="94" y1="40" x2="91" y2="69" />
            <line x1="21" y1="50" x2="35" y2="87" />
            <line x1="82" y1="55" x2="68" y2="80" />
            <line x1="10" y1="30" x2="31" y2="38" />
            <line x1="31" y1="38" x2="21" y2="50" />
            <line x1="31" y1="38" x2="70" y2="44" />
            <line x1="70" y1="44" x2="82" y2="55" />
            <line x1="70" y1="44" x2="84" y2="27" />
            <line x1="48" y1="72" x2="35" y2="87" />
            <line x1="48" y1="72" x2="68" y2="80" />
            <line x1="48" y1="72" x2="21" y2="50" />
            <line x1="26" y1="62" x2="8" y2="64" />
            <line x1="26" y1="62" x2="35" y2="87" />
            <line x1="26" y1="62" x2="48" y2="72" />
            <line x1="73" y1="63" x2="91" y2="69" />
            <line x1="73" y1="63" x2="48" y2="72" />
            <line x1="73" y1="63" x2="82" y2="55" />
          </g>

          <g className="launch-network-nodes">
            <circle cx="44" cy="8" r=".65" />
            <circle cx="74" cy="13" r=".65" />
            <circle cx="84" cy="27" r=".65" />
            <circle cx="94" cy="40" r=".65" />
            <circle cx="82" cy="55" r=".65" />
            <circle cx="91" cy="69" r=".65" />
            <circle cx="68" cy="80" r=".65" />
            <circle cx="57" cy="93" r=".65" />
            <circle cx="35" cy="87" r=".65" />
            <circle cx="18" cy="80" r=".65" />
            <circle cx="8" cy="64" r=".65" />
            <circle cx="21" cy="50" r=".65" />
            <circle cx="10" cy="30" r=".65" />
            <circle cx="30" cy="17" r=".65" />
            <circle cx="31" cy="38" r=".65" />
            <circle cx="70" cy="44" r=".65" />
            <circle cx="48" cy="72" r=".65" />
            <circle cx="26" cy="62" r=".65" />
            <circle cx="73" cy="63" r=".65" />
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
        <span className="launch-orbit launch-orbit-15" title="Family Safety"><ShieldAlert size={19} /></span>
        <span className="launch-orbit launch-orbit-16" title="Family Location"><MapPinned size={19} /></span>
        <span className="launch-orbit launch-orbit-17" title="Family Messenger"><MessageCircle size={19} /></span>
        <span className="launch-orbit launch-orbit-18" title="Family Contacts"><ContactRound size={19} /></span>
        <span className="launch-orbit launch-orbit-19" title="Memo / Someday"><StickyNote size={19} /></span>
        <span className="launch-orbit launch-orbit-20" title="Child Rewards"><Gift size={19} /></span>
        <span className="launch-orbit launch-orbit-21" title="Travel & Trips"><Plane size={19} /></span>
        <span className="launch-orbit launch-orbit-22" title="Vehicles"><CarFront size={19} /></span>
        <span className="launch-orbit launch-orbit-23" title="Pets"><PawPrint size={19} /></span>
        <span className="launch-orbit launch-orbit-24" title="Family Inbox / Scan"><ScanLine size={19} /></span>

        <div className="launch-brand">
          <BrandMark className="launch-brand-logo" />
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
          <Route path="safety" element={<SafetyPage />} />
          <Route path="location" element={<LocationPage />} />
          <Route path="messenger" element={<MessengerPage />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="memo" element={<MemoPage />} />
          <Route path="rewards" element={<RewardsPage />} />
          <Route path="travel" element={<TravelPage />} />
          <Route path="vehicles" element={<VehiclesPage />} />
          <Route path="pets" element={<PetsPage />} />
          <Route path="inbox" element={<InboxScanPage />} />
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
