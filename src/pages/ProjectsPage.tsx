import {
  Archive,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FolderKanban,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Trophy,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
type ItemSource = 'new' | 'task' | 'template' | 'event'
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

function addDateDays(value: Date, days: number) {
  const next=new Date(value)
  next.setDate(next.getDate()+days)
  return next
}

function dateGroups<T extends { due_date:string | null; created_at:string }>(rows:T[]) {
  const today=new Date()
  today.setHours(12,0,0,0)
  const start=todayKey()
  const nearEnd=[
    addDateDays(today,9).getFullYear(),
    String(addDateDays(today,9).getMonth()+1).padStart(2,'0'),
    String(addDateDays(today,9).getDate()).padStart(2,'0'),
  ].join('-')
  const laterEndDate=addDateDays(today,69)
  const laterEnd=[
    laterEndDate.getFullYear(),
    String(laterEndDate.getMonth()+1).padStart(2,'0'),
    String(laterEndDate.getDate()).padStart(2,'0'),
  ].join('-')

  const dated=rows
    .filter((row) => row.due_date && row.due_date >= start)
    .sort((a,b) => (a.due_date ?? '').localeCompare(b.due_date ?? '') || a.created_at.localeCompare(b.created_at))

  return {
    near:dated.filter((row) => (row.due_date ?? '') <= nearEnd),
    later:dated.filter((row) => (row.due_date ?? '') > nearEnd && (row.due_date ?? '') <= laterEnd),
    far:dated.filter((row) => (row.due_date ?? '') > laterEnd),
    undated:rows.filter((row) => !row.due_date).sort((a,b) => a.created_at.localeCompare(b.created_at)),
  }
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
  const [searchParams,setSearchParams] = useSearchParams()
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
  const [sourceEventId,setSourceEventId] = useState('')
  const [archiveCount,setArchiveCount] = useState(0)
  const [externalSourceHandled,setExternalSourceHandled] = useState(false)

  async function load() {
    setError('')

    if (canWrite) {
      const cleanupResult = await supabase.rpc('archive_expired_projects_chores_v1', {
        p_household_id: household.id,
      })

      if (cleanupResult.error) {
        setError(cleanupResult.error.message)
      }
    }

    const [projectResult,itemResult,pointsResult,categoryResult,availabilityResult,taskResult,templateResult,archivedProjectsResult,archivedItemsResult] = await Promise.all([
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
        .in('status',['open','done'])
        .is('archived_at',null)
        .order('due_date',{ ascending:true, nullsFirst:false })
        .order('created_at',{ ascending:false }),
      supabase
        .from('project_work_templates')
        .select('id,name,item_kind,title,category_id,location_text,default_assigned_profile_id,notes,score_duration,score_effort,score_responsibility')
        .eq('household_id',household.id)
        .eq('active',true)
        .order('name'),
      supabase
        .from('household_projects')
        .select('id',{ count:'exact',head:true })
        .eq('household_id',household.id)
        .eq('status','archived'),
      supabase
        .from('project_work_items')
        .select('id',{ count:'exact',head:true })
        .eq('household_id',household.id)
        .eq('status','archived'),
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

    setArchiveCount((archivedProjectsResult.count ?? 0) + (archivedItemsResult.count ?? 0))
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

  const currentItems = useMemo(
    () => items.filter((item) => item.status !== 'archived'),
    [items],
  )

  const openProjectItems = useMemo(
    () => currentItems.filter((item) => item.item_kind === 'project_task'),
    [currentItems],
  )

  const chores = useMemo(
    () => currentItems.filter((item) => item.item_kind === 'chore'),
    [currentItems],
  )

  const projectGroups = useMemo(
    () => dateGroups(projects.filter((project) => project.status === 'active')),
    [projects],
  )

  const choreGroups = useMemo(
    () => dateGroups(chores),
    [chores],
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
    setSourceEventId('')
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

  useEffect(() => {
    if (externalSourceHandled || !canWrite || !categories.length) return

    const requestedTab=searchParams.get('tab')
    if (requestedTab === 'projects' || requestedTab === 'chores' || requestedTab === 'standing') {
      setTab(requestedTab)
    }

    const editItemId=searchParams.get('editItem')
    if (editItemId) {
      const item=items.find((row) => row.id === editItemId)
      if (!item) return
      openItem(item.item_kind,item.project_id ?? '',item)
      setExternalSourceHandled(true)
      return
    }

    const kind=searchParams.get('kind') === 'project_task' ? 'project_task' : 'chore'
    const taskId=searchParams.get('task')

    if (taskId) {
      const task=tasks.find((row) => row.id === taskId)
      if (!task) return

      const linked=items.find((row) => row.linked_task_id === taskId && row.status !== 'archived')
      if (linked) {
        setTab(linked.item_kind === 'chore' ? 'chores' : 'projects')
        openItem(linked.item_kind,linked.project_id ?? '',linked)
        setExternalSourceHandled(true)
        return
      }

      resetItem(kind)
      setItemKind(kind)
      setItemSource('task')
      applyExistingTask(taskId)
      setItemOpen(true)
      setExternalSourceHandled(true)
      return
    }

    const eventId=searchParams.get('event')
    if (!eventId) {
      setExternalSourceHandled(true)
      return
    }

    void (async () => {
      const [eventResult,participantResult]=await Promise.all([
        supabase
          .from('calendar_events')
          .select('id,title,category_id,all_day,start_at,start_date,event_timezone,location_text')
          .eq('id',eventId)
          .eq('household_id',household.id)
          .is('deleted_at',null)
          .single(),
        supabase
          .from('event_participants')
          .select('profile_id')
          .eq('event_id',eventId)
          .eq('household_id',household.id)
          .limit(1),
      ])

      if (eventResult.error || !eventResult.data) {
        setError(eventResult.error?.message ?? 'Could not open Calendar event.')
        setExternalSourceHandled(true)
        return
      }

      const row=eventResult.data
      const due=row.all_day
        ? row.start_date ?? ''
        : row.start_at
          ? new Intl.DateTimeFormat('en-CA',{
              timeZone:row.event_timezone || household.timezone,
              year:'numeric',month:'2-digit',day:'2-digit',
            }).format(new Date(row.start_at))
          : ''

      resetItem(kind)
      setItemKind(kind)
      setItemSource('event')
      setSourceEventId(eventId)
      setItemTitle(row.title)
      setItemCategory(row.category_id ?? categories[0]?.id ?? '')
      setItemDue(due)
      setItemLocation(row.location_text ?? '')
      setItemAssignee(participantResult.data?.[0]?.profile_id ?? '')
      setItemSyncTask(false)
      setItemSyncCalendar(true)
      setItemOpen(true)
      setExternalSourceHandled(true)
    })()
  },[
    externalSourceHandled,canWrite,categories,items,tasks,searchParams,
    household.id,household.timezone,
  ])

  async function saveItem(event: FormEvent) {
    event.preventDefault()
    const importedTask = itemSource === 'task' && !editingItemId
    if (!canWrite) return
    if (importedTask && !existingTaskId) return
    if (!importedTask && (!itemTitle.trim() || !itemCategory)) return

    setSaving(true)
    setError('')

    const editingItem=editingItemId ? items.find((item) => item.id === editingItemId) : undefined

    const result = sourceEventId
      ? await supabase.rpc('save_event_project_work_item_v1',{
          p_id:editingItemId,
          p_household_id:household.id,
          p_event_id:sourceEventId,
          p_project_id:itemKind === 'project_task' ? (itemProject || null) : null,
          p_item_kind:itemKind,
          p_assigned_profile_id:itemAssignee || null,
          p_notes:itemNotes.trim() || null,
          p_score_duration:scoreDuration,
          p_score_effort:scoreEffort,
          p_score_execution:scoreExecution,
          p_score_responsibility:scoreResponsibility,
        })
      : editingItem?.status === 'done'
        ? await supabase.rpc('save_completed_project_work_item_v1',{
            p_id:editingItemId,
            p_household_id:household.id,
            p_project_id:itemKind === 'project_task' ? (itemProject || null) : null,
            p_item_kind:itemKind,
            p_title:itemTitle.trim() || 'Responsibility',
            p_category_id:itemCategory || null,
            p_due_date:itemDue || null,
            p_location_text:itemLocation.trim() || null,
            p_assigned_profile_id:itemAssignee || null,
            p_notes:itemNotes.trim() || null,
            p_sync_task:itemSyncTask,
            p_sync_calendar:itemSyncCalendar,
            p_score_duration:scoreDuration,
            p_score_effort:scoreEffort,
            p_score_execution:scoreExecution,
            p_score_responsibility:scoreResponsibility,
          })
        : await supabase.rpc('save_project_work_item_v2',{
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
    setSearchParams({ tab:itemKind === 'chore' ? 'chores' : 'projects' })
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

  async function archiveProject(project: ProjectRow) {
    if (!canWrite) return
    const result=await supabase.rpc('set_household_project_archived_v1',{
      p_project_id:project.id,
      p_household_id:household.id,
      p_archived:true,
    })
    if (result.error) setError(result.error.message)
    else await load()
  }

  async function archiveItem(item: WorkItem) {
    if (!canWrite) return
    const result=await supabase.rpc('set_project_work_item_archived_v1',{
      p_item_id:item.id,
      p_household_id:household.id,
      p_archived:true,
    })
    if (result.error) setError(result.error.message)
    else await load()
  }

  async function deleteProject(project: ProjectRow) {
    if (!canWrite) return
    if (!window.confirm('Permanently delete project "' + project.title + '"? Linked Tasks and Calendar events will stay.')) return

    const result=await supabase.rpc('delete_household_project_v1',{
      p_project_id:project.id,
      p_household_id:household.id,
    })
    if (result.error) setError(result.error.message)
    else await load()
  }

  async function deleteItem(item: WorkItem) {
    if (!canWrite) return
    if (!window.confirm('Permanently delete responsibility "' + item.title + '"? Linked Tasks and Calendar events will stay.')) return

    const result=await supabase.rpc('delete_project_work_item_v1',{
      p_item_id:item.id,
      p_household_id:household.id,
    })
    if (result.error) setError(result.error.message)
    else await load()
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

        {canWrite && (
          <div className="project-work-actions">
            <button type="button" className="icon-button compact-icon" aria-label={'Edit ' + item.title} onClick={() => openItem(item.item_kind,item.project_id ?? '',item)}>
              <Pencil size={14} />
            </button>
            <button type="button" className="icon-button compact-icon" aria-label={'Archive ' + item.title} onClick={() => void archiveItem(item)}>
              <Archive size={14} />
            </button>
            <button type="button" className="icon-button compact-icon danger-icon-button" aria-label={'Delete ' + item.title} onClick={() => void deleteItem(item)}>
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </article>
    )
  }

  function renderProjectCard(project: ProjectRow) {
    const owner=project.owner_profile_id ? profileById.get(project.owner_profile_id) : undefined
    const projectItems=openProjectItems.filter((item) => item.project_id === project.id)
    const done=projectItems.filter((item) => item.status === 'done').length

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
              <button type="button" className="icon-button compact-icon" aria-label={'Archive ' + project.title} onClick={() => void archiveProject(project)}><Archive size={14} /></button>
              <button type="button" className="icon-button compact-icon danger-icon-button" aria-label={'Delete ' + project.title} onClick={() => void deleteProject(project)}><Trash2 size={14} /></button>
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
  }

  function ProjectDateSection({ title,subtitle,rows }: { title:string;subtitle:string;rows:ProjectRow[] }) {
    return (
      <section className="task-section projects-date-section">
        <header className="task-section-head">
          <div><h2>{title}</h2><p>{subtitle}</p></div>
          <span>{rows.length}</span>
        </header>
        {rows.length
          ? <div className="projects-date-list">{rows.map(renderProjectCard)}</div>
          : <div className="task-section-empty">No projects in this section.</div>}
      </section>
    )
  }

  function ChoreDateSection({ title,subtitle,rows }: { title:string;subtitle:string;rows:WorkItem[] }) {
    return (
      <section className="task-section projects-date-section">
        <header className="task-section-head">
          <div><h2>{title}</h2><p>{subtitle}</p></div>
          <span>{rows.length}</span>
        </header>
        {rows.length
          ? <div className="chores-list">{rows.map(renderWorkItem)}</div>
          : <div className="task-section-empty">No chores in this section.</div>}
      </section>
    )
  }

  const importedEdit = Boolean(editingItemId && items.find((item) => item.id === editingItemId)?.task_link_origin === 'imported')
  const taskSourceLocked = itemSource === 'task' && !editingItemId
  const eventSourceLocked = Boolean(sourceEventId)
  const sourceFieldsLocked = taskSourceLocked || eventSourceLocked
  const assignmentLocked = taskSourceLocked

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
          <ProjectDateSection
            title="Next 10 days"
            subtitle="Projects due today or within the next 10 days."
            rows={projectGroups.near}
          />
          <ProjectDateSection
            title="Later"
            subtitle="Projects due after the next 10 days. The next 60 days are shown first."
            rows={[...projectGroups.later,...projectGroups.far]}
          />
          <ProjectDateSection
            title="Without date"
            subtitle="Projects without a due date stay here until a date is added."
            rows={projectGroups.undated}
          />

          {openProjectItems.filter((item) => !item.project_id).length > 0 && (
            <article className="project-card list-card">
              <header><div><span className="eyebrow">UNASSIGNED</span><h2>Project responsibilities without a project</h2></div></header>
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

          <ChoreDateSection
            title="Next 10 days"
            subtitle="Chores due today or within the next 10 days."
            rows={choreGroups.near}
          />
          <ChoreDateSection
            title="Later"
            subtitle="Chores due after the next 10 days. The next 60 days are shown first."
            rows={[...choreGroups.later,...choreGroups.far]}
          />
          <ChoreDateSection
            title="Without date"
            subtitle="Chores without a date remain available here."
            rows={choreGroups.undated}
          />
        </section>
      )}

      {(tab === 'projects' || tab === 'chores') && (
        <div className="archive-repository-bar">
          <Link className="secondary-button compact archive-repository-button" to="/app/projects/archive">
            <Archive size={14} />
            Projects & Chores archive
            <span>{archiveCount}</span>
          </Link>
        </div>
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

            {sourceEventId && (
              <div className="module-access-note">Linked from Calendar. The Calendar event remains the main item; this responsibility is only used for Projects & Chores points.</div>
            )}

            {!editingItemId && !sourceEventId && (
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
              <label>Assigned to<Select value={itemAssignee} onChange={setItemAssignee} options={profileOptions} ariaLabel="Choose household member" disabled={assignmentLocked} /></label>
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
                <input
                  type="checkbox"
                  checked={eventSourceLocked ? false : itemSyncTask || importedEdit || taskSourceLocked}
                  disabled={!canSyncTasks || importedEdit || taskSourceLocked || eventSourceLocked}
                  onChange={(event) => setItemSyncTask(event.target.checked)}
                />
                <span>
                  <span>{eventSourceLocked ? 'Points-only child of Calendar event' : taskSourceLocked || importedEdit ? 'Linked to existing Task' : 'Show in Tasks'}</span>
                  <small>
                    {eventSourceLocked
                      ? 'The Calendar event stays the main item. No duplicate Task is created.'
                      : taskSourceLocked || importedEdit
                        ? 'Imported Tasks remain linked, so completion in Tasks also awards or removes Projects & Chores points.'
                        : canSyncTasks ? 'Creates or updates one linked household Task.' : 'Tasks write access is required.'}
                  </small>
                </span>
              </label>

              <label className="composer-option">
                <input
                  type="checkbox"
                  checked={eventSourceLocked ? true : itemSyncCalendar}
                  disabled={!canSyncCalendar || taskSourceLocked || eventSourceLocked}
                  onChange={(event) => setItemSyncCalendar(event.target.checked)}
                />
                <span>
                  <span>{eventSourceLocked ? 'Linked to existing Calendar event' : 'Add to Calendar'}</span>
                  <small>
                    {eventSourceLocked
                      ? 'This responsibility remains connected to the original Calendar event.'
                      : taskSourceLocked
                        ? 'The imported Task keeps its existing Calendar link.'
                        : canSyncCalendar ? 'A due date is required. If Tasks is also selected, the same Task owns the Calendar entry.' : 'Calendar write access is required.'}
                  </small>
                </span>
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
