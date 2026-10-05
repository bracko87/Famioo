import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FolderKanban,
  MapPin,
  Pencil,
  Plus,
  Trophy,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { DatePicker } from '../components/ui/DatePicker'
import { GoogleMapsLink } from '../components/ui/GoogleMapsLink'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { Select } from '../components/ui/Select'
import { useHousehold } from '../context/HouseholdContext'
import { categoryColor } from '../lib/categoryColors'
import { firstName } from '../lib/personName'
import { supabase } from '../lib/supabase'
import type { EventCategory } from '../lib/types'

type ProjectsTab = 'projects' | 'chores' | 'standing'

type ProjectRow = {
  id: string
  title: string
  description: string | null
  category_id: string | null
  start_date: string | null
  due_date: string | null
  owner_profile_id: string | null
  status: 'active' | 'completed' | 'archived'
  created_at: string
}

type WorkItem = {
  id: string
  project_id: string | null
  item_kind: 'project_task' | 'chore'
  title: string
  category_id: string | null
  due_date: string | null
  location_text: string | null
  assigned_profile_id: string | null
  points: number
  notes: string | null
  sync_task: boolean
  sync_calendar: boolean
  linked_task_id: string | null
  linked_event_id: string | null
  status: 'open' | 'done' | 'archived'
  completed_at: string | null
  completed_by_profile_id: string | null
  created_at: string
}

type PointsRow = {
  id: string
  profile_id: string
  source_work_item_id: string
  points: number
  awarded_at: string
}

function todayKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2,'0')
  const day = String(now.getDate()).padStart(2,'0')
  return year + '-' + month + '-' + day
}

function prettyDate(value: string | null) {
  if (!value) return 'No date'
  return new Date(value + 'T12:00:00').toLocaleDateString()
}

export function ProjectsPage() {
  const { household, modules, profiles } = useHousehold()
  const access = modules.find((module) => module.code === 'projects')
  const canWrite = Boolean(access?.can_write)
  const canSyncTasks = Boolean(modules.find((module) => module.code === 'tasks')?.can_write)
  const canSyncCalendar = Boolean(modules.find((module) => module.code === 'calendar')?.can_write)

  const [tab,setTab] = useState<ProjectsTab>('projects')
  const [projects,setProjects] = useState<ProjectRow[]>([])
  const [items,setItems] = useState<WorkItem[]>([])
  const [points,setPoints] = useState<PointsRow[]>([])
  const [categories,setCategories] = useState<EventCategory[]>([])
  const [error,setError] = useState('')

  const [projectOpen,setProjectOpen] = useState(false)
  const [editingProjectId,setEditingProjectId] = useState<string | null>(null)
  const [projectTitle,setProjectTitle] = useState('')
  const [projectDescription,setProjectDescription] = useState('')
  const [projectCategory,setProjectCategory] = useState('')
  const [projectStart,setProjectStart] = useState('')
  const [projectDue,setProjectDue] = useState('')
  const [projectOwner,setProjectOwner] = useState('')

  const [itemOpen,setItemOpen] = useState(false)
  const [editingItemId,setEditingItemId] = useState<string | null>(null)
  const [itemKind,setItemKind] = useState<'project_task' | 'chore'>('chore')
  const [itemProject,setItemProject] = useState('')
  const [itemTitle,setItemTitle] = useState('')
  const [itemCategory,setItemCategory] = useState('')
  const [itemDue,setItemDue] = useState('')
  const [itemLocation,setItemLocation] = useState('')
  const [itemAssignee,setItemAssignee] = useState('')
  const [itemPoints,setItemPoints] = useState('5')
  const [itemNotes,setItemNotes] = useState('')
  const [itemSyncTask,setItemSyncTask] = useState(true)
  const [itemSyncCalendar,setItemSyncCalendar] = useState(false)
  const [saving,setSaving] = useState(false)

  async function load() {
    setError('')

    const [projectResult,itemResult,pointsResult,categoryResult] = await Promise.all([
      supabase
        .from('household_projects')
        .select('id,title,description,category_id,start_date,due_date,owner_profile_id,status,created_at')
        .eq('household_id',household.id)
        .neq('status','archived')
        .order('created_at',{ ascending:false }),
      supabase
        .from('project_work_items')
        .select('id,project_id,item_kind,title,category_id,due_date,location_text,assigned_profile_id,points,notes,sync_task,sync_calendar,linked_task_id,linked_event_id,status,completed_at,completed_by_profile_id,created_at')
        .eq('household_id',household.id)
        .neq('status','archived')
        .order('status')
        .order('due_date',{ ascending:true, nullsFirst:false })
        .order('created_at',{ ascending:false }),
      supabase
        .from('family_points_ledger')
        .select('id,profile_id,source_work_item_id,points,awarded_at')
        .eq('household_id',household.id)
        .order('awarded_at',{ ascending:false }),
      supabase
        .from('event_categories')
        .select('id,name,color_key')
        .eq('household_id',household.id)
        .eq('active',true)
        .order('sort_order')
        .order('name'),
    ])

    if (projectResult.error) setError(projectResult.error.message)
    else setProjects((projectResult.data ?? []) as ProjectRow[])

    if (itemResult.error) setError((current) => current || itemResult.error.message)
    else setItems((itemResult.data ?? []) as WorkItem[])

    if (pointsResult.error) setError((current) => current || pointsResult.error.message)
    else setPoints((pointsResult.data ?? []) as PointsRow[])

    if (categoryResult.error) setError((current) => current || categoryResult.error.message)
    else setCategories((categoryResult.data ?? []) as EventCategory[])
  }

  useEffect(() => { void load() }, [household.id])

  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id,profile])),
    [profiles],
  )

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id,category])),
    [categories],
  )

  const profileOptions = useMemo(
    () => [
      { value:'',label:'No person assigned' },
      ...profiles.map((profile) => ({ value:profile.id,label:firstName(profile.display_name) })),
    ],
    [profiles],
  )

  const categoryOptions = useMemo(
    () => categories.map((category) => ({
      value:category.id,
      label:category.name,
      dotColor:categoryColor(category.color_key),
    })),
    [categories],
  )

  const projectOptions = useMemo(
    () => [
      { value:'',label:'No project / standalone chore' },
      ...projects
        .filter((project) => project.status === 'active')
        .map((project) => ({ value:project.id,label:project.title })),
    ],
    [projects],
  )

  const openProjectItems = useMemo(
    () => items.filter((item) => item.item_kind === 'project_task'),
    [items],
  )

  const chores = useMemo(
    () => items.filter((item) => item.item_kind === 'chore'),
    [items],
  )

  const standing = useMemo(() => {
    const monthKey = todayKey().slice(0,7)

    return profiles
      .map((profile) => {
        const profilePoints = points.filter((row) => row.profile_id === profile.id)
        return {
          profile,
          month:profilePoints
            .filter((row) => row.awarded_at.slice(0,7) === monthKey)
            .reduce((sum,row) => sum + Number(row.points),0),
          total:profilePoints.reduce((sum,row) => sum + Number(row.points),0),
        }
      })
      .sort((a,b) => b.month - a.month || b.total - a.total || a.profile.display_name.localeCompare(b.profile.display_name))
  }, [profiles,points])

  function resetProject() {
    setEditingProjectId(null)
    setProjectTitle('')
    setProjectDescription('')
    setProjectCategory(categories[0]?.id ?? '')
    setProjectStart('')
    setProjectDue('')
    setProjectOwner('')
    setError('')
  }

  function openProject(project?: ProjectRow) {
    resetProject()
    if (project) {
      setEditingProjectId(project.id)
      setProjectTitle(project.title)
      setProjectDescription(project.description ?? '')
      setProjectCategory(project.category_id ?? categories[0]?.id ?? '')
      setProjectStart(project.start_date ?? '')
      setProjectDue(project.due_date ?? '')
      setProjectOwner(project.owner_profile_id ?? '')
    }
    setProjectOpen(true)
  }

  async function saveProject(event: FormEvent) {
    event.preventDefault()
    if (!canWrite || !projectTitle.trim()) return

    setSaving(true)
    setError('')

    const result = await supabase.rpc('save_household_project_v1',{
      p_id:editingProjectId,
      p_household_id:household.id,
      p_title:projectTitle.trim(),
      p_description:projectDescription.trim() || null,
      p_category_id:projectCategory || null,
      p_start_date:projectStart || null,
      p_due_date:projectDue || null,
      p_owner_profile_id:projectOwner || null,
    })

    setSaving(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    setProjectOpen(false)
    resetProject()
    await load()
  }

  function resetItem(kind: 'project_task' | 'chore' = 'chore',projectId = '') {
    setEditingItemId(null)
    setItemKind(kind)
    setItemProject(projectId)
    setItemTitle('')
    setItemCategory(categories[0]?.id ?? '')
    setItemDue('')
    setItemLocation('')
    setItemAssignee('')
    setItemPoints('5')
    setItemNotes('')
    setItemSyncTask(canSyncTasks)
    setItemSyncCalendar(false)
    setError('')
  }

  function openItem(kind: 'project_task' | 'chore' = 'chore',projectId = '',item?: WorkItem) {
    resetItem(kind,projectId)
    if (item) {
      setEditingItemId(item.id)
      setItemKind(item.item_kind)
      setItemProject(item.project_id ?? '')
      setItemTitle(item.title)
      setItemCategory(item.category_id ?? categories[0]?.id ?? '')
      setItemDue(item.due_date ?? '')
      setItemLocation(item.location_text ?? '')
      setItemAssignee(item.assigned_profile_id ?? '')
      setItemPoints(String(item.points ?? 0))
      setItemNotes(item.notes ?? '')
      setItemSyncTask(item.sync_task)
      setItemSyncCalendar(item.sync_calendar)
    }
    setItemOpen(true)
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault()
    if (!canWrite || !itemTitle.trim() || !itemCategory) return

    const numericPoints = Number(itemPoints || '0')
    if (!Number.isInteger(numericPoints) || numericPoints < 0 || numericPoints > 10000) {
      setError('Points must be a whole number between 0 and 10000.')
      return
    }

    setSaving(true)
    setError('')

    const result = await supabase.rpc('save_project_work_item_v1',{
      p_id:editingItemId,
      p_household_id:household.id,
      p_project_id:itemKind === 'project_task' ? (itemProject || null) : null,
      p_item_kind:itemKind,
      p_title:itemTitle.trim(),
      p_category_id:itemCategory,
      p_due_date:itemDue || null,
      p_location_text:itemLocation.trim() || null,
      p_assigned_profile_id:itemAssignee || null,
      p_points:numericPoints,
      p_notes:itemNotes.trim() || null,
      p_sync_task:itemSyncTask,
      p_sync_calendar:itemSyncCalendar,
    })

    setSaving(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    setItemOpen(false)
    resetItem()
    await load()
  }

  async function toggleDone(item: WorkItem) {
    if (!canWrite) return
    setError('')

    const result = await supabase.rpc('set_project_work_item_done_v1',{
      p_id:item.id,
      p_household_id:household.id,
      p_done:item.status !== 'done',
    })

    if (result.error) {
      setError(result.error.message)
      return
    }

    await load()
  }

  function renderWorkItem(item: WorkItem) {
    const profile = item.assigned_profile_id ? profileById.get(item.assigned_profile_id) : undefined
    const category = item.category_id ? categoryById.get(item.category_id) : undefined

    return (
      <article className={'project-work-row list-card ' + (item.status === 'done' ? 'done' : '')} key={item.id}>
        <button
          type="button"
          className={'project-work-check ' + (item.status === 'done' ? 'done' : '')}
          onClick={() => void toggleDone(item)}
          disabled={!canWrite}
          aria-label={item.status === 'done' ? 'Reopen responsibility' : 'Complete responsibility'}
        >
          {item.status === 'done' && <CheckCircle2 size={17} />}
        </button>

        <div className="project-work-main">
          <div className="project-work-title">
            <span>{item.title}</span>
            {item.points > 0 && <small className="points-chip">+{item.points} pts</small>}
          </div>

          <div className="project-work-meta">
            {category && <span><i style={{ backgroundColor:categoryColor(category.color_key) }} />{category.name}</span>}
            <span><CalendarDays size={11} />{prettyDate(item.due_date)}</span>
            {item.location_text && <span><MapPin size={11} />{item.location_text}</span>}
            {item.linked_task_id && <span><ClipboardCheck size={11} />Tasks</span>}
            {item.linked_event_id && <span><CalendarDays size={11} />Calendar</span>}
          </div>

          {profile && (
            <div className="project-work-person">
              <ProfileAvatar avatarPath={profile.avatar_path} name={profile.display_name} size="sm" />
              <span>{firstName(profile.display_name)}</span>
            </div>
          )}

          {item.location_text && <GoogleMapsLink location={item.location_text} label="Open in Google Maps" className="field-map-link" />}
          {item.notes && <p>{item.notes}</p>}
        </div>

        {canWrite && item.status !== 'done' && (
          <button type="button" className="icon-button compact-icon" aria-label={'Edit ' + item.title} onClick={() => openItem(item.item_kind,item.project_id ?? '',item)}>
            <Pencil size={14} />
          </button>
        )}
      </article>
    )
  }

  return (
    <div className="page projects-page">
      <div className="page-heading-row projects-heading">
        <div>
          <div className="page-label">PROJECTS & CHORES</div>
          <h1>Projects, chores & points</h1>
          <p className="page-subtitle">Plan household projects, assign responsibilities and make completed work visible with simple family points.</p>
        </div>

        {canWrite && (
          <div className="projects-heading-actions">
            <button type="button" className="secondary-button compact" onClick={() => openProject()}>
              <Plus size={15} />
              Project
            </button>
            <button type="button" className="primary-button compact" onClick={() => openItem(tab === 'projects' ? 'project_task' : 'chore')}>
              <Plus size={15} />
              Responsibility
            </button>
          </div>
        )}
      </div>

      <nav className="projects-tabs" aria-label="Projects and chores sections">
        <button type="button" className={tab === 'projects' ? 'active' : ''} onClick={() => setTab('projects')}>Projects</button>
        <button type="button" className={tab === 'chores' ? 'active' : ''} onClick={() => setTab('chores')}>Chores</button>
        <button type="button" className={tab === 'standing' ? 'active' : ''} onClick={() => setTab('standing')}>Family standing</button>
      </nav>

      {!access?.enabled && <div className="module-access-note">Projects & Chores is not enabled for this household.</div>}
      {access?.enabled && !canWrite && <div className="module-access-note">Read-only access</div>}
      {error && !projectOpen && !itemOpen && <div className="notice error">{error}</div>}

      {tab === 'projects' && (
        <section className="projects-layout">
          {projects.filter((project) => project.status === 'active').length === 0 ? (
            <div className="list-card empty-state projects-empty">
              <FolderKanban size={25} />
              <span className="empty-state-title">No household projects yet.</span>
              <span>Create a project, then add responsibilities with dates, Tasks, Calendar links and points.</span>
            </div>
          ) : projects.filter((project) => project.status === 'active').map((project) => {
            const owner = project.owner_profile_id ? profileById.get(project.owner_profile_id) : undefined
            const projectItems = openProjectItems.filter((item) => item.project_id === project.id)
            const done = projectItems.filter((item) => item.status === 'done').length

            return (
              <article className="project-card list-card" key={project.id}>
                <header>
                  <div>
                    <span className="eyebrow">HOUSEHOLD PROJECT</span>
                    <h2>{project.title}</h2>
                    <div className="project-card-meta">
                      {project.due_date && <span><CalendarDays size={11} />Due {prettyDate(project.due_date)}</span>}
                      {owner && <span className="project-owner"><ProfileAvatar avatarPath={owner.avatar_path} name={owner.display_name} size="sm" />{firstName(owner.display_name)}</span>}
                      <span>{done}/{projectItems.length} done</span>
                    </div>
                  </div>

                  {canWrite && (
                    <div className="project-card-actions">
                      <button type="button" className="icon-button compact-icon" aria-label={'Edit ' + project.title} onClick={() => openProject(project)}><Pencil size={14} /></button>
                      <button type="button" className="secondary-button compact" onClick={() => openItem('project_task',project.id)}><Plus size={14} />Task</button>
                    </div>
                  )}
                </header>

                {project.description && <p>{project.description}</p>}

                <div className="project-card-work">
                  {projectItems.length
                    ? projectItems.map(renderWorkItem)
                    : <div className="project-card-empty">No responsibilities in this project yet.</div>}
                </div>
              </article>
            )
          })}

          {openProjectItems.filter((item) => !item.project_id).length > 0 && (
            <article className="project-card list-card">
              <header><div><span className="eyebrow">UNASSIGNED</span><h2>Project tasks without a project</h2></div></header>
              <div className="project-card-work">
                {openProjectItems.filter((item) => !item.project_id).map(renderWorkItem)}
              </div>
            </article>
          )}
        </section>
      )}

      {tab === 'chores' && (
        <section className="chores-section">
          <div className="projects-section-head">
            <div><span className="eyebrow">RESPONSIBILITIES</span><h2>Household chores</h2></div>
            {canWrite && <button type="button" className="primary-button compact" onClick={() => openItem('chore')}><Plus size={15} />Add chore</button>}
          </div>

          {chores.length
            ? <div className="chores-list">{chores.map(renderWorkItem)}</div>
            : <div className="list-card empty-state projects-empty"><ClipboardCheck size={24} /><span className="empty-state-title">No chores yet.</span><span>Add recurring household responsibilities here as individual Tasks for now.</span></div>}
        </section>
      )}

      {tab === 'standing' && (
        <section className="family-standing-card list-card">
          <header>
            <div><span className="eyebrow">FAMILY STANDING</span><h2>This month</h2><p>Points are awarded when a Projects & Chores responsibility is completed.</p></div>
            <Trophy size={23} />
          </header>

          <div className="family-standing-list">
            {standing.map((row,index) => (
              <div className="family-standing-row" key={row.profile.id}>
                <span className="family-rank">{index + 1}</span>
                <ProfileAvatar avatarPath={row.profile.avatar_path} name={row.profile.display_name} size="sm" />
                <span className="family-standing-name">{firstName(row.profile.display_name)}</span>
                <span className="family-standing-total"><strong>{row.month}</strong><small>pts this month</small></span>
                <span className="family-standing-all"><strong>{row.total}</strong><small>all time</small></span>
              </div>
            ))}
          </div>
        </section>
      )}

      {projectOpen && canWrite && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) { setProjectOpen(false); resetProject() }
        }}>
          <form className="modal-card projects-composer" onSubmit={saveProject}>
            <header>
              <div><span className="eyebrow">{editingProjectId ? 'EDIT PROJECT' : 'NEW PROJECT'}</span><h2>{editingProjectId ? 'Edit project' : 'Create project'}</h2></div>
              <button type="button" className="icon-button" onClick={() => { setProjectOpen(false); resetProject() }} aria-label="Close project form"><X size={18} /></button>
            </header>

            <div className="composer-grid-two aligned-field-row">
              <label>Project name<input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="e.g. Renovate kids room" autoFocus required /></label>
              <label>Category<Select value={projectCategory} onChange={setProjectCategory} options={categoryOptions} ariaLabel="Choose project category" /></label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>Start date<DatePicker value={projectStart} onChange={setProjectStart} format={household.date_format} ariaLabel="Choose project start date" /></label>
              <label>Due date<DatePicker value={projectDue} onChange={setProjectDue} format={household.date_format} ariaLabel="Choose project due date" /></label>
            </div>

            <label>Project owner<Select value={projectOwner} onChange={setProjectOwner} options={profileOptions} ariaLabel="Choose project owner" /></label>
            <label>Description<textarea value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} rows={4} placeholder="Optional project notes" /></label>

            {error && <div className="form-message error">{error}</div>}
            <button className="primary-button" disabled={saving}>{saving ? 'Saving…' : editingProjectId ? 'Save changes' : 'Create project'}</button>
          </form>
        </div>
      )}

      {itemOpen && canWrite && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) { setItemOpen(false); resetItem() }
        }}>
          <form className="modal-card projects-composer" onSubmit={saveItem}>
            <header>
              <div><span className="eyebrow">{editingItemId ? 'EDIT RESPONSIBILITY' : 'NEW RESPONSIBILITY'}</span><h2>{editingItemId ? 'Edit responsibility' : itemKind === 'chore' ? 'Add chore' : 'Add project task'}</h2></div>
              <button type="button" className="icon-button" onClick={() => { setItemOpen(false); resetItem() }} aria-label="Close responsibility form"><X size={18} /></button>
            </header>

            <div className="composer-grid-two aligned-field-row">
              <label>Type<Select value={itemKind} onChange={(value) => setItemKind(value as 'project_task' | 'chore')} options={[{ value:'project_task',label:'Project task' },{ value:'chore',label:'Chore / responsibility' }]} ariaLabel="Choose responsibility type" /></label>
              <label>Name<input value={itemTitle} onChange={(event) => setItemTitle(event.target.value)} placeholder="e.g. Paint the wall" autoFocus required /></label>
            </div>

            {itemKind === 'project_task' && (
              <label>Project<Select value={itemProject} onChange={setItemProject} options={projectOptions} ariaLabel="Choose project" /></label>
            )}

            <div className="composer-grid-two aligned-field-row">
              <label>Category<Select value={itemCategory} onChange={setItemCategory} options={categoryOptions} ariaLabel="Choose category" /></label>
              <label>Assigned to<Select value={itemAssignee} onChange={setItemAssignee} options={profileOptions} ariaLabel="Choose household member" /></label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>Due date<DatePicker value={itemDue} onChange={setItemDue} format={household.date_format} ariaLabel="Choose due date" /></label>
              <label>Points<input type="number" min="0" max="10000" step="1" value={itemPoints} onChange={(event) => setItemPoints(event.target.value)} /></label>
            </div>

            <label>
              Location
              <input value={itemLocation} onChange={(event) => setItemLocation(event.target.value)} placeholder="Optional location" />
              {itemLocation.trim() && <GoogleMapsLink location={itemLocation} label="Open in Google Maps" className="field-map-link" />}
            </label>

            <label>Notes<textarea value={itemNotes} onChange={(event) => setItemNotes(event.target.value)} rows={3} placeholder="Optional notes" /></label>

            <div className="composer-option-list">
              <label className="composer-option">
                <input type="checkbox" checked={itemSyncTask} disabled={!canSyncTasks} onChange={(event) => setItemSyncTask(event.target.checked)} />
                <span><span>Show in Tasks</span><small>{canSyncTasks ? 'Creates or updates one linked household Task.' : 'Tasks write access is required.'}</small></span>
              </label>
              <label className="composer-option">
                <input type="checkbox" checked={itemSyncCalendar} disabled={!canSyncCalendar} onChange={(event) => setItemSyncCalendar(event.target.checked)} />
                <span><span>Add to Calendar</span><small>{canSyncCalendar ? 'A due date is required. If Tasks is also selected, the same Task owns the Calendar entry.' : 'Calendar write access is required.'}</small></span>
              </label>
            </div>

            {error && <div className="form-message error">{error}</div>}
            <button className="primary-button" disabled={saving}>{saving ? 'Saving…' : editingItemId ? 'Save changes' : 'Create responsibility'}</button>
          </form>
        </div>
      )}
    </div>
  )
}
