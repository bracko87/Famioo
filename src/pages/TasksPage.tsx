import { CalendarDays, MapPin, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { Select } from '../components/ui/Select'
import { useHousehold } from '../context/HouseholdContext'
import { categoryColor } from '../lib/categoryColors'
import { supabase } from '../lib/supabase'
import type { EventCategory } from '../lib/types'

type Task = {
  id: string
  title: string
  status: 'open' | 'done' | 'archived'
  priority: 'low' | 'normal' | 'high'
  due_date: string | null
  category_id: string | null
  location_text: string | null
  linked_event_id: string | null
}

type TaskParticipant = {
  task_id: string
  profile_id: string
}

type TaskTemplate = {
  id: string
  name: string
  title: string
  category_id: string | null
  location_text: string | null
  default_assigned_profile_id: string | null
}

export function TasksPage() {
  const { household, modules, profiles } = useHousehold()
  const canWrite = Boolean(modules.find((module) => module.code === 'tasks')?.can_write)

  const [tasks, setTasks] = useState<Task[]>([])
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [participants, setParticipants] = useState<TaskParticipant[]>([])
  const [composerOpen, setComposerOpen] = useState(false)
  const [templateId, setTemplateId] = useState('')
  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [locationText, setLocationText] = useState('')
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const [addToCalendar, setAddToCalendar] = useState(false)
  const [saveTemplate, setSaveTemplate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setError('')

    const [taskResult, participantResult, categoryResult, templateResult] = await Promise.all([
      supabase
        .from('tasks')
        .select('id,title,status,priority,due_date,category_id,location_text,linked_event_id')
        .eq('household_id', household.id)
        .is('archived_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('task_participants')
        .select('task_id,profile_id')
        .eq('household_id', household.id),
      supabase
        .from('event_categories')
        .select('id,name,color_key')
        .eq('household_id', household.id)
        .eq('active', true)
        .order('sort_order'),
      supabase
        .from('task_templates')
        .select('id,name,title,category_id,location_text,default_assigned_profile_id')
        .eq('household_id', household.id)
        .eq('active', true)
        .order('name'),
    ])

    if (taskResult.error) setError(taskResult.error.message)
    else setTasks((taskResult.data ?? []) as Task[])

    if (participantResult.error) setError((current) => current || participantResult.error.message)
    else setParticipants((participantResult.data ?? []) as TaskParticipant[])

    if (categoryResult.error) {
      setError((current) => current || categoryResult.error.message)
    } else {
      const rows = (categoryResult.data ?? []) as EventCategory[]
      setCategories(rows)
      setCategoryId((current) => rows.some((item) => item.id === current)
        ? current
        : rows[0]?.id ?? '')
    }

    if (templateResult.error) setError((current) => current || templateResult.error.message)
    else setTemplates((templateResult.data ?? []) as TaskTemplate[])
  }

  useEffect(() => { void load() }, [household.id])

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )

  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  )

  function openComposer() {
    setTemplateId('')
    setTitle('')
    setDueDate('')
    setLocationText('')
    setParticipantIds([])
    setAddToCalendar(false)
    setSaveTemplate(false)
    setError('')
    setComposerOpen(true)
  }

  function applyTemplate(nextTemplateId: string) {
    setTemplateId(nextTemplateId)
    if (!nextTemplateId) return

    const template = templates.find((item) => item.id === nextTemplateId)
    if (!template) return

    setTitle(template.title)
    setCategoryId(template.category_id ?? categories[0]?.id ?? '')
    setLocationText(template.location_text ?? '')
    setParticipantIds(template.default_assigned_profile_id ? [template.default_assigned_profile_id] : [])
  }

  async function createTask(event: FormEvent) {
    event.preventDefault()
    if (!canWrite || !title.trim() || !categoryId) return

    if (addToCalendar && !dueDate) {
      setError('Choose a date before adding this task to Calendar.')
      return
    }

    setSaving(true)
    setError('')

    const result = await supabase.rpc('create_task_v1', {
      p_household_id: household.id,
      p_title: title.trim(),
      p_category_id: categoryId,
      p_due_date: dueDate || null,
      p_location_text: locationText.trim() || null,
      p_participants: participantIds.map((profileId) => ({ profile_id: profileId })),
      p_add_to_calendar: addToCalendar,
      p_create_template: saveTemplate,
    })

    setSaving(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    setComposerOpen(false)
    await load()
  }

  async function toggle(task: Task) {
    if (!canWrite) return

    const done = task.status !== 'done'
    const result = await supabase.from('tasks').update({
      status: done ? 'done' : 'open',
      completed_at: done ? new Date().toISOString() : null,
      completed_by_profile_id: null,
      updated_at: new Date().toISOString(),
    }).eq('id', task.id)

    if (result.error) setError(result.error.message)
    else await load()
  }

  return (
    <div className="page tasks-page">
      <div className="page-heading-row">
        <div>
          <div className="page-label">TASKS</div>
          <h1>Household tasks</h1>
        </div>

        {canWrite && (
          <button className="primary-button compact" onClick={openComposer}>
            <Plus size={16} />
            Create task
          </button>
        )}
      </div>

      {!canWrite && <div className="module-access-note">Read-only access</div>}
      {error && !composerOpen && <div className="notice error">{error}</div>}

      <section className="list-card">
        {tasks.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-title">No tasks yet.</span>
            <span>{canWrite ? 'Create the first household task.' : 'There are no household tasks to show.'}</span>
          </div>
        ) : tasks.map((task) => {
          const category = task.category_id ? categoryById.get(task.category_id) : undefined
          const taskProfiles = participants
            .filter((item) => item.task_id === task.id)
            .map((item) => profileById.get(item.profile_id))
            .filter(Boolean)

          return (
            <button
              className={task.status === 'done' ? 'task-row done' : 'task-row'}
              key={task.id}
              onClick={() => void toggle(task)}
              disabled={!canWrite}
            >
              <span className="task-check">{task.status === 'done' ? '✓' : ''}</span>
              <span className="task-main-copy">
                <span className="task-title">{task.title}</span>
                <small className="task-meta">
                  {category && (
                    <span><i className="meta-dot" style={{ backgroundColor: categoryColor(category.color_key) }} />{category.name}</span>
                  )}
                  <span>{task.due_date ?? 'No date'}</span>
                  {task.location_text && <span><MapPin size={11} />{task.location_text}</span>}
                  {task.linked_event_id && <span><CalendarDays size={11} />Calendar</span>}
                </small>
              </span>
              <span className="task-participant-stack">
                {taskProfiles.slice(0, 4).map((profile) => profile && (
                  <ProfileAvatar
                    key={profile.id}
                    avatarPath={profile.avatar_path}
                    name={profile.display_name}
                    size="sm"
                  />
                ))}
              </span>
            </button>
          )
        })}
      </section>

      {composerOpen && canWrite && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setComposerOpen(false)
          }}
        >
          <form className="modal-card task-composer" onSubmit={createTask}>
            <header>
              <div>
                <span className="eyebrow">NEW TASK</span>
                <h2>Create task</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close task form" onClick={() => setComposerOpen(false)}>
                <X size={18} />
              </button>
            </header>

            <label>
              Start from template
              <Select
                value={templateId}
                onChange={applyTemplate}
                placeholder="Blank task"
                options={[
                  { value: '', label: 'Blank task' },
                  ...templates.map((template) => ({
                    value: template.id,
                    label: template.name,
                  })),
                ]}
                ariaLabel="Choose task template"
              />
            </label>

            <div className="composer-grid-two">
              <label>
                Task name
                <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus required />
              </label>

              <label>
                Category
                <Select
                  value={categoryId}
                  onChange={setCategoryId}
                  options={categories.map((item) => ({
                    value: item.id,
                    label: item.name,
                    dotColor: categoryColor(item.color_key),
                  }))}
                  ariaLabel="Choose task category"
                />
              </label>
            </div>

            <div className="composer-grid-two">
              <label>
                Date
                <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
                <small className="field-hint">Optional unless the task is added to Calendar.</small>
              </label>

              <label>
                Location
                <input value={locationText} onChange={(event) => setLocationText(event.target.value)} placeholder="Optional location" />
              </label>
            </div>

            <fieldset>
              <legend>Participants</legend>
              <div className="profile-choice-grid profile-choice-grid-wide">
                {profiles.map((profile) => (
                  <label className="profile-choice" key={profile.id}>
                    <input
                      type="checkbox"
                      checked={participantIds.includes(profile.id)}
                      onChange={(event) => {
                        setParticipantIds((current) => event.target.checked
                          ? [...current, profile.id]
                          : current.filter((id) => id !== profile.id))
                      }}
                    />
                    <ProfileAvatar avatarPath={profile.avatar_path} name={profile.display_name} size="sm" />
                    <span className="profile-choice-name">{profile.display_name}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="composer-option-list">
              <label className="composer-option">
                <input type="checkbox" checked={addToCalendar} onChange={(event) => setAddToCalendar(event.target.checked)} />
                <span>
                  <span>Add this task to Calendar</span>
                  <small>Creates one all-day calendar event on the selected date.</small>
                </span>
              </label>

              <label className="composer-option">
                <input type="checkbox" checked={saveTemplate} onChange={(event) => setSaveTemplate(event.target.checked)} />
                <span>
                  <span>Save as task template</span>
                  <small>Reuse this task setup later.</small>
                </span>
              </label>
            </div>

            {error && <div className="form-message error">{error}</div>}

            <button className="primary-button" disabled={saving}>
              {saving ? 'Creating…' : 'Create task'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
