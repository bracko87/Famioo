import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FolderKanban,
  MapPin,
  Pencil,
  Plus,
  Trophy,
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
type ItemSource = 'new' | 'task' | 'template'
type DurationScore = 'under_15' | '15_30' | '30_45' | '45_60' | '1_2h' | '2_3h' | '3_5h' | 'over_5h'
type EffortScore = 'very_low' | 'low' | 'medium' | 'high' | 'very_high' | 'extreme'
type ExecutionScore = 'automated' | 'assisted' | 'mixed' | 'manual'
type ResponsibilityScore = 'routine' | 'normal' | 'important' | 'high'

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
  task_link_origin: 'created' | 'imported' | null
  score_duration: DurationScore
  score_effort: EffortScore
  score_execution: ExecutionScore
  score_responsibility: ResponsibilityScore
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

type TaskRow = {
  id: string
  title: string
  category_id: string | null
  due_date: string | null
  location_text: string | null
  assigned_profile_id: string | null
  linked_event_id: string | null
  status: 'open' | 'done' | 'archived'
}

type ProjectTemplate = {
  id: string
  name: string
  item_kind: 'project_task' | 'chore'
  title: string
  category_id: string | null
  location_text: string | null
  default_assigned_profile_id: string | null
  notes: string | null
  score_duration: DurationScore
  score_effort: EffortScore
  score_execution: ExecutionScore
  score_responsibility: ResponsibilityScore
}

const durationOptions = [
  { value:'under_15',label:'Less than 15 minutes',points:1 },
  { value:'15_30',label:'15–30 minutes',points:2 },
  { value:'30_45',label:'30–45 minutes',points:3 },
  { value:'45_60',label:'45–60 minutes',points:4 },
  { value:'1_2h',label:'1–2 hours',points:6 },
  { value:'2_3h',label:'2–3 hours',points:8 },
  { value:'3_5h',label:'3–5 hours',points:11 },
  { value:'over_5h',label:'More than 5 hours',points:15 },
] as const

const effortOptions = [
  { value:'very_low',label:'Very low effort',points:0 },
  { value:'low',label:'Low effort',points:1 },
  { value:'medium',label:'Moderate effort',points:3 },
  { value:'high',label:'High effort',points:5 },
  { value:'very_high',label:'Very high effort',points:8 },
  { value:'extreme',label:'Exceptional effort',points:11 },
] as const

const executionOptions = [
  { value:'automated',label:'Mostly automated',points:0 },
  { value:'assisted',label:'Tool / machine assisted',points:1 },
  { value:'mixed',label:'Mixed manual & automated',points:3 },
  { value:'manual',label:'Fully manual',points:5 },
] as const

const responsibilityOptions = [
  { value:'routine',label:'Routine responsibility',points:0 },
  { value:'normal',label:'Normal responsibility',points:2 },
  { value:'important',label:'Important responsibility',points:4 },
  { value:'high',label:'High responsibility / consequence',points:7 },
] as const

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

function calculatePoints(
  duration: DurationScore,
  effort: EffortScore,
  execution: ExecutionScore,
  responsibility: ResponsibilityScore,
) {
  const value =
    (durationOptions.find((item) => item.value === duration)?.points ?? 0)
    + (effortOptions.find((item) => item.value === effort)?.points ?? 0)
    + (executionOptions.find((item) => item.value === execution)?.points ?? 0)
    + (responsibilityOptions.find((item) => item.value === responsibility)?.points ?? 0)

  return Math.max(1,value)
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
  const [tasks,setTasks] = useState<TaskRow[]>([])
  const [templates,setTemplates] = useState<ProjectTemplate[]>([])
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
  const [itemSource,setItemSource] = useState<ItemSource>('new')
  const [existingTaskId,setExistingTaskId] = useState('')
  const [itemTemplateId,setItemTemplateId] = useState('')
  const [itemKind,setItemKind] = useState<'project_task' | 'chore'>('chore')
  const [itemProject,setItemProject] = useState('')
  const [itemTitle,setItemTitle] = useState('')
  const [itemCategory,setItemCategory] = useState('')
  const [itemDue,setItemDue] = useState('')
  const [itemLocation,setItemLocation] = useState('')
  const [itemAssignee,setItemAssignee] = useState('')
  const [itemNotes,setItemNotes] = useState('')
  const [itemSyncTask,setItemSyncTask] = useState(true)
  const [itemSyncCalendar,setItemSyncCalendar] = useState(false)
  const [scoreDuration,setScoreDuration] = useState<DurationScore>('15_30')
  const [scoreEffort,setScoreEffort] = useState<EffortScore>('medium')
  const [scoreExecution,setScoreExecution] = useState<ExecutionScore>('manual')
  const [scoreResponsibility,setScoreResponsibility] = useState<ResponsibilityScore>('normal')
  const [saveAsTemplate,setSaveAsTemplate] = useState(false)
  const [saving,setSaving] = useState(false)

  async function load() {
    setError('')

    if (canWrite) {
      const cleanupResult = await supabase.rpc('archive_expired_project_work_items_v1', {
        p_household_id: household.id,
      })

      if (cleanupResult.error) {
        setError(cleanupResult.error.message)
      }
    }

    const [projectResult,itemResult,pointsResult,categoryResult,availabilityResult,taskResult,templateResult] = await Promise.all([
      supabase
        .from('household_projects')
        .select('id,title,description,category_id,start_date,due_date,owner_profile_id,status,created_at')
        .eq('household_id',household.id)
        .neq('status','archived')
        .order('created_at',{ ascending:false }),
      supabase
        .from('project_work_items')
        .select('id,project_id,item_kind,title,category_id,due_date,location_text,assigned_profile_id,points,notes,sync_task,sync_calendar,linked_task_id,linked_event_id,task_link_origin,score_duration,score_effort,score_execution,score_responsibility,status,completed_at,completed_by_profile_id,created_at')
        .eq('household_id',household.id)
        .neq('status','archived')
        .order('due_date',{ ascending:true, nullsFirst:false })
        .order('created_at',{ ascending:true }),
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
      supabase
        .from('module_category_availability')
        .select('category_id,enabled')
        .eq('household_id',household.id)
        .eq('module_code','projects'),
      supabase
        .from('tasks')
        .select('id,title,category_id,due_date,location_text,assigned_profile_id,linked_event_id,status')
        .eq('household_id',household.id)
        .eq('status','open')
        .is('archived_at',null)
        .order('due_date',{ ascending:true, nullsFirst:false })
        .order('created_at',{ ascending:false }),
      supabase
        .from('project_work_templates')
        .select('id,name,item_kind,title,category_id,location_text,default_assigned_profile_id,notes,score_duration,score_effort,score_execution,score_responsibility')
        .eq('household_id',household.id)
        .eq('active',true)
        .order('name'),
    ])

    if (projectResult.error) setError(projectResult.error.message)
    else setProjects((projectResult.data ?? []) as ProjectRow[])

    const loadedItems = itemResult.error ? [] : (itemResult.data ?? []) as WorkItem[]
    if (itemResult.error) setError((current) => current || itemResult.error.message)
    else setItems(loadedItems)

    if (pointsResult.error) setError((current) => current || pointsResult.error.message)
    else setPoints((pointsResult.data ?? []) as PointsRow[])

    if (categoryResult.error) {
      setError((current) => current || categoryResult.error.message)
    } else if (availabilityResult.error) {
      setError((current) => current || availabilityResult.error.message)
      setCategories((categoryResult.data ?? []) as EventCategory[])
    } else {
      const enabledById = new Map((availabilityResult.data ?? []).map((row) => [row.category_id,row.enabled]))
      setCategories(((categoryResult.data ?? []) as EventCategory[]).filter((category) => enabledById.get(category.id) ?? true))
    }

    if (taskResult.error) setError((current) => current || taskResult.error.message)
    else setTasks((taskResult.data ?? []) as TaskRow[])

    if (templateResult.error) setError((current) => current || templateResult.error.message)
    else setTemplates((templateResult.data ?? []) as ProjectTemplate[])
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

  const existingTaskOptions = useMemo(() => {
    const alreadyLinked = new Set(items.filter((item) => item.status !== 'archived').map((item) => item.linked_task_id).filter(Boolean))
    return tasks
      .filter((task) => !alreadyLinked.has(task.id) && Boolean(task.category_id && categoryById.has(task.category_id)))
      .map((task) => ({
        value:task.id,
        label:task.title + (task.due_date ? ' · ' + prettyDate(task.due_date) : ' · no date'),
        dotColor:task.category_id ? categoryColor(categoryById.get(task.category_id)?.color_key ?? 'slate') : undefined,
      }))
  }, [tasks,items,categoryById])

  const templateOptions = useMemo(
    () => templates
      .filter((template) => !template.category_id || categoryById.has(template.category_id))
      .map((template) => ({ value:template.id,label:template.name })),
    [templates,categoryById],
  )

  const currentItems = useMemo(() => {
    const today = todayKey()

    return items
      .filter((item) => !item.due_date || item.due_date >= today)
      .sort((a,b) => {
        if (a.due_date && b.due_date) {
          return a.due_date.localeCompare(b.due_date) || a.created_at.localeCompare(b.created_at)
        }
        if (a.due_date) return -1
        if (b.due_date) return 1
        return a.created_at.localeCompare(b.created_at)
      })
  }, [items])

  const openProjectItems = useMemo(
    () => currentItems.filter((item) => item.item_kind === 'project_task'),
    [currentItems],
  )

  const chores = useMemo(
    () => currentItems.filter((item) => item.item_kind === 'chore'),
    [currentItems],
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

  const calculatedPoints = useMemo(
    () => calculatePoints(scoreDuration,scoreEffort,scoreExecution,scoreResponsibility),
    [scoreDuration,scoreEffort,scoreExecution,scoreResponsibility],
  )

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
    setItemSource('new')
    setExistingTaskId('')
    setItemTemplateId('')
    setItemKind(kind)
    setItemProject(projectId)
    setItemTitle('')
    setItemCategory(categories[0]?.id ?? '')
    setItemDue('')
    setItemLocation('')
    setItemAssignee('')
    setItemNotes('')
    setItemSyncTask(canSyncTasks)
    setItemSyncCalendar(false)
    setScoreDuration('15_30')
    setScoreEffort('medium')
    setScoreExecution('manual')
    setScoreResponsibility('normal')
    setSaveAsTemplate(false)
    setError('')
  }

  function applyExistingTask(taskId: string) {
    setExistingTaskId(taskId)
    const task = tasks.find((item) => item.id === taskId)
    if (!task) return

    setItemTitle(task.title)
    setItemCategory(task.category_id ?? categories[0]?.id ?? '')
    setItemDue(task.due_date ?? '')
    setItemLocation(task.location_text ?? '')
    setItemAssignee(task.assigned_profile_id ?? '')
    setItemSyncTask(true)
    setItemSyncCalendar(Boolean(task.linked_event_id))
  }

  function applyTemplate(templateId: string) {
    setItemTemplateId(templateId)
    const template = templates.find((item) => item.id === templateId)
    if (!template) return

    setItemKind(template.item_kind)
    setItemTitle(template.title)
    setItemCategory(template.category_id ?? categories[0]?.id ?? '')
    setItemLocation(template.location_text ?? '')
    setItemAssignee(template.default_assigned_profile_id ?? '')
    setItemNotes(template.notes ?? '')
    setScoreDuration(template.score_duration)
    setScoreEffort(template.score_effort)
    setScoreExecution(template.score_execution)
    setScoreResponsibility(template.score_responsibility)
  }

  function openItem(kind: 'project_task' | 'chore' = 'chore',projectId = '',item?: WorkItem) {
    resetItem(kind,projectId)
    if (item) {
      setEditingItemId(item.id)
      setItemSource('new')
      setItemKind(item.item_kind)
      setItemProject(item.project_id ?? '')
      setItemTitle(item.title)
      setItemCategory(item.category_id ?? categories[0]?.id ?? '')
      setItemDue(item.due_date ?? '')
      setItemLocation(item.location_text ?? '')
      setItemAssignee(item.assigned_profile_id ?? '')
      setItemNotes(item.notes ?? '')
      setItemSyncTask(item.sync_task)
      setItemSyncCalendar(item.sync_calendar)
      setScoreDuration(item.score_duration ?? '15_30')
      setScoreEffort(item.score_effort ?? 'medium')
      setScoreExecution(item.score_execution ?? 'manual')
      setScoreResponsibility(item.score_responsibility ?? 'normal')
    }
    setItemOpen(true)
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault()
    const importedTask = itemSource === 'task' && !editingItemId
    if (!canWrite) return
    if (importedTask && !existingTaskId) return
    if (!importedTask && (!itemTitle.trim() || !itemCategory)) return

    setSaving(true)
    setError('')

    const result = await supabase.rpc('save_project_work_item_v2',{
      p_id:editingItemId,
      p_household_id:household.id,
      p_project_id:itemKind === 'project_task' ? (itemProject || null) : null,
      p_item_kind:itemKind,
      p_title:itemTitle.trim() || 'Imported Task',
      p_category_id:itemCategory || null,
      p_due_date:itemDue || null,
      p_location_text:itemLocation.trim() || null,
      p_assigned_profile_id:itemAssignee || null,
      p_notes:itemNotes.trim() || null,
      p_sync_task:importedTask ? true : itemSyncTask,
      p_sync_calendar:itemSyncCalendar,
      p_score_duration:scoreDuration,
      p_score_effort:scoreEffort,
      p_score_execution:scoreExecution,
      p_score_responsibility:scoreResponsibility,
      p_existing_task_id:importedTask ? existingTaskId : null,
    })

    if (result.error) {
      setSaving(false)
      setError(result.error.message)
      return
    }

    if (saveAsTemplate && itemTitle.trim()) {
      const templateResult = await supabase
        .from('project_work_templates')
        .insert({
          household_id:household.id,
          name:itemTitle.trim(),
          item_kind:itemKind,
          title:itemTitle.trim(),
          category_id:itemCategory || null,
          location_text:itemLocation.trim() || null,
          default_assigned_profile_id:itemAssignee || null,
          notes:itemNotes.trim() || null,
          score_duration:scoreDuration,
          score_effort:scoreEffort,
          score_execution:scoreExecution,
          score_responsibility:scoreResponsibility,
        })

      if (templateResult.error) {
        setSaving(false)
        setError('Responsibility was saved, but its template could not be saved: ' + templateResult.error.message)
        await load()
        return
      }
    }

    setSaving(false)
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
            {item.linked_task_id && <span><ClipboardCheck size={11} />{item.task_link_origin === 'imported' ? 'Imported Task' : 'Tasks'}</span>}
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

  const importedEdit = Boolean(editingItemId && items.find((item) => item.id === editingItemId)?.task_link_origin === 'imported')
  const sourceFieldsLocked = itemSource === 'task' && !editingItemId

  return (
    <div className="page projects-page">
      <div className="page-heading-row projects-heading">
        <div>
          <div className="page-label">PROJECTS & CHORES</div>
          <h1>Projects, chores & points</h1>
          <p className="page-subtitle">Plan household projects, import existing Tasks, assign responsibilities and award points only for work that belongs to this module.</p>
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
              <span>Create a project, then add or import responsibilities with Tasks, Calendar links and calculated points.</span>
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
            : <div className="list-card empty-state projects-empty"><ClipboardCheck size={24} /><span className="empty-state-title">No chores yet.</span><span>Add a new responsibility or import one of your existing Tasks.</span></div>}
        </section>
      )}

      {tab === 'standing' && (
        <section className="family-standing-card list-card">
          <header>
            <div><span className="eyebrow">FAMILY STANDING</span><h2>This month</h2><p>Only completed responsibilities inside Projects & Chores award points.</p></div>
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
          <form className="modal-card projects-composer project-responsibility-composer" onSubmit={saveItem}>
            <header>
              <div><span className="eyebrow">{editingItemId ? 'EDIT RESPONSIBILITY' : 'NEW RESPONSIBILITY'}</span><h2>{editingItemId ? 'Edit responsibility' : itemKind === 'chore' ? 'Add chore' : 'Add project task'}</h2></div>
              <button type="button" className="icon-button" onClick={() => { setItemOpen(false); resetItem() }} aria-label="Close responsibility form"><X size={18} /></button>
            </header>

            {!editingItemId && (
              <div className="composer-grid-two aligned-field-row">
                <label>Start from
                  <Select
                    value={itemSource}
                    onChange={(value) => {
                      const source=value as ItemSource
                      setItemSource(source)
                      setExistingTaskId('')
                      setItemTemplateId('')
                      if (source === 'new') resetItem(itemKind,itemProject)
                    }}
                    options={[
                      { value:'new',label:'New responsibility' },
                      { value:'task',label:'Import existing Task' },
                      { value:'template',label:'Projects & Chores template' },
                    ]}
                    ariaLabel="Choose how to create responsibility"
                  />
                </label>

                {itemSource === 'task' ? (
                  <label>Existing Task
                    <Select value={existingTaskId} onChange={applyExistingTask} options={existingTaskOptions} placeholder="Choose Task…" ariaLabel="Choose existing Task" />
                  </label>
                ) : itemSource === 'template' ? (
                  <label>Template
                    <Select value={itemTemplateId} onChange={applyTemplate} options={templateOptions} placeholder="Choose template…" ariaLabel="Choose Projects and Chores template" />
                  </label>
                ) : <div />}
              </div>
            )}

            <div className="composer-grid-two aligned-field-row">
              <label>Type<Select value={itemKind} onChange={(value) => setItemKind(value as 'project_task' | 'chore')} options={[{ value:'project_task',label:'Project task' },{ value:'chore',label:'Chore / responsibility' }]} ariaLabel="Choose responsibility type" /></label>
              <label>Name<input value={itemTitle} onChange={(event) => setItemTitle(event.target.value)} placeholder="e.g. Paint the wall" autoFocus={!editingItemId} required disabled={sourceFieldsLocked} /></label>
            </div>

            {itemKind === 'project_task' && (
              <label>Project<Select value={itemProject} onChange={setItemProject} options={projectOptions} ariaLabel="Choose project" /></label>
            )}

            <div className="composer-grid-two aligned-field-row">
              <label>Category<Select value={itemCategory} onChange={setItemCategory} options={categoryOptions} ariaLabel="Choose category" disabled={sourceFieldsLocked} /></label>
              <label>Assigned to<Select value={itemAssignee} onChange={setItemAssignee} options={profileOptions} ariaLabel="Choose household member" disabled={sourceFieldsLocked} /></label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>Due date<DatePicker value={itemDue} onChange={setItemDue} format={household.date_format} ariaLabel="Choose due date" disabled={sourceFieldsLocked} /></label>
              <label>Location<input value={itemLocation} onChange={(event) => setItemLocation(event.target.value)} placeholder="Optional location" disabled={sourceFieldsLocked} /></label>
            </div>

            {itemLocation.trim() && <GoogleMapsLink location={itemLocation} label="Open in Google Maps" className="field-map-link" />}

            <label>Notes<textarea value={itemNotes} onChange={(event) => setItemNotes(event.target.value)} rows={3} placeholder="Optional notes" /></label>

            <section className="project-points-calculator">
              <div className="project-points-head">
                <div>
                  <span className="eyebrow">POINT CALCULATOR</span>
                  <h3>How much is this responsibility worth?</h3>
                  <p>Points are calculated from time, effort, how manual the work is and the level of responsibility.</p>
                </div>
                <div className="project-points-total"><strong>{calculatedPoints}</strong><span>points</span></div>
              </div>

              <div className="project-points-grid">
                <label>Estimated time
                  <Select value={scoreDuration} onChange={(value) => setScoreDuration(value as DurationScore)} options={durationOptions.map(({ value,label }) => ({ value,label }))} ariaLabel="Estimated time for points" />
                </label>
                <label>Effort
                  <Select value={scoreEffort} onChange={(value) => setScoreEffort(value as EffortScore)} options={effortOptions.map(({ value,label }) => ({ value,label }))} ariaLabel="Effort for points" />
                </label>
                <label>Process
                  <Select value={scoreExecution} onChange={(value) => setScoreExecution(value as ExecutionScore)} options={executionOptions.map(({ value,label }) => ({ value,label }))} ariaLabel="Automation or manual process for points" />
                </label>
                <label>Responsibility
                  <Select value={scoreResponsibility} onChange={(value) => setScoreResponsibility(value as ResponsibilityScore)} options={responsibilityOptions.map(({ value,label }) => ({ value,label }))} ariaLabel="Responsibility level for points" />
                </label>
              </div>
            </section>

            <div className="composer-option-list">
              <label className="composer-option">
                <input type="checkbox" checked={itemSyncTask || importedEdit || sourceFieldsLocked} disabled={!canSyncTasks || importedEdit || sourceFieldsLocked} onChange={(event) => setItemSyncTask(event.target.checked)} />
                <span>
                  <span>{sourceFieldsLocked || importedEdit ? 'Linked to existing Task' : 'Show in Tasks'}</span>
                  <small>{sourceFieldsLocked || importedEdit ? 'Imported Tasks remain linked, so completion in Tasks also awards or removes Projects & Chores points.' : canSyncTasks ? 'Creates or updates one linked household Task.' : 'Tasks write access is required.'}</small>
                </span>
              </label>

              <label className="composer-option">
                <input type="checkbox" checked={itemSyncCalendar} disabled={!canSyncCalendar || sourceFieldsLocked} onChange={(event) => setItemSyncCalendar(event.target.checked)} />
                <span><span>Add to Calendar</span><small>{sourceFieldsLocked ? 'The imported Task keeps its existing Calendar link.' : canSyncCalendar ? 'A due date is required. If Tasks is also selected, the same Task owns the Calendar entry.' : 'Calendar write access is required.'}</small></span>
              </label>

              {!editingItemId && itemSource !== 'task' && (
                <label className="composer-option">
                  <input type="checkbox" checked={saveAsTemplate} onChange={(event) => setSaveAsTemplate(event.target.checked)} />
                  <span><span>Save as Projects & Chores template</span><small>The reusable setup will also appear in Settings → Templates.</small></span>
                </label>
              )}
            </div>

            {error && <div className="form-message error">{error}</div>}
            <button className="primary-button" disabled={saving || (itemSource === 'task' && !existingTaskId)}>
              {saving ? 'Saving…' : editingItemId ? 'Save changes' : itemSource === 'task' ? 'Import Task & add points' : 'Create responsibility'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
