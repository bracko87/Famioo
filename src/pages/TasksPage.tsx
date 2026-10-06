import { Archive, CalendarDays, FolderKanban, MoreVertical, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DatePicker } from '../components/ui/DatePicker'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { Select } from '../components/ui/Select'
import { GoogleMapsLink } from '../components/ui/GoogleMapsLink'
import { useHousehold } from '../context/HouseholdContext'
import { categoryColor } from '../lib/categoryColors'
import { firstName } from '../lib/personName'
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
  cost_amount: number | null
  created_at: string
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

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function TaskActions({
  task,
  canWrite,
  onEdit,
  onArchive,
  onDelete,
}: {
  task: Task
  canWrite: boolean
  onEdit: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }

    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', keydown)

    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', keydown)
    }
  }, [])

  if (!canWrite) return null

  return (
    <div className="task-actions" ref={rootRef}>
      <button
        type="button"
        className="task-menu-trigger"
        aria-label={'Actions for ' + task.title}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreVertical size={17} />
      </button>

      {open && (
        <div className="task-menu">
          <button type="button" onClick={() => {
            setOpen(false)
            onEdit()
          }}>
            <Pencil size={14} />
            Edit task
          </button>

          <button type="button" onClick={() => {
            setOpen(false)
            onArchive()
          }}>
            <Archive size={14} />
            Move to archive
          </button>

          {task.status === 'done' && (
            <button className="danger" type="button" onClick={() => {
              setOpen(false)
              onDelete()
            }}>
              <Trash2 size={14} />
              Delete task
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function TasksPage() {
  const { household, modules, profiles } = useHousehold()
  const navigate = useNavigate()
  const canWrite = Boolean(modules.find((module) => module.code === 'tasks')?.can_write)
  const costsEnabled = Boolean(modules.find((module) => module.code === 'costs')?.enabled)
  const projectsWritable = Boolean(modules.find((module) => module.code === 'projects')?.enabled && modules.find((module) => module.code === 'projects')?.can_write)

  const [tasks, setTasks] = useState<Task[]>([])
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [participants, setParticipants] = useState<TaskParticipant[]>([])
  const [archivedCount, setArchivedCount] = useState(0)
  const [composerOpen, setComposerOpen] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [templateId, setTemplateId] = useState('')
  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [locationText, setLocationText] = useState('')
  const [costAmount, setCostAmount] = useState('')
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const [addToCalendar, setAddToCalendar] = useState(false)
  const [saveTemplate, setSaveTemplate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setError('')

    await Promise.all([
      supabase.rpc('archive_overdue_work_v1', { p_household_id: household.id }),
      supabase.rpc('purge_old_archives_v1', { p_household_id: household.id }),
    ])

    const [taskResult, participantResult, categoryResult, availabilityResult, templateResult, archiveResult] = await Promise.all([
      supabase
        .from('tasks')
        .select('id,title,status,priority,due_date,category_id,location_text,linked_event_id,cost_amount,created_at')
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
        .from('module_category_availability')
        .select('category_id,enabled')
        .eq('household_id', household.id)
        .eq('module_code', 'tasks'),
      supabase
        .from('task_templates')
        .select('id,name,title,category_id,location_text,default_assigned_profile_id')
        .eq('household_id', household.id)
        .eq('active', true)
        .order('name'),
      supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('household_id', household.id)
        .not('archived_at', 'is', null),
    ])

    if (taskResult.error) setError(taskResult.error.message)
    else setTasks((taskResult.data ?? []) as Task[])

    if (participantResult.error) setError((current) => current || participantResult.error.message)
    else setParticipants((participantResult.data ?? []) as TaskParticipant[])

    if (categoryResult.error || availabilityResult.error) {
      setError((current) => current || categoryResult.error?.message || availabilityResult.error?.message || 'Could not load task categories.')
    } else {
      const enabled = new Map((availabilityResult.data ?? []).map((row) => [row.category_id, row.enabled]))
      const rows = ((categoryResult.data ?? []) as EventCategory[])
        .filter((item) => enabled.get(item.id) ?? true)
      setCategories(rows)
      setCategoryId((current) => rows.some((item) => item.id === current)
        ? current
        : rows[0]?.id ?? '')
    }

    if (templateResult.error) setError((current) => current || templateResult.error.message)
    else setTemplates((templateResult.data ?? []) as TaskTemplate[])

    if (archiveResult.error) setError((current) => current || archiveResult.error.message)
    else setArchivedCount(archiveResult.count ?? 0)
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

  const taskGroups = useMemo(() => {
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    const todayKey = dateKey(today)
    const boundary = dateKey(addDays(today, 9))

    const dated = tasks
      .filter((task) => task.due_date && (task.due_date ?? '') >= todayKey)
      .sort((a, b) => {
        const byDate = (a.due_date ?? '').localeCompare(b.due_date ?? '')
        return byDate || a.title.localeCompare(b.title)
      })

    return {
      near: dated.filter((task) => (task.due_date ?? '') <= boundary),
      later: dated.filter((task) => (task.due_date ?? '') > boundary),
      undated: tasks
        .filter((task) => !task.due_date)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    }
  }, [tasks])

  function resetComposer() {
    setEditingTaskId(null)
    setTemplateId('')
    setTitle('')
    setDueDate('')
    setLocationText('')
    setCostAmount('')
    setParticipantIds([])
    setAddToCalendar(false)
    setSaveTemplate(false)
    setError('')
  }

  function openComposer() {
    resetComposer()
    setComposerOpen(true)
  }

  function openEdit(task: Task) {
    setEditingTaskId(task.id)
    setTemplateId('')
    setTitle(task.title)
    setCategoryId(task.category_id && categories.some((category) => category.id === task.category_id)
      ? task.category_id
      : categories[0]?.id ?? '')
    setDueDate(task.due_date ?? '')
    setLocationText(task.location_text ?? '')
    setCostAmount(task.cost_amount != null ? String(task.cost_amount) : '')
    setParticipantIds(
      participants
        .filter((item) => item.task_id === task.id)
        .map((item) => item.profile_id),
    )
    setAddToCalendar(Boolean(task.linked_event_id))
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

  async function saveTask(event: FormEvent) {
    event.preventDefault()
    if (!canWrite || !title.trim() || !categoryId) return

    if (addToCalendar && !dueDate) {
      setError('Choose a date before adding this task to Calendar.')
      return
    }

    setSaving(true)
    setError('')

    const participantPayload = participantIds.map((profileId) => ({ profile_id: profileId }))

    const result = editingTaskId
      ? await supabase.rpc('update_task_v1', {
          p_task_id: editingTaskId,
          p_household_id: household.id,
          p_title: title.trim(),
          p_category_id: categoryId,
          p_due_date: dueDate || null,
          p_location_text: locationText.trim() || null,
          p_participants: participantPayload,
          p_add_to_calendar: addToCalendar,
        })
      : await supabase.rpc('create_task_v1', {
          p_household_id: household.id,
          p_title: title.trim(),
          p_category_id: categoryId,
          p_due_date: dueDate || null,
          p_location_text: locationText.trim() || null,
          p_participants: participantPayload,
          p_add_to_calendar: addToCalendar,
          p_create_template: saveTemplate,
        })

    if (!result.error && costsEnabled) {
      const normalizedCost = costAmount.trim().replace(',', '.')
      const numericCost = normalizedCost ? Number(normalizedCost) : null

      if (normalizedCost && (!Number.isFinite(numericCost) || Number(numericCost) < 0)) {
        setSaving(false)
        setError('Enter a valid task cost.')
        return
      }

      const taskId = editingTaskId ?? (result.data as string | null)
      if (taskId) {
        const costResult = await supabase
          .from('tasks')
          .update({
            cost_amount: numericCost,
            cost_currency: 'EUR',
            updated_at: new Date().toISOString(),
          })
          .eq('id', taskId)
          .eq('household_id', household.id)

        if (costResult.error) {
          setSaving(false)
          setError(costResult.error.message)
          return
        }
      }
    }

    setSaving(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    setComposerOpen(false)
    resetComposer()
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

  async function deleteTask(task: Task) {
    if (!canWrite || task.status !== 'done') return

    setError('')
    const result = await supabase.rpc('delete_completed_task_v1', {
      p_task_id: task.id,
      p_household_id: household.id,
    })

    if (result.error) setError(result.error.message)
    else await load()
  }

  async function archiveTask(task: Task) {
    if (!canWrite) return
    setError('')

    const result=await supabase.rpc('set_task_archived_v1',{
      p_task_id:task.id,
      p_household_id:household.id,
      p_archived:true,
    })

    if (result.error) setError(result.error.message)
    else await load()
  }

  function TaskRow({ task }: { task: Task }) {
    const category = task.category_id ? categoryById.get(task.category_id) : undefined
    const taskProfiles = participants
      .filter((item) => item.task_id === task.id)
      .map((item) => profileById.get(item.profile_id))
      .filter(Boolean)

    const today = dateKey(new Date())
    const overdue = Boolean(task.due_date && task.due_date < today && task.status !== 'done')

    return (
      <div className={task.status === 'done' ? 'task-row done' : 'task-row'}>
        <button
          type="button"
          className="task-check-button"
          aria-label={task.status === 'done' ? 'Mark task open' : 'Mark task completed'}
          onClick={() => void toggle(task)}
          disabled={!canWrite}
        >
          <span className="task-check">{task.status === 'done' ? '✓' : ''}</span>
        </button>

        <span className="task-main-copy">
          <span className="task-title">{task.title}</span>
          <small className="task-meta">
            {category && (
              <span><i className="meta-dot" style={{ backgroundColor: categoryColor(category.color_key) }} />{category.name}</span>
            )}
            <span className={overdue ? 'overdue' : ''}>{task.due_date ?? 'No date'}</span>
            {task.location_text && <GoogleMapsLink location={task.location_text} />}
            {task.cost_amount != null && task.cost_amount > 0 && <span>€{Number(task.cost_amount).toFixed(2)}</span>}
            {task.linked_event_id && <span><CalendarDays size={11} />Calendar</span>}
          </small>
        </span>

        <span className="task-participant-stack">
          {taskProfiles.slice(0, 4).map((profile) => profile && (
            <span className="participant-badge" key={profile.id}>
              <ProfileAvatar
                avatarPath={profile.avatar_path}
                name={profile.display_name}
                size="sm"
              />
              <span>{firstName(profile.display_name)}</span>
            </span>
          ))}
        </span>

        <TaskActions
          task={task}
          canWrite={canWrite}
          onEdit={() => openEdit(task)}
          onArchive={() => void archiveTask(task)}
          onDelete={() => void deleteTask(task)}
        />
      </div>
    )
  }

  function TaskSection({
    title: sectionTitle,
    subtitle,
    rows,
    variant = '',
  }: {
    title: string
    subtitle: string
    rows: Task[]
    variant?: string
  }) {
    return (
      <section className={'task-section ' + variant}>
        <header className="task-section-head">
          <div>
            <h2>{sectionTitle}</h2>
            <p>{subtitle}</p>
          </div>
          <span>{rows.length}</span>
        </header>

        {rows.length > 0 ? (
          <div className="task-section-list">
            {rows.map((task) => <TaskRow task={task} key={task.id} />)}
          </div>
        ) : (
          <div className="task-section-empty">No tasks in this section.</div>
        )}
      </section>
    )
  }

  return (
    <div className="page tasks-page">
      <div className="page-heading-row">
        <div>
          <div className="page-label">TASKS</div>
          <h1>Tasks</h1>
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

      {tasks.length === 0 ? (
        <section className="list-card empty-state">
          <span className="empty-state-title">No tasks yet.</span>
          <span>{canWrite ? 'Create the first task.' : 'There are no tasks to show.'}</span>
        </section>
      ) : (
        <div className="task-sections">
          <TaskSection
            title="Next 10 days"
            subtitle="Only tasks due today or within the next 10 days. Past-dated tasks move to Archive automatically."
            rows={taskGroups.near}
          />
          <TaskSection
            title="Later"
            subtitle="Dated tasks more than 10 days in the future."
            rows={taskGroups.later}
          />
          <TaskSection
            title="Without date"
            subtitle="Tasks without a date stay below the divider until a date is added."
            rows={taskGroups.undated}
            variant="undated"
          />
        </div>
      )}

      <div className="archive-repository-bar">
        <Link
          className="secondary-button compact archive-repository-button"
          to="/app/tasks/archive"
        >
          <Archive size={14} />
          Archived tasks
          <span>{archivedCount}</span>
        </Link>
      </div>

      {composerOpen && canWrite && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setComposerOpen(false)
              resetComposer()
            }
          }}
        >
          <form className="modal-card task-composer" onSubmit={saveTask}>
            <header>
              <div>
                <span className="eyebrow">{editingTaskId ? 'EDIT TASK' : 'NEW TASK'}</span>
                <h2>{editingTaskId ? 'Edit task' : 'Create task'}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close task form"
                onClick={() => {
                  setComposerOpen(false)
                  resetComposer()
                }}
              >
                <X size={18} />
              </button>
            </header>

            {!editingTaskId && (
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
            )}

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

            <div className="composer-grid-two aligned-field-row">
              <label>
                Date
                <DatePicker
                  value={dueDate}
                  onChange={setDueDate}
                  format={household.date_format}
                  ariaLabel="Choose task date"
                />
                <small className="field-hint">Optional unless the task is added to Calendar.</small>
              </label>

              <label>
                Location
                <input value={locationText} onChange={(event) => setLocationText(event.target.value)} placeholder="Optional location" />
                {locationText.trim()
                  ? <GoogleMapsLink location={locationText} label="Open in Google Maps" className="field-map-link" />
                  : <small className="field-hint">Optional.</small>}
              </label>
            </div>

            {costsEnabled && (
              <div className="task-cost-field">
                <label>
                  Task cost
                  <div className="money-input">
                    <span>€</span>
                    <input
                      inputMode="decimal"
                      value={costAmount}
                      onChange={(event) => setCostAmount(event.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                  <small className="field-hint">Optional. When this task is completed, the amount is added to Household Costs.</small>
                </label>
              </div>
            )}

            <fieldset className="participant-fieldset">
              <legend>Participants</legend>
              <div className="profile-choice-grid profile-choice-grid-wide">
                {profiles.map((profile) => (
                  <label className="profile-choice profile-choice-plain" key={profile.id}>
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
                    <span className="profile-choice-name">{firstName(profile.display_name)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="composer-option-list">
              <label className="composer-option">
                <input type="checkbox" checked={addToCalendar} onChange={(event) => setAddToCalendar(event.target.checked)} />
                <span>
                  <span>Add this task to Calendar</span>
                  <small>Creates or updates one all-day calendar event on the selected date.</small>
                </span>
              </label>

              {!editingTaskId && (
                <label className="composer-option">
                  <input type="checkbox" checked={saveTemplate} onChange={(event) => setSaveTemplate(event.target.checked)} />
                  <span>
                    <span>Save as task template</span>
                    <small>Reuse this task setup later.</small>
                  </span>
                </label>
              )}
            </div>

            {editingTaskId && projectsWritable && (
              <section className="task-project-connection">
                <div>
                  <span className="eyebrow">PROJECTS & CHORES</span>
                  <strong>Use this Task for household points</strong>
                  <small>The Task stays here as the main item. Projects & Chores receives a linked points-only responsibility.</small>
                </div>
                <div>
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={() => navigate('/app/projects?tab=projects&task=' + editingTaskId + '&kind=project_task')}
                  >
                    <FolderKanban size={14} />
                    Add/Edit as project
                  </button>
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={() => navigate('/app/projects?tab=chores&task=' + editingTaskId + '&kind=chore')}
                  >
                    Add/Edit as chore
                  </button>
                </div>
              </section>
            )}

            {error && <div className="form-message error">{error}</div>}

            <button className="primary-button" disabled={saving}>
              {saving ? 'Saving…' : editingTaskId ? 'Save changes' : 'Create task'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
