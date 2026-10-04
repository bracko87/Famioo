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
  const { household, modules, profiles } = useHousehold()
  const [eventCount, setEventCount] = useState(0)
  const [taskCount, setTaskCount] = useState(0)
  const [checklistCount, setChecklistCount] = useState(0)

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    void Promise.all([
      supabase.rpc('calendar_occurrences_v1', {
        p_household_id: household.id,
        p_range_start: today,
        p_range_end: today,
      }),
      supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('household_id', household.id)
        .eq('status', 'open')
        .is('archived_at', null),
      supabase
        .from('checklists')
        .select('id', { count: 'exact', head: true })
        .eq('household_id', household.id)
        .eq('status', 'active'),
    ]).then(([events, tasks, lists]) => {
      setEventCount(Array.isArray(events.data) ? events.data.length : 0)
      setTaskCount(tasks.count ?? 0)
      setChecklistCount(lists.count ?? 0)
    })
  }, [household.id])

  const metricByCode: Partial<Record<ModuleCode, string>> = {
    calendar: `${eventCount} today`,
    tasks: `${taskCount} open`,
    checklists: `${checklistCount} active`,
  }

  const enabledModules = modules.filter((module) => module.enabled)

  return (
    <div className="page home-page">
      <section className="page-heading home-heading">
        <div>
          <span className="eyebrow">HOME</span>
          <p>{profiles.length} family profile{profiles.length === 1 ? '' : 's'} · shared household overview</p>
        </div>
      </section>

      <section className="home-hero">
        <div>
          <span className="eyebrow light">TODAY</span>
          <h2>Family life, in one calm place.</h2>
          <p>Famioo shows only the modules this household has unlocked.</p>
        </div>
        <Link className="hero-action" to="/app/calendar">Open calendar <span>→</span></Link>
      </section>

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
                  <em>{module.is_core ? 'Included in Famioo core' : 'Unlocked for this household'}</em>
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
