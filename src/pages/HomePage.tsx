import {
  BadgeAlert,
  CalendarDays,
  CarFront,
  CheckSquare,
  ClipboardList,
  ContactRound,
  FileText,
  FolderKanban,
  GraduationCap,
  House,
  MapPinned,
  MessageCircle,
  Receipt,
  ScanLine,
  ShoppingBag,
  ShieldAlert,
  Sparkles,
  StickyNote,
  Gift,
  PawPrint,
  Plane,
  Syringe,
  Ticket,
  Utensils,
} from 'lucide-react'
import { useEffect, useState, type ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { PromoCarousel } from '../components/PromoCarousel'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useHousehold } from '../context/HouseholdContext'
import { firstName } from '../lib/personName'
import { supabase } from '../lib/supabase'
import type { CalendarOccurrence, ModuleCode } from '../lib/types'

const iconByModule: Partial<Record<ModuleCode, ComponentType<{ size?: number }>>> = {
  calendar: CalendarDays,
  tasks: ClipboardList,
  checklists: CheckSquare,
  shopping: ShoppingBag,
  costs: Receipt,
  school: GraduationCap,
  home_care: House,
  life_admin: FileText,
  projects: FolderKanban,
  meals: Utensils,
  files: FileText,
  assistant: Sparkles,
  vaccinations: Syringe,
  tickets: Ticket,
  safety: ShieldAlert,
  location: MapPinned,
  messenger: MessageCircle,
  contacts: ContactRound,
  memo: StickyNote,
  rewards: Gift,
  travel: Plane,
  vehicles: CarFront,
  pets: PawPrint,
  inbox_scan: ScanLine,
  emergency_info: BadgeAlert,
}

const routeByModule: Record<ModuleCode, string> = {
  calendar: '/app/calendar',
  calendar_connections: '/app/calendar/connections',
  tasks: '/app/tasks',
  checklists: '/app/checklists',
  shopping: '/app/shopping',
  costs: '/app/costs',
  school: '/app/school',
  home_care: '/app/home-care',
  life_admin: '/app/life-admin',
  projects: '/app/projects',
  meals: '/app/meals',
  files: '/app/files',
  assistant: '/app/assistant',
  vaccinations: '/app/vaccinations',
  tickets: '/app/tickets',
  safety: '/app/safety',
  location: '/app/location',
  messenger: '/app/messenger',
  contacts: '/app/contacts',
  memo: '/app/memo',
  rewards: '/app/rewards',
  travel: '/app/travel',
  vehicles: '/app/vehicles',
  pets: '/app/pets',
  inbox_scan: '/app/inbox',
  emergency_info: '/app/emergency',
}

export function HomePage() {
  const { household, modules, profiles } = useHousehold()
  const [eventCount, setEventCount] = useState(0)
  const [taskCount, setTaskCount] = useState(0)
  const [checklistCount, setChecklistCount] = useState(0)
  const [shoppingCount, setShoppingCount] = useState(0)
  const [costMonthTotal, setCostMonthTotal] = useState(0)
  const [familyPoints, setFamilyPoints] = useState<Record<string, number>>({})
  const [upcomingEvents, setUpcomingEvents] = useState<CalendarOccurrence[]>([])
  useEffect(() => {
    void supabase.rpc('purge_old_archives_v1', { p_household_id: household.id })

    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const upcomingEndDate = new Date(now)
    upcomingEndDate.setDate(upcomingEndDate.getDate() + 10)
    const upcomingEnd = upcomingEndDate.toISOString().slice(0, 10)
    const calendarModule = modules.find((module) => module.code === 'calendar')
    const tasksModule = modules.find((module) => module.code === 'tasks')
    const checklistsModule = modules.find((module) => module.code === 'checklists')
    const shoppingModule = modules.find((module) => module.code === 'shopping')
    const costsModule = modules.find((module) => module.code === 'costs')

    const calendarRequest = calendarModule?.enabled
      ? supabase.rpc('calendar_occurrences_v1', {
          p_household_id: household.id,
          p_range_start: today,
          p_range_end: upcomingEnd,
        })
      : Promise.resolve({ data: [], error: null })

    const tasksRequest = tasksModule?.enabled
      ? supabase
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .eq('household_id', household.id)
          .eq('status', 'open')
          .is('archived_at', null)
      : Promise.resolve({ count: 0, error: null })

    const checklistsRequest = checklistsModule?.enabled
      ? supabase
          .from('checklists')
          .select('id', { count: 'exact', head: true })
          .eq('household_id', household.id)
          .eq('status', 'active')
      : Promise.resolve({ count: 0, error: null })

    const shoppingRequest = shoppingModule?.enabled
      ? supabase
          .from('shopping_lists')
          .select('id', { count: 'exact', head: true })
          .eq('household_id', household.id)
          .eq('status', 'active')
      : Promise.resolve({ count: 0, error: null })

    const monthStart = today.slice(0, 8) + '01'
    const currentYear = Number(today.slice(0, 4))
    const currentMonth = Number(today.slice(5, 7))
    const lastDay = new Date(Date.UTC(currentYear, currentMonth, 0)).getUTCDate()
    const monthEnd = today.slice(0, 8) + String(lastDay).padStart(2, '0')

    const costsRequest = costsModule?.enabled
      ? supabase
          .from('household_costs')
          .select('amount,cost_date,schedule_type')
          .eq('household_id', household.id)
          .lte('cost_date', monthEnd)
      : Promise.resolve({ data: [], error: null })

    void Promise.all([calendarRequest, tasksRequest, checklistsRequest, shoppingRequest, costsRequest]).then(([events, tasks, lists, shopping, costs]) => {
      const occurrenceRows = (Array.isArray(events.data) ? events.data : []) as CalendarOccurrence[]
      const orderedOccurrences = [...occurrenceRows].sort((a,b) => {
        const aKey = a.occurrence_start_at ?? ((a.occurrence_start_date ?? '9999-12-31') + 'T00:00:00')
        const bKey = b.occurrence_start_at ?? ((b.occurrence_start_date ?? '9999-12-31') + 'T00:00:00')
        return aKey.localeCompare(bKey) || a.title.localeCompare(b.title)
      })
      setUpcomingEvents(orderedOccurrences)
      setEventCount(orderedOccurrences.filter((item) => {
        const day = item.occurrence_start_date ?? item.occurrence_start_at?.slice(0,10)
        return day === today
      }).length)
      setTaskCount(tasks.count ?? 0)
      setChecklistCount(lists.count ?? 0)
      setShoppingCount(shopping.count ?? 0)
      setCostMonthTotal(Array.isArray(costs.data)
        ? costs.data.reduce((sum, row) => {
            const scheduled = row.schedule_type === 'scheduled'
            const inCurrentMonth = row.cost_date >= monthStart && row.cost_date <= monthEnd
            return sum + (scheduled || inCurrentMonth ? Number(row.amount ?? 0) : 0)
          }, 0)
        : 0)
    })
  }, [household.id, modules])

  useEffect(() => {
    const projectsModule = modules.find((module) => module.code === 'projects')
    if (!projectsModule?.enabled) {
      setFamilyPoints({})
      return
    }

    const monthKey = new Date().toISOString().slice(0,7)

    void supabase
      .from('family_points_ledger')
      .select('profile_id,points,awarded_at')
      .eq('household_id',household.id)
      .gte('awarded_at',monthKey + '-01T00:00:00')
      .then(({ data,error }) => {
        if (error) return

        const totals: Record<string,number> = {}
        for (const row of data ?? []) {
          totals[row.profile_id] = (totals[row.profile_id] ?? 0) + Number(row.points ?? 0)
        }
        setFamilyPoints(totals)
      })
  }, [household.id,modules])


  const todayKey = new Date().toISOString().slice(0,10)
  const todayEvents = upcomingEvents.filter((item) =>
    (item.occurrence_start_date ?? item.occurrence_start_at?.slice(0,10)) === todayKey,
  )
  const nextEvents = upcomingEvents.filter((item) =>
    (item.occurrence_start_date ?? item.occurrence_start_at?.slice(0,10)) !== todayKey,
  )

  function occurrenceMeta(item: CalendarOccurrence) {
    const dayKey = item.occurrence_start_date ?? item.occurrence_start_at?.slice(0,10) ?? ''
    const dateLabel = dayKey
      ? new Date(dayKey + 'T12:00:00').toLocaleDateString(undefined,{ weekday:'short',day:'numeric',month:'short' })
      : ''
    if (item.all_day || !item.occurrence_start_at) return dateLabel + ' · All day'
    const time = new Date(item.occurrence_start_at).toLocaleTimeString(undefined,{
      timeZone:item.event_timezone,
      hour:'2-digit',
      minute:'2-digit',
    })
    return dateLabel + ' · ' + time
  }

  const metricByCode: Partial<Record<ModuleCode, string>> = {
    calendar: `${eventCount} today`,
    tasks: `${taskCount} open`,
    checklists: `${checklistCount} active`,
    safety: 'SOS ready · household safety',
    location: 'Family map & safe places',
    messenger: 'Private family chat',
    contacts: 'People & important services',
    memo: 'Ideas, places & someday notes',
    shopping: `${shoppingCount} active lists`,
    costs: new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(costMonthTotal) + ' this month',
  }

  const enabledModules = modules.filter((module) => module.enabled)

  return (
    <div className="page home-page">
      <div className="page-label">HOME</div>

      <div className="home-mobile-promo-wrap">
        <PromoCarousel modules={modules} />
      </div>

      <section className="home-module-area" aria-label="Enabled modules">
        <div className="module-stack">
          {enabledModules.map((module, index) => {
            const Icon = iconByModule[module.code] ?? Sparkles

            return (
              <Link
                className={`module-banner module-tone-${(index % 8) + 1}`}
                to={routeByModule[module.code]}
                key={module.code}
              >
                <span className="module-banner-icon"><Icon size={20} /></span>
                <span className="module-banner-copy">
                  <small>{module.name.toUpperCase()}</small>
                  <strong>{metricByCode[module.code] ?? module.description}</strong>
                  <em>
                    {module.access_level === 'read'
                      ? 'Read only'
                      : module.is_core
                        ? 'Included in Famioo core'
                        : 'Unlocked for this household'}
                  </em>
                </span>
                <b>›</b>
              </Link>
            )
          })}
        </div>

        <div className="home-future-area">
          {modules.find((module) => module.code === 'calendar')?.enabled && (
            <Link className="home-upcoming-calendar list-card" to="/app/calendar">
              <header>
                <div>
                  <span className="eyebrow">UPCOMING</span>
                  <h2>Today & next 10 days</h2>
                </div>
              </header>

              <div className="home-upcoming-calendar-groups">
                <section>
                  <div className="home-upcoming-calendar-label">
                    <span>Today</span>
                    <small>{todayEvents.length}</small>
                  </div>
                  {todayEvents.length ? todayEvents.map((item)=>(
                    <div className="home-upcoming-calendar-row" key={item.occurrence_key}>
                      <CalendarDays size={14}/>
                      <span>
                        <strong>{item.title}</strong>
                        <small>{occurrenceMeta(item)}</small>
                      </span>
                    </div>
                  )) : <div className="home-upcoming-calendar-empty">Nothing planned today.</div>}
                </section>

                <section>
                  <div className="home-upcoming-calendar-label">
                    <span>Next 10 days</span>
                    <small>{nextEvents.length}</small>
                  </div>
                  {nextEvents.length ? nextEvents.map((item)=>(
                    <div className="home-upcoming-calendar-row" key={item.occurrence_key}>
                      <CalendarDays size={14}/>
                      <span>
                        <strong>{item.title}</strong>
                        <small>{occurrenceMeta(item)}</small>
                      </span>
                    </div>
                  )) : <div className="home-upcoming-calendar-empty">No upcoming events in the next 10 days.</div>}
                </section>
              </div>

              <footer>Open Calendar →</footer>
            </Link>
          )}

          {modules.find((module) => module.code === 'projects')?.enabled && (
            <Link className="home-family-standing list-card" to="/app/projects">
              <header>
                <div>
                  <span className="eyebrow">FAMILY STANDING</span>
                  <h2>This month</h2>
                </div>
              </header>

              <div className="home-family-standing-list">
                {[...profiles]
                  .sort((a,b) => (familyPoints[b.id] ?? 0) - (familyPoints[a.id] ?? 0) || a.display_name.localeCompare(b.display_name))
                  .map((profile,index) => (
                    <div className="home-family-standing-row" key={profile.id}>
                      <span className="home-standing-rank">{index + 1}</span>
                      <ProfileAvatar avatarPath={profile.avatar_path} name={profile.display_name} size="sm" />
                      <span>{firstName(profile.display_name)}</span>
                      <strong>{familyPoints[profile.id] ?? 0} pts</strong>
                    </div>
                  ))}
              </div>

              <footer>Open Projects & Chores →</footer>
            </Link>
          )}
        </div>
      </section>
    </div>
  )
}
