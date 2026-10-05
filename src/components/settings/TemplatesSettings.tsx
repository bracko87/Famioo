import { CalendarDays, CheckSquare, ClipboardList, FolderKanban, Trash2 } from 'lucide-react'
import { useEffect, useState, type ComponentType } from 'react'
import { useHousehold } from '../../context/HouseholdContext'
import { supabase } from '../../lib/supabase'

type TemplateKind = 'calendar' | 'tasks' | 'checklists' | 'projects'

type TemplateRow = {
  id: string
  name: string
  title: string
  category_id: string | null
  location_text: string | null
}

type Section = {
  kind: TemplateKind
  title: string
  description: string
  icon: ComponentType<{ size?: number }>
  rows: TemplateRow[]
  canWrite: boolean
}

export function TemplatesSettings() {
  const { household, modules } = useHousehold()
  const [calendarTemplates, setCalendarTemplates] = useState<TemplateRow[]>([])
  const [taskTemplates, setTaskTemplates] = useState<TemplateRow[]>([])
  const [checklistTemplates, setChecklistTemplates] = useState<TemplateRow[]>([])
  const [projectTemplates, setProjectTemplates] = useState<TemplateRow[]>([])
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')

  const calendarWrite = Boolean(modules.find((module) => module.code === 'calendar')?.can_write)
  const tasksWrite = Boolean(modules.find((module) => module.code === 'tasks')?.can_write)
  const checklistsWrite = Boolean(modules.find((module) => module.code === 'checklists')?.can_write)
  const projectsWrite = Boolean(modules.find((module) => module.code === 'projects')?.can_write)

  async function load() {
    setMessage('')

    const [calendarResult, taskResult, checklistResult, projectResult] = await Promise.all([
      supabase
        .from('event_templates')
        .select('id,name,title,category_id,location_text')
        .eq('household_id', household.id)
        .eq('active', true)
        .order('name'),
      supabase
        .from('task_templates')
        .select('id,name,title,category_id,location_text')
        .eq('household_id', household.id)
        .eq('active', true)
        .order('name'),
      supabase
        .from('checklist_templates')
        .select('id,name,title,category_id,location_text')
        .eq('household_id', household.id)
        .eq('active', true)
        .order('name'),
      supabase
        .from('project_work_templates')
        .select('id,name,title,category_id,location_text')
        .eq('household_id', household.id)
        .eq('active', true)
        .order('name'),
    ])

    if (calendarResult.error) setMessage(calendarResult.error.message)
    else setCalendarTemplates((calendarResult.data ?? []) as TemplateRow[])

    if (taskResult.error) setMessage((current) => current || taskResult.error.message)
    else setTaskTemplates((taskResult.data ?? []) as TemplateRow[])

    if (checklistResult.error) setMessage((current) => current || checklistResult.error.message)
    else setChecklistTemplates((checklistResult.data ?? []) as TemplateRow[])

    if (projectResult.error) setMessage((current) => current || projectResult.error.message)
    else setProjectTemplates((projectResult.data ?? []) as TemplateRow[])
  }

  useEffect(() => { void load() }, [household.id])

  async function removeTemplate(kind: TemplateKind, id: string) {
    setBusyId(id)
    setMessage('')

    const table = kind === 'calendar'
      ? 'event_templates'
      : kind === 'tasks'
        ? 'task_templates'
        : kind === 'checklists'
          ? 'checklist_templates'
          : 'project_work_templates'

    const result = await supabase
      .from(table)
      .update({
        active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('household_id', household.id)

    setBusyId('')

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    await load()
  }

  const sections: Section[] = [
    {
      kind: 'calendar',
      title: 'Calendar',
      description: 'Saved event templates used when creating Calendar events.',
      icon: CalendarDays,
      rows: calendarTemplates,
      canWrite: calendarWrite,
    },
    {
      kind: 'tasks',
      title: 'Tasks',
      description: 'Reusable task setups saved from the Tasks module.',
      icon: ClipboardList,
      rows: taskTemplates,
      canWrite: tasksWrite,
    },
    {
      kind: 'checklists',
      title: 'Checklists',
      description: 'Reusable checklist setups saved from the Checklists module.',
      icon: CheckSquare,
      rows: checklistTemplates,
      canWrite: checklistsWrite,
    },
    {
      kind: 'projects',
      title: 'Projects & Chores',
      description: 'Reusable responsibility setups with categories, assignees and point-calculator settings.',
      icon: FolderKanban,
      rows: projectTemplates,
      canWrite: projectsWrite,
    },
  ]

  return (
    <div className="templates-settings">
      <div className="settings-intro">
        <span className="eyebrow">TEMPLATES</span>
        <h2>Saved templates</h2>
        <p>Templates created inside a module are collected here. Removing one here also removes it from that module's template picker.</p>
      </div>

      <div className="template-section-grid">
        {sections.map((section) => {
          const Icon = section.icon

          return (
            <section className="settings-card template-section-card" key={section.kind}>
              <header>
                <span className="template-section-icon"><Icon size={17} /></span>
                <div>
                  <h3>{section.title}</h3>
                  <p>{section.description}</p>
                </div>
                <span className="template-count">{section.rows.length}</span>
              </header>

              {section.rows.length === 0 ? (
                <div className="template-empty">No saved {section.title.toLowerCase()} templates.</div>
              ) : (
                <div className="template-list">
                  {section.rows.map((template) => (
                    <div className="template-row" key={template.id}>
                      <div>
                        <span>{template.name}</span>
                        <small>{template.location_text || 'No location saved'}</small>
                      </div>

                      {section.canWrite && (
                        <button
                          type="button"
                          className="icon-button compact-icon"
                          aria-label={'Remove ' + template.name}
                          disabled={busyId === template.id}
                          onClick={() => void removeTemplate(section.kind, template.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {message && <div className="form-message">{message}</div>}
    </div>
  )
}
