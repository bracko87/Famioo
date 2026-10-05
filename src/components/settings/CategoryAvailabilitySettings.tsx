import { CalendarDays, CheckSquare, ClipboardList, GraduationCap } from 'lucide-react'
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useHousehold } from '../../context/HouseholdContext'
import { categoryColor } from '../../lib/categoryColors'
import { supabase } from '../../lib/supabase'
import type { EventCategory, ModuleCode } from '../../lib/types'

type AvailabilityRow = {
  module_code: ModuleCode
  category_id: string
  enabled: boolean
}

type CategoryModule = {
  code: Extract<ModuleCode, 'calendar' | 'tasks' | 'checklists' | 'school'>
  label: string
  description: string
  icon: ComponentType<{ size?: number }>
}

const categoryModules: CategoryModule[] = [
  {
    code: 'calendar',
    label: 'Calendar',
    description: 'Categories available when a Calendar event is created.',
    icon: CalendarDays,
  },
  {
    code: 'tasks',
    label: 'Tasks',
    description: 'Categories available when a task is created or edited.',
    icon: ClipboardList,
  },
  {
    code: 'checklists',
    label: 'Checklists',
    description: 'Categories available for normal checklists. Shopping stays separate.',
    icon: CheckSquare,
  },
  {
    code: 'school',
    label: 'School & Kita',
    description: 'Categories available for school, Kita, appointments and kids organization.',
    icon: GraduationCap,
  },
]

export function CategoryAvailabilitySettings() {
  const { household } = useHousehold()
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [availability, setAvailability] = useState<AvailabilityRow[]>([])
  const [busyKey, setBusyKey] = useState('')
  const [message, setMessage] = useState('')

  const canManage = household.role === 'owner' || household.role === 'admin'

  async function load() {
    setMessage('')

    const [categoryResult, availabilityResult] = await Promise.all([
      supabase
        .from('event_categories')
        .select('id,name,color_key')
        .eq('household_id', household.id)
        .eq('active', true)
        .order('sort_order')
        .order('name'),
      supabase
        .from('module_category_availability')
        .select('module_code,category_id,enabled')
        .eq('household_id', household.id),
    ])

    if (categoryResult.error) setMessage(categoryResult.error.message)
    else setCategories((categoryResult.data ?? []) as EventCategory[])

    if (availabilityResult.error) setMessage((current) => current || availabilityResult.error.message)
    else setAvailability((availabilityResult.data ?? []) as AvailabilityRow[])
  }

  useEffect(() => { void load() }, [household.id])

  const enabledByKey = useMemo(
    () => new Map(availability.map((row) => [row.module_code + ':' + row.category_id, row.enabled])),
    [availability],
  )

  async function toggle(moduleCode: CategoryModule['code'], categoryId: string, enabled: boolean) {
    if (!canManage) return

    const key = moduleCode + ':' + categoryId
    setBusyKey(key)
    setMessage('')

    const result = await supabase
      .from('module_category_availability')
      .upsert({
        household_id: household.id,
        module_code: moduleCode,
        category_id: categoryId,
        enabled,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'household_id,module_code,category_id',
      })

    setBusyKey('')

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    setAvailability((current) => {
      const next = current.filter((row) => !(row.module_code === moduleCode && row.category_id === categoryId))
      return [...next, { module_code: moduleCode, category_id: categoryId, enabled }]
    })
  }

  return (
    <div className="category-availability-settings">
      <div className="settings-intro">
        <span className="eyebrow">CATEGORY AVAILABILITY</span>
        <h2>Categories by module</h2>
        <p>Choose which categories appear inside each module. Turning a category off here does not delete the category or existing data.</p>
      </div>

      <div className="category-module-grid">
        {categoryModules.map((module) => {
          const Icon = module.icon

          return (
            <section className="settings-card category-module-card" key={module.code}>
              <header>
                <span className="category-module-icon"><Icon size={17} /></span>
                <div>
                  <h3>{module.label}</h3>
                  <p>{module.description}</p>
                </div>
              </header>

              <div className="category-module-list">
                {categories
                  .filter((category) => {
                    if (module.code !== 'checklists') return true
                    return !['shopping', 'shoping'].includes(category.name.trim().toLowerCase())
                  })
                  .map((category) => {
                    const key = module.code + ':' + category.id
                    const enabled = enabledByKey.get(key) ?? (module.code === 'school' ? false : true)

                    return (
                      <label className="category-availability-row" key={category.id}>
                        <span>
                          <i style={{ backgroundColor: categoryColor(category.color_key) }} />
                          {category.name}
                        </span>

                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={!canManage || busyKey === key}
                          onChange={(event) => void toggle(module.code, category.id, event.target.checked)}
                        />
                      </label>
                    )
                  })}
              </div>
            </section>
          )
        })}
      </div>

      {!canManage && <div className="module-access-note">Only the household owner or an admin can change category availability.</div>}
      {message && <div className="form-message">{message}</div>}
    </div>
  )
}
