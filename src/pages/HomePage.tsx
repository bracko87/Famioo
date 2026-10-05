import {
  CalendarDays,
  CheckSquare,
  ClipboardList,
  FileText,
  FolderKanban,
  GraduationCap,
  House,
  Receipt,
  ShoppingBag,
  Sparkles,
  Utensils,
} from 'lucide-react'
import { useEffect, useState, type ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { PromoCarousel } from '../components/PromoCarousel'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'
import type { ModuleCode } from '../lib/types'

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
}

const routeByModule: Record<ModuleCode, string> = {
  calendar: '/app/calendar',
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
}

export function HomePage() {
  const { household, modules } = useHousehold()
  const [eventCount, setEventCount] = useState(0)
  const [taskCount, setTaskCount] = useState(0)
  const [checklistCount, setChecklistCount] = useState(0)
  const [shoppingCount, setShoppingCount] = useState(0)
  const [costMonthTotal, setCostMonthTotal] = useState(0)

  useEffect(() => {
    void supabase.rpc('purge_old_archives_v1', { p_household_id: household.id })

    const today = new Date().toISOString().slice(0, 10)
    const calendarModule = modules.find((module) => module.code === 'calendar')
    const tasksModule = modules.find((module) => module.code === 'tasks')
    const checklistsModule = modules.find((module) => module.code === 'checklists')
    const shoppingModule = modules.find((module) => module.code === 'shopping')
    const costsModule = modules.find((module) => module.code === 'costs')

    const calendarRequest = calendarModule?.enabled
      ? supabase.rpc('calendar_occurrences_v1', {
          p_household_id: household.id,
          p_range_start: today,
          p_range_end: today,
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
      setEventCount(Array.isArray(events.data) ? events.data.length : 0)
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

  const metricByCode: Partial<Record<ModuleCode, string>> = {
    calendar: `${eventCount} today`,
    tasks: `${taskCount} open`,
    checklists: `${checklistCount} active`,
    shopping: `${shoppingCount} active lists`,
    costs: new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(costMonthTotal) + ' this month',
  }

  const enabledModules = modules.filter((module) => module.enabled)

  return (
    <div className="page home-page">
      <div className="page-label">HOME</div>

      <PromoCarousel modules={modules} />

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

        <div className="home-future-area" aria-hidden="true" />
      </section>
    </div>
  )
}
