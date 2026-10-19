import { Archive, CalendarSync, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Eye, EyeOff, FolderKanban, LockKeyhole, Pencil, Plus, Search, Settings2, Trash2, WalletCards, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useHousehold } from '../context/HouseholdContext'
import { categoryColor } from '../lib/categoryColors'
import { moduleConnectionState } from '../lib/moduleAccess'
import { supabase } from '../lib/supabase'
import type { CalendarOccurrence, CalendarRow, EventCategory } from '../lib/types'
import { Select } from '../components/ui/Select'
import { TimePicker } from '../components/ui/TimePicker'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { DatePicker } from '../components/ui/DatePicker'
import { GoogleMapsLink } from '../components/ui/GoogleMapsLink'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { firstName } from '../lib/personName'

type CalendarView = 'day' | 'week' | 'month' | 'upcoming'

type EventTemplate = {
  id: string
  name: string
  title: string
  category_id: string | null
  all_day: boolean
  start_time: string | null
  end_time: string | null
  location_text: string | null
}

type LinkedChecklistItem = {
  id: string
  checklist_id: string
  item_text: string
  checked: boolean
}

type LinkedChecklist = {
  id: string
  title: string
  status: 'active' | 'archived'
  items: LinkedChecklistItem[]
}

type EventCost = {
  id: string
  title: string
  amount: number
  currency: string
  cost_date: string
}

type LinkedWorkItem = {
  id: string
  item_kind: 'project_task' | 'chore'
  status: 'open' | 'done' | 'archived'
  source_event_occurrence_key: string | null
  source_event_series_rule_id: string | null
}

type SeriesRule = {
  id:string
  item_kind:'project_task'|'chore'
  active:boolean
}

type DeleteScope='one'|'future'|'all'

const calendarColorOptions=[
  { value:'purple',label:'Purple' },
  { value:'pink',label:'Pink' },
  { value:'blue',label:'Blue' },
  { value:'teal',label:'Teal' },
  { value:'green',label:'Green' },
  { value:'orange',label:'Orange' },
  { value:'rose',label:'Rose' },
  { value:'indigo',label:'Indigo' },
  { value:'slate',label:'Slate' },
]

function currentTimeInZone(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())

  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00'
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00'
  return hour + ':' + minute
}

function addMinutesToTime(value: string, minutesToAdd: number) {
  const [hour, minute] = value.split(':').map(Number)
  const total = hour * 60 + minute + minutesToAdd
  if (total >= 24 * 60) return '23:59'
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return year + '-' + month + '-' + day
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}
function shiftDateKey(value:string,days:number) {
  const [year,month,day]=value.split('-').map(Number)
  const date=new Date(Date.UTC(year,month-1,day))
  date.setUTCDate(date.getUTCDate()+days)
  return date.toISOString().slice(0,10)
}

function daysBetweenDateKeys(from:string,to:string) {
  const [fy,fm,fd]=from.split('-').map(Number)
  const [ty,tm,td]=to.split('-').map(Number)
  return Math.round((Date.UTC(ty,tm-1,td)-Date.UTC(fy,fm-1,fd))/86400000)
}

function startOfWeek(date: Date, mondayFirst: boolean) {
  const next = new Date(date)
  const offset = mondayFirst
    ? (next.getDay() + 6) % 7
    : next.getDay()
  next.setDate(next.getDate() - offset)
  next.setHours(12, 0, 0, 0)
  return next
}

function rangeFor(view: CalendarView, anchor: Date, mondayFirst: boolean) {
  if (view === 'day') {
    const key = dateKey(anchor)
    return { start: key, end: key }
  }

  if (view === 'week') {
    const start = startOfWeek(anchor, mondayFirst)
    return { start: dateKey(start), end: dateKey(addDays(start, 6)) }
  }

  if (view === 'upcoming') {
    return { start: dateKey(anchor), end: dateKey(addDays(anchor, 59)) }
  }

  return {
    start: dateKey(new Date(anchor.getFullYear(), anchor.getMonth(), 1)),
    end: dateKey(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)),
  }
}

function occurrenceDayKey(event: CalendarOccurrence) {
  if (event.all_day) return event.occurrence_start_date
  if (!event.occurrence_start_at) return null
  return dateKey(new Date(event.occurrence_start_at))
}

function eventTime(event: CalendarOccurrence, timeFormat: '24h' | '12h') {
  if (event.all_day || !event.occurrence_start_at) return 'All day'
  return new Date(event.occurrence_start_at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: timeFormat === '12h',
  })
}

function dateInZone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'
  return year + '-' + month + '-' + day
}

function timeInZone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value))

  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00'
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00'
  return hour + ':' + minute
}

function parseRrule(rrule: string | null) {
  if (!rrule) {
    return {
      repeatType: 'none' as const,
      repeatInterval: '1',
      repeatDays: [] as string[],
      repeatUntil: '',
    }
  }

  const values = Object.fromEntries(
    rrule.split(';').map((part) => {
      const [key, value = ''] = part.split('=')
      return [key, value]
    }),
  )

  const freq = values.FREQ?.toLowerCase()
  const repeatType = freq === 'daily' || freq === 'weekly' || freq === 'monthly'
    ? freq
    : 'none'
  const until = values.UNTIL && /^\d{8}$/.test(values.UNTIL)
    ? values.UNTIL.slice(0, 4) + '-' + values.UNTIL.slice(4, 6) + '-' + values.UNTIL.slice(6, 8)
    : ''

  return {
    repeatType,
    repeatInterval: values.INTERVAL || '1',
    repeatDays: values.BYDAY ? values.BYDAY.split(',').filter(Boolean) : [],
    repeatUntil: until,
  }
}

export function CalendarPage() {
  const { household, profiles, modules, user } = useHousehold()
  const routeNavigate = useNavigate()
  const routeLocation = useLocation()
  const calendarAccess = modules.find((module) => module.code === 'calendar')
  const canWrite = Boolean(calendarAccess?.can_write)
  const mondayFirst = household.week_starts_on === 1
  const checklistAccess = modules.find((module) => module.code === 'checklists')
  const costsAccess = modules.find((module) => module.code === 'costs')
  const projectsAccess = modules.find((module) => module.code === 'projects')
  const canWriteChecklists = Boolean(checklistAccess?.can_write && moduleConnectionState(modules, 'calendar', 'checklists') === 'active')
  const canWriteCosts = Boolean(costsAccess?.can_write && moduleConnectionState(modules, 'calendar', 'costs') === 'active')
  const canWriteProjects = Boolean(projectsAccess?.can_write && moduleConnectionState(modules, 'calendar', 'projects') === 'active')

  const [view, setView] = useState<CalendarView>('week')

  // A bottom-tab tap resets to the current week even if Calendar stays mounted.
  useEffect(() => {
    const openCurrentWeek = () => {
      setView('week')
      setAnchor(new Date())
    }
    if (new URLSearchParams(routeLocation.search).get('view') === 'week') {
      openCurrentWeek()
    }
    window.addEventListener('famioo:calendar-week-shortcut', openCurrentWeek)
    return () => window.removeEventListener('famioo:calendar-week-shortcut', openCurrentWeek)
  }, [routeLocation.key, routeLocation.search])
  const [anchor, setAnchor] = useState(() => new Date())
  const [events, setEvents] = useState<CalendarOccurrence[]>([])
  const [calendars, setCalendars] = useState<CalendarRow[]>([])
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [templates, setTemplates] = useState<EventTemplate[]>([])
  const [composerDate, setComposerDate] = useState<string | null>(null)
  const [endDate, setEndDate] = useState('')
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [editingCalendarId, setEditingCalendarId] = useState<string | null>(null)
  const [templateId, setTemplateId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [allDay, setAllDay] = useState(true)
  const [startTime, setStartTime] = useState('18:00')
  const [endTime, setEndTime] = useState('19:00')
  const [categoryId, setCategoryId] = useState('')
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const [notificationEnabled, setNotificationEnabled] = useState(true)
  const [reminderValue, setReminderValue] = useState<'morning' | '0' | '10' | '30' | '60' | '1440'>('60')
  const [locationText, setLocationText] = useState('')
  const [repeatType, setRepeatType] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none')
  const [repeatInterval, setRepeatInterval] = useState('1')
  const [repeatDays, setRepeatDays] = useState<string[]>([])
  const [repeatUntil, setRepeatUntil] = useState('')
  const [saveTemplate, setSaveTemplate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [editingOccurrence, setEditingOccurrence] = useState<CalendarOccurrence | null>(null)
  const [editingRecurring, setEditingRecurring] = useState(false)
  const [deleteOptionsOpen, setDeleteOptionsOpen] = useState(false)
  const [linkedChecklists, setLinkedChecklists] = useState<LinkedChecklist[]>([])
  const [linkedCosts, setLinkedCosts] = useState<EventCost[]>([])
  const [linkedWorkItems, setLinkedWorkItems] = useState<LinkedWorkItem[]>([])
  const [eventCostTitle, setEventCostTitle] = useState('')
  const [eventCostAmount, setEventCostAmount] = useState('')
  const [eventCostSaving, setEventCostSaving] = useState(false)
  const [seriesRules,setSeriesRules] = useState<SeriesRule[]>([])
  const [projectScopeKind,setProjectScopeKind] = useState<'project_task'|'chore'|null>(null)
  const [deleteRequest,setDeleteRequest] = useState<DeleteScope|null>(null)
  const [editingBaseStartDate,setEditingBaseStartDate] = useState('')
  const [editingBaseEndDate,setEditingBaseEndDate] = useState('')
  const [editingOccurrenceInitialDate,setEditingOccurrenceInitialDate] = useState('')
  const [hiddenCalendarIds,setHiddenCalendarIds] = useState<string[]>([])
  const [calendarManagerOpen,setCalendarManagerOpen] = useState(false)
  const [calendarEditingId,setCalendarEditingId] = useState<string|null>(null)
  const [calendarName,setCalendarName] = useState('')
  const [calendarColorKey,setCalendarColorKey] = useState('purple')
  const [calendarSaving,setCalendarSaving] = useState(false)
  const [editingExternalReadOnly,setEditingExternalReadOnly] = useState(false)
  const [editingExternalSource,setEditingExternalSource] = useState('')
  const [calendarSearchOpen,setCalendarSearchOpen] = useState(false)
  const [calendarSearchQuery,setCalendarSearchQuery] = useState('')
  const [upcomingDays,setUpcomingDays] = useState(30)

  const range = useMemo(
    () => rangeFor(view, anchor, mondayFirst),
    [view, anchor, mondayFirst],
  )

  const currentUserProfile = useMemo(
    () => profiles.find((profile) => profile.linked_user_id === user.id),
    [profiles, user.id],
  )

  async function load() {
    setError('')

    const [occurrences, calendarRows, categoryRows, availabilityRows, templateRows] = await Promise.all([
      supabase.rpc('calendar_occurrences_v1', {
        p_household_id: household.id,
        p_range_start: range.start,
        p_range_end: range.end,
      }),
      supabase
        .from('calendars')
        .select('id,name,color_key,is_default')
        .eq('household_id', household.id)
        .eq('active', true)
        .order('name'),
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
        .eq('module_code', 'calendar'),
      supabase
        .from('event_templates')
        .select('id,name,title,category_id,all_day,start_time,end_time,location_text')
        .eq('household_id', household.id)
        .eq('active', true)
        .order('name'),
    ])

    if (occurrences.error) setError(occurrences.error.message)
    else setEvents((occurrences.data ?? []) as CalendarOccurrence[])

    if (calendarRows.error) setError((current) => current || calendarRows.error.message)
    else setCalendars((calendarRows.data ?? []) as CalendarRow[])

    if (categoryRows.error || availabilityRows.error) {
      setError((current) => current || categoryRows.error?.message || availabilityRows.error?.message || 'Could not load categories.')
    } else {
      const enabled = new Map((availabilityRows.data ?? []).map((row) => [row.category_id, row.enabled]))
      const activeCategories = ((categoryRows.data ?? []) as EventCategory[])
        .filter((item) => enabled.get(item.id) ?? true)
      setCategories(activeCategories)
      setCategoryId((current) => activeCategories.some((item) => item.id === current)
        ? current
        : activeCategories[0]?.id ?? '')
    }

    if (templateRows.error) setError((current) => current || templateRows.error.message)
    else setTemplates((templateRows.data ?? []) as EventTemplate[])
  }

  useEffect(() => {
    void load()
  }, [household.id, range.start, range.end])

  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )

  const calendarsById = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar])),
    [calendars],
  )

  const visibleEvents = useMemo(() => {
    const query=calendarSearchQuery.trim().toLocaleLowerCase()
    return events.filter((event) => {
      if(hiddenCalendarIds.includes(event.calendar_id)) return false
      if(!query) return true

      const category=event.category_id ? categoriesById.get(event.category_id) : undefined
      const calendar=calendarsById.get(event.calendar_id)
      return [
        event.title,
        event.location_text ?? '',
        category?.name ?? '',
        calendar?.name ?? '',
      ].some((value)=>value.toLocaleLowerCase().includes(query))
    })
  }, [events, hiddenCalendarIds, calendarSearchQuery, categoriesById, calendarsById])

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarOccurrence[]>()

    for (const event of visibleEvents) {
      const key = occurrenceDayKey(event)
      if (!key) continue
      map.set(key, [...(map.get(key) ?? []), event])
    }

    for (const [, dayEvents] of map) {
      dayEvents.sort((a, b) => {
        if (a.all_day !== b.all_day) return a.all_day ? -1 : 1
        return (a.occurrence_start_at ?? '').localeCompare(b.occurrence_start_at ?? '')
      })
    }

    return map
  }, [visibleEvents])

  const monthGrid = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const gridStart = startOfWeek(first, mondayFirst)

    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
  }, [anchor, mondayFirst])

  const weekDays = useMemo(() => {
    const start = startOfWeek(anchor, mondayFirst)
    return Array.from({ length: 7 }, (_, index) => addDays(start, index))
  }, [anchor, mondayFirst])

  const upcomingDayList = useMemo(() => {
    const today=new Date()
    today.setHours(12,0,0,0)
    return Array.from({ length: upcomingDays }, (_, index)=>addDays(today,index))
  }, [upcomingDays])

  const weekdayNames = mondayFirst
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const dayEvents = eventsByDay.get(dateKey(anchor)) ?? []
  const allDayEvents = dayEvents.filter((item) => item.all_day)
  const timedEventsByHour = new Map<number, CalendarOccurrence[]>()

  for (const item of dayEvents.filter((event) => !event.all_day && event.occurrence_start_at)) {
    const hour = new Date(item.occurrence_start_at!).getHours()
    timedEventsByHour.set(hour, [...(timedEventsByHour.get(hour) ?? []), item])
  }

  const dayHours = Array.from({ length: 24 }, (_, hour) => hour)

  function closeComposer() {
    setComposerDate(null)
    setEndDate('')
    setEditingEventId(null)
    setEditingCalendarId(null)
    setTemplateId('')
    setDescription('')
    setSaveTemplate(false)
    setEditingOccurrence(null)
    setEditingRecurring(false)
    setDeleteOptionsOpen(false)
    setLinkedChecklists([])
    setLinkedCosts([])
    setLinkedWorkItems([])
    setEventCostTitle('')
    setEventCostAmount('')
    setSeriesRules([])
    setProjectScopeKind(null)
    setDeleteRequest(null)
    setEditingBaseStartDate('')
    setEditingBaseEndDate('')
    setEditingOccurrenceInitialDate('')
    setEditingExternalReadOnly(false)
    setEditingExternalSource('')
    setError('')
  }

  function changeComposerStartDate(nextStartDate: string) {
    // The start date is required. Clearing it must not silently close the editor.
    if (!composerDate || !nextStartDate) return

    // Moving an appointment also moves its end date, preserving multi-day length.
    // Users may still choose a different end date afterwards.
    const offsetDays = daysBetweenDateKeys(composerDate, nextStartDate)
    setEndDate((currentEndDate) => shiftDateKey(currentEndDate || composerDate, offsetDays))
    setComposerDate(nextStartDate)
  }

  function openComposer(day: string, timedStart?: string) {
    if (!canWrite) return

    const defaultStart = timedStart ?? currentTimeInZone(household.timezone)
    setEditingEventId(null)
    setEditingExternalReadOnly(false)
    setEditingExternalSource('')
    setEditingCalendarId(calendars.find((item) => item.is_default)?.id ?? calendars[0]?.id ?? null)
    setComposerDate(day)
    setEndDate(day)
    setTemplateId('')
    setTitle('')
    setDescription('')
    setAllDay(!timedStart)
    setStartTime(defaultStart)
    setEndTime(addMinutesToTime(defaultStart, 60))
    setParticipantIds(currentUserProfile ? [currentUserProfile.id] : [])
    setNotificationEnabled(true)
    setReminderValue(timedStart ? '60' : 'morning')
    setLocationText('')
    setRepeatType('none')
    setRepeatInterval('1')
    setRepeatDays([])
    setRepeatUntil('')
    setSaveTemplate(false)
    setError('')
  }

  useEffect(() => {
    const state=routeLocation.state as {
      prefillEvent?:{
        title?:string
        description?:string
        sourceUrl?:string
      }
    }|null
    const prefill=state?.prefillEvent

    if(!prefill||!canWrite||calendars.length===0) return

    const day=dateKey(new Date())
    openComposer(day)
    setTitle((prefill.title??'').slice(0,200))
    setDescription(
      prefill.sourceUrl
        ?'Source: '+prefill.sourceUrl
        :(prefill.description??'').slice(0,1200),
    )

    routeNavigate(routeLocation.pathname,{replace:true,state:null})
  },[routeLocation.state,routeLocation.pathname,routeNavigate,canWrite,calendars.length])

  async function openEventEditor(item: CalendarOccurrence) {
    if (!canWrite) return

    setError('')

    const [eventResult, participantResult, ruleResult, reminderResult] = await Promise.all([
      supabase
        .from('calendar_events')
        .select('id,calendar_id,category_id,title,description,all_day,start_at,end_at,start_date,end_date,event_timezone,location_text,external_read_only,external_connection_id')
        .eq('id', item.event_id)
        .eq('household_id', household.id)
        .single(),
      supabase
        .from('event_participants')
        .select('profile_id')
        .eq('household_id', household.id)
        .eq('event_id', item.event_id),
      supabase
        .from('event_recurrence_rules')
        .select('rrule')
        .eq('household_id', household.id)
        .eq('event_id', item.event_id)
        .maybeSingle(),
      supabase
        .from('event_reminders')
        .select('profile_id,reminder_kind,offset_minutes,morning_time,enabled')
        .eq('household_id', household.id)
        .eq('event_id', item.event_id)
        .eq('delivery_channel', 'push')
        .eq('enabled', true),
    ])

    if (eventResult.error || !eventResult.data) {
      setError(eventResult.error?.message ?? 'Could not open this event.')
      return
    }

    const row = eventResult.data
    const externalReadOnly=Boolean(row.external_read_only && row.external_connection_id)
    setEditingExternalReadOnly(externalReadOnly)
    setEditingExternalSource('')

    if(externalReadOnly && row.external_connection_id){
      const sourceResult=await supabase
        .from('calendar_connections')
        .select('display_name,provider')
        .eq('household_id',household.id)
        .eq('id',row.external_connection_id)
        .maybeSingle()

      if(sourceResult.data){
        const provider=sourceResult.data.provider==='ics'
          ? 'ICS'
          : sourceResult.data.provider==='microsoft'
            ? 'Microsoft 365'
            : sourceResult.data.provider==='google'
              ? 'Google Calendar'
              : 'External calendar'
        setEditingExternalSource(sourceResult.data.display_name+' · '+provider)
      }
    }

    const timezone = row.event_timezone || household.timezone
    const baseStartDate = row.all_day
      ? row.start_date ?? dateKey(anchor)
      : row.start_at
        ? dateInZone(row.start_at, timezone)
        : dateKey(anchor)
    const baseEndDate = row.all_day
      ? row.end_date ?? baseStartDate
      : row.end_at
        ? dateInZone(row.end_at, timezone)
        : baseStartDate

    // The editor is opened from a concrete occurrence. Show that occurrence's
    // date instead of the series' original DTSTART so downstream links (for
    // example Projects & Chores) always inherit the day the user clicked.
    const eventDate = item.all_day
      ? item.occurrence_start_date ?? baseStartDate
      : item.occurrence_start_at
        ? dateInZone(item.occurrence_start_at, timezone)
        : baseStartDate
    const eventEndDate = item.all_day
      ? item.occurrence_end_date ?? eventDate
      : item.occurrence_end_at
        ? dateInZone(item.occurrence_end_at, timezone)
        : eventDate
    const parsed = parseRrule(ruleResult.data?.rrule ?? null)
    const reminder = reminderResult.data?.[0]

    setEditingEventId(row.id)
    setEditingCalendarId(row.calendar_id)
    setEditingOccurrence(item)
    setEditingRecurring(Boolean(ruleResult.data?.rrule))
    setDeleteOptionsOpen(false)
    setEditingBaseStartDate(baseStartDate)
    setEditingBaseEndDate(baseEndDate)
    setEditingOccurrenceInitialDate(eventDate)
    setComposerDate(eventDate)
    setEndDate(eventEndDate)
    setTemplateId('')
    setTitle(row.title)
    setDescription(row.description ?? '')
    setCategoryId(row.category_id ?? categories[0]?.id ?? '')
    setAllDay(row.all_day)
    setStartTime(item.occurrence_start_at ? timeInZone(item.occurrence_start_at, timezone) : row.start_at ? timeInZone(row.start_at, timezone) : '18:00')
    setEndTime(item.occurrence_end_at ? timeInZone(item.occurrence_end_at, timezone) : row.end_at ? timeInZone(row.end_at, timezone) : row.start_at ? addMinutesToTime(timeInZone(row.start_at, timezone), 60) : '19:00')
    setParticipantIds((participantResult.data ?? []).map((entry) => entry.profile_id))
    setNotificationEnabled(Boolean(reminder))
    setReminderValue(
      reminder?.reminder_kind === 'morning_of'
        ? 'morning'
        : reminder?.offset_minutes != null
          ? String(reminder.offset_minutes) as typeof reminderValue
          : '60',
    )
    setLocationText(row.location_text ?? '')
    setRepeatType(parsed.repeatType as typeof repeatType)
    setRepeatInterval(parsed.repeatInterval)
    setRepeatDays(parsed.repeatDays)
    setRepeatUntil(parsed.repeatUntil)
    setSaveTemplate(false)

    if (participantResult.error) setError(participantResult.error.message)
    else if (ruleResult.error) setError(ruleResult.error.message)
    else if (reminderResult.error) setError(reminderResult.error.message)

    const [checklistResult,costResult,workResult,seriesRuleResult] = await Promise.all([
      checklistAccess?.enabled
        ? supabase
            .from('checklists')
            .select('id,title,status')
            .eq('household_id',household.id)
            .eq('linked_event_id',item.event_id)
            .neq('status','archived')
            .order('created_at')
        : Promise.resolve({ data:[],error:null }),
      costsAccess?.enabled
        ? supabase
            .from('household_costs')
            .select('id,title,amount,currency,cost_date')
            .eq('household_id',household.id)
            .eq('source_event_id',item.event_id)
            .order('cost_date')
            .order('created_at')
        : Promise.resolve({ data:[],error:null }),
      projectsAccess?.enabled
        ? supabase
            .from('project_work_items')
            .select('id,item_kind,status,source_event_occurrence_key,source_event_series_rule_id')
            .eq('household_id',household.id)
            .eq('linked_event_id',item.event_id)
            .neq('status','archived')
        : Promise.resolve({ data:[],error:null }),
      projectsAccess?.enabled
        ? supabase
            .from('project_event_series_rules')
            .select('id,item_kind,active')
            .eq('household_id',household.id)
            .eq('event_id',item.event_id)
            .eq('active',true)
        : Promise.resolve({ data:[],error:null }),
    ])

    if (checklistResult.error) {
      setError((current) => current || checklistResult.error?.message || '')
    } else {
      const lists=(checklistResult.data ?? []) as Omit<LinkedChecklist,'items'>[]
      let checklistItems:LinkedChecklistItem[]=[]
      if (lists.length) {
        const itemResult=await supabase
          .from('checklist_items')
          .select('id,checklist_id,item_text,checked')
          .eq('household_id',household.id)
          .in('checklist_id',lists.map((list) => list.id))
          .order('sort_order')

        if (itemResult.error) setError((current) => current || itemResult.error.message)
        else checklistItems=(itemResult.data ?? []) as LinkedChecklistItem[]
      }

      setLinkedChecklists(lists.map((list) => ({
        ...list,
        items:checklistItems.filter((entry) => entry.checklist_id === list.id),
      })))
    }

    if (costResult.error) setError((current) => current || costResult.error?.message || '')
    else setLinkedCosts((costResult.data ?? []) as EventCost[])

    if (workResult.error) setError((current) => current || workResult.error?.message || '')
    else setLinkedWorkItems((workResult.data ?? []) as LinkedWorkItem[])

    if (seriesRuleResult.error) setError((current) => current || seriesRuleResult.error?.message || '')
    else setSeriesRules((seriesRuleResult.data ?? []) as SeriesRule[])

    setEventCostTitle(row.title + ' cost')
    setEventCostAmount('')
  }

  function resetCalendarEditor() {
    setCalendarEditingId(null)
    setCalendarName('')
    setCalendarColorKey('purple')
  }

  function editCalendar(calendar:CalendarRow) {
    setCalendarEditingId(calendar.id)
    setCalendarName(calendar.name)
    setCalendarColorKey(calendar.color_key)
  }

  async function saveManagedCalendar(event:FormEvent) {
    event.preventDefault()
    if(!canWrite || !calendarName.trim() || calendarSaving) return

    setCalendarSaving(true)
    setError('')

    const result=await supabase.rpc('save_calendar_v1',{
      p_calendar_id:calendarEditingId,
      p_household_id:household.id,
      p_name:calendarName.trim(),
      p_color_key:calendarColorKey,
    })

    setCalendarSaving(false)

    if(result.error){
      setError(result.error.message)
      return
    }

    resetCalendarEditor()
    await load()
  }

  async function makeDefaultCalendar(calendarId:string) {
    if(!canWrite || calendarSaving) return
    setCalendarSaving(true)
    setError('')

    const result=await supabase.rpc('set_default_calendar_v1',{
      p_household_id:household.id,
      p_calendar_id:calendarId,
    })

    setCalendarSaving(false)

    if(result.error){
      setError(result.error.message)
      return
    }

    setEditingCalendarId((current)=>current ?? calendarId)
    await load()
  }

  async function archiveManagedCalendar(calendarId:string) {
    if(!canWrite || calendarSaving) return
    setCalendarSaving(true)
    setError('')

    const result=await supabase.rpc('archive_calendar_v1',{
      p_household_id:household.id,
      p_calendar_id:calendarId,
    })

    setCalendarSaving(false)

    if(result.error){
      setError(result.error.message)
      return
    }

    setHiddenCalendarIds((current)=>current.filter((id)=>id!==calendarId))
    if(calendarEditingId===calendarId) resetCalendarEditor()
    await load()
  }

  async function deleteEvent(scope: DeleteScope = 'all') {
    if (editingExternalReadOnly) return
    if (!editingEventId || !canWrite || deleting) return

    setDeleting(true)
    setError('')

    const result = await supabase.rpc('delete_event_occurrences_v1', {
      p_event_id: editingEventId,
      p_household_id: household.id,
      p_scope: scope,
      p_occurrence_date: editingOccurrence?.occurrence_start_date
        ?? (editingOccurrence?.occurrence_start_at
          ? dateInZone(editingOccurrence.occurrence_start_at, editingOccurrence.event_timezone)
          : composerDate),
      p_occurrence_at: editingOccurrence?.occurrence_start_at ?? null,
    })

    setDeleting(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    closeComposer()
    await load()
  }

  function requestDelete(scope:DeleteScope) {
    setDeleteRequest(scope)
  }

  async function toggleLinkedChecklistItem(item: LinkedChecklistItem) {
    if (!canWriteChecklists) return

    const result=await supabase
      .from('checklist_items')
      .update({ checked:!item.checked })
      .eq('id',item.id)
      .eq('household_id',household.id)

    if (result.error) {
      setError(result.error.message)
      return
    }

    setLinkedChecklists((current) => current.map((list) => ({
      ...list,
      items:list.items.map((entry) => entry.id === item.id
        ? { ...entry,checked:!entry.checked }
        : entry),
    })))
  }

  async function addEventCost() {
    if (!editingEventId || !canWriteCosts || !eventCostAmount.trim()) return

    const amount=Number(eventCostAmount.replace(',','.'))
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Enter a valid Household Cost amount.')
      return
    }

    setEventCostSaving(true)
    setError('')

    const result=await supabase
      .from('household_costs')
      .insert({
        household_id:household.id,
        title:eventCostTitle.trim() || title.trim() || 'Calendar event cost',
        amount,
        currency:'EUR',
        cost_date:composerDate,
        cost_kind:'additional',
        source_type:'calendar_event',
        source_event_id:editingEventId,
        schedule_type:'one_time',
        flow_type:'expense',
      })
      .select('id,title,amount,currency,cost_date')
      .single()

    setEventCostSaving(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    setLinkedCosts((current) => [...current,result.data as EventCost])
    setEventCostAmount('')
  }

  function navigateProjectsConnection(kind:'project_task'|'chore',scope:'one'|'series'='one') {
    if (!editingEventId || !editingOccurrence) return
    const tab=kind==='chore' ? 'chores' : 'projects'
    const seriesRule=seriesRules.find((rule)=>rule.item_kind===kind && rule.active)
    const occurrenceItem=linkedWorkItems.find((item)=>
      item.item_kind===kind
      && item.source_event_occurrence_key===editingOccurrence.occurrence_key
    )

    const params=new URLSearchParams({ tab })

    if(scope==='series' && seriesRule){
      params.set('seriesRule',seriesRule.id)
    } else if(scope==='one' && occurrenceItem && !occurrenceItem.source_event_series_rule_id){
      params.set('editItem',occurrenceItem.id)
    } else if(scope==='series' && seriesRule){
      params.set('seriesRule',seriesRule.id)
    } else {
      params.set('event',editingEventId)
      params.set('kind',kind)
      params.set('scope',scope)
      params.set('occurrenceKey',editingOccurrence.occurrence_key)
      params.set('occurrenceDate',
        editingOccurrence.occurrence_start_date
          ?? (editingOccurrence.occurrence_start_at
            ? dateInZone(editingOccurrence.occurrence_start_at,editingOccurrence.event_timezone)
            : composerDate ?? '')
      )
    }

    setProjectScopeKind(null)
    routeNavigate('/app/projects?' + params.toString())
  }

  function openProjectsConnection(kind: 'project_task' | 'chore') {
    if (!editingEventId || !editingOccurrence) return

    const seriesRule=seriesRules.find((rule)=>rule.item_kind===kind && rule.active)
    if(seriesRule){
      navigateProjectsConnection(kind,'series')
      return
    }

    if(editingRecurring){
      setProjectScopeKind(kind)
      return
    }

    navigateProjectsConnection(kind,'one')
  }

  function applyTemplate(nextTemplateId: string) {
    setTemplateId(nextTemplateId)
    if (!nextTemplateId) return

    const template = templates.find((item) => item.id === nextTemplateId)
    if (!template) return

    setTitle(template.title)
    setCategoryId(template.category_id && categories.some((category) => category.id === template.category_id)
      ? template.category_id
      : categories[0]?.id ?? '')
    setAllDay(template.all_day)
    setStartTime(template.start_time?.slice(0, 5) ?? currentTimeInZone(household.timezone))
    setEndTime(template.end_time?.slice(0, 5) ?? addMinutesToTime(template.start_time?.slice(0, 5) ?? currentTimeInZone(household.timezone), 60))
    setLocationText(template.location_text ?? '')
  }

  function navigate(direction: -1 | 1) {
    if (view === 'day') setAnchor(addDays(anchor, direction))
    else if (view === 'week') setAnchor(addDays(anchor, 7 * direction))
    else if (view === 'upcoming') setAnchor(addDays(anchor, 30 * direction))
    else setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1))
  }

  function toolbarTitle() {
    if (view === 'day') {
      return anchor.toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    }

    if (view === 'week') {
      const start = weekDays[0]
      const end = weekDays[6]
      return start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
        + ' – '
        + end.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    }

    if (view === 'upcoming') return 'Next 60 days'

    return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }

  async function save(event: FormEvent) {
    if (editingExternalReadOnly) {
      event.preventDefault()
      return
    }
    event.preventDefault()
    if (!canWrite || !composerDate || !title.trim() || !calendars.length) return

    setSaving(true)
    setError('')

    const effectiveEndDate = endDate || composerDate

    if (effectiveEndDate < composerDate) {
      setSaving(false)
      setError('End date cannot be before the start date.')
      return
    }

    let persistedStartDate=composerDate
    let persistedEndDate=effectiveEndDate

    if(editingEventId && editingRecurring && editingBaseStartDate && editingOccurrenceInitialDate){
      const shift=daysBetweenDateKeys(editingOccurrenceInitialDate,composerDate)
      persistedStartDate=shiftDateKey(editingBaseStartDate,shift)

      if(editingBaseEndDate){
        const occurrenceDurationDays=daysBetweenDateKeys(composerDate,effectiveEndDate)
        persistedEndDate=shiftDateKey(persistedStartDate,occurrenceDurationDays)
      }
    }

    const startAt = allDay
      ? null
      : new Date(persistedStartDate + 'T' + startTime + ':00').toISOString()
    const endAt = allDay
      ? null
      : new Date(persistedEndDate + 'T' + endTime + ':00').toISOString()

    if (!allDay && endAt && startAt && new Date(endAt) <= new Date(startAt)) {
      setSaving(false)
      setError('Event end must be later than the start.')
      return
    }

    const dateObject = new Date(composerDate + 'T12:00:00')
    const weekdayCode = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][dateObject.getDay()]
    let rrule: string | null = null

    if (repeatType !== 'none') {
      const parts = [
        'FREQ=' + repeatType.toUpperCase(),
        'INTERVAL=' + repeatInterval,
      ]

      if (repeatType === 'weekly') {
        const days = repeatDays.length ? repeatDays : [weekdayCode]
        parts.push('BYDAY=' + days.join(','))
      }

      if (repeatUntil) parts.push('UNTIL=' + repeatUntil.replaceAll('-', ''))
      rrule = parts.join(';')
    }

    const reminders = notificationEnabled
      ? participantIds.map((profileId) => reminderValue === 'morning'
        ? {
            profile_id: profileId,
            reminder_kind: 'morning_of',
            offset_minutes: null,
            exact_at: null,
            morning_time: '08:00:00',
            delivery_channel: 'push',
            enabled: true,
          }
        : {
            profile_id: profileId,
            reminder_kind: 'offset',
            offset_minutes: Number(reminderValue),
            exact_at: null,
            morning_time: null,
            delivery_channel: 'push',
            enabled: true,
          })
      : []

    const result = await supabase.rpc('save_event_v1', {
      p_event_id: editingEventId,
      p_household_id: household.id,
      p_calendar_id: editingCalendarId ?? calendars.find((item) => item.is_default)?.id ?? calendars[0].id,
      p_title: title.trim(),
      p_description: description.trim() || null,
      p_all_day: allDay,
      p_start_at: startAt,
      p_end_at: endAt,
      p_start_date: allDay ? persistedStartDate : null,
      p_end_date: allDay ? persistedEndDate : null,
      p_timezone: household.timezone,
      p_location_text: locationText.trim() || null,
      p_category_id: categoryId || null,
      p_visibility: 'household',
      p_participants: participantIds.map((profileId) => ({
        profile_id: profileId,
        participant_role: 'participant',
        can_edit: false,
      })),
      p_rrule: rrule,
      p_reminders: reminders,
    })

    setSaving(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    if (saveTemplate && !editingEventId) {
      const templateResult = await supabase.from('event_templates').insert({
        household_id: household.id,
        name: title.trim(),
        title: title.trim(),
        category_id: categoryId || null,
        all_day: allDay,
        start_time: allDay ? null : startTime + ':00',
        end_time: allDay ? null : endTime + ':00',
        location_text: locationText.trim() || null,
      })

      if (templateResult.error) {
        setError(templateResult.error.message)
        return
      }
    }

    closeComposer()
    await load()
  }

  function EventPill({ item, detailed = false }: { item: CalendarOccurrence; detailed?: boolean }) {
    const category = item.category_id ? categoriesById.get(item.category_id) : undefined
    const calendar = calendarsById.get(item.calendar_id)
    const color = categoryColor(category?.color_key ?? calendar?.color_key ?? 'slate')

    return (
      <div
        className={detailed ? 'calendar-event-detail' : 'calendar-event-pill'}
        style={detailed ? undefined : { backgroundColor: color, color: '#fff' }}
        key={item.occurrence_key}
        role={canWrite ? 'button' : undefined}
        tabIndex={canWrite ? 0 : undefined}
        onClick={(event) => {
          event.stopPropagation()
          if (canWrite) void openEventEditor(item)
        }}
        onKeyDown={(event) => {
          if (!canWrite) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            event.stopPropagation()
            void openEventEditor(item)
          }
        }}
        aria-label={canWrite ? 'Open event ' + item.title : undefined}
      >
        <span className="calendar-event-dot" style={{ backgroundColor: color }} />
        <span className="calendar-event-text">
          <strong>{item.title}</strong>
          {detailed && <small>{eventTime(item, household.time_format)}{calendar ? ' · ' + calendar.name : ''}{category ? ' · ' + category.name : ''}</small>}
          {detailed && item.location_text && (
            <GoogleMapsLink location={item.location_text} className="calendar-location-link" />
          )}
        </span>
      </div>
    )
  }

  return (
    <div className="page calendar-page">
      <div className="page-label">CALENDAR</div>

      <nav className="calendar-view-tabs" aria-label="Calendar view">
        {(['day', 'week', 'month', 'upcoming'] as CalendarView[]).map((item) => (
          <button
            type="button"
            className={view === item ? 'active' : ''}
            key={item}
            onClick={() => {
              setView(item)
              if (item === 'upcoming') {
                setAnchor(new Date())
                setUpcomingDays(30)
              }
            }}
          >
            {item === 'upcoming' ? 'Upcoming' : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>

      <section className={view === 'upcoming' ? 'calendar-toolbar upcoming-calendar-toolbar' : 'calendar-toolbar'}>
        <button className="icon-button" aria-label="Previous period" onClick={() => navigate(-1)}>
          <ChevronLeft size={18} />
        </button>

        <h2>{toolbarTitle()}</h2>

        <button className="icon-button" aria-label="Next period" onClick={() => navigate(1)}>
          <ChevronRight size={18} />
        </button>

        <button className="secondary-button compact" onClick={() => setAnchor(new Date())}>
          Today
        </button>

        <button className="secondary-button compact" onClick={() => routeNavigate('/app/calendar/connections')}>
          <CalendarSync size={15}/>
          Work import
        </button>

        {canWrite ? (
          <button className="primary-button compact" onClick={() => openComposer(dateKey(new Date()))}>
            <Plus size={17} />
            Event
          </button>
        ) : (
          <span className="read-only-chip">Read only</span>
        )}
      </section>

      <section className="mobile-calendar-action-panel" aria-label="Mobile calendar actions">
        <div className="mobile-calendar-primary-row">
          <div className="mobile-calendar-layer-scroll">
            {calendars.map((calendar)=> {
              const visible=!hiddenCalendarIds.includes(calendar.id)
              return (
                <button
                  type="button"
                  className={visible ? 'calendar-layer-chip active' : 'calendar-layer-chip'}
                  key={'mobile-'+calendar.id}
                  onClick={()=>setHiddenCalendarIds((current)=>
                    visible ? [...current,calendar.id] : current.filter((id)=>id!==calendar.id)
                  )}
                  aria-pressed={visible}
                >
                  {visible ? <Eye size={13}/> : <EyeOff size={13}/>}
                  <span className="calendar-layer-dot" style={{ backgroundColor:categoryColor(calendar.color_key) }}/>
                  <span>{calendar.name}</span>
                  {calendar.is_default && <small>Default</small>}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            className={calendarSearchOpen ? 'icon-button mobile-calendar-search-button active' : 'icon-button mobile-calendar-search-button'}
            aria-label="Search calendar"
            aria-expanded={calendarSearchOpen}
            onClick={()=>{
              setCalendarSearchOpen((current)=>!current)
              if(calendarSearchOpen) setCalendarSearchQuery('')
            }}
          >
            <Search size={17}/>
          </button>
          {canWrite ? (
            <button className="primary-button compact mobile-calendar-event-button" onClick={() => openComposer(dateKey(new Date()))}>
              <Plus size={17} />
              Event
            </button>
          ) : (
            <span className="read-only-chip">Read only</span>
          )}
        </div>

        {calendarSearchOpen && (
          <div className="mobile-calendar-search">
            <Search size={16}/>
            <input
              value={calendarSearchQuery}
              onChange={(event)=>setCalendarSearchQuery(event.target.value)}
              placeholder="Search events, calendars or categories"
              aria-label="Search calendar events"
              autoFocus
            />
            {calendarSearchQuery && (
              <button type="button" onClick={()=>setCalendarSearchQuery('')} aria-label="Clear calendar search">
                <X size={15}/>
              </button>
            )}
          </div>
        )}

        <div className="mobile-calendar-secondary-row">
          <button className="secondary-button compact" onClick={() => routeNavigate('/app/calendar/connections')}>
            <CalendarSync size={15}/>
            Work import
          </button>
          {canWrite && (
            <button type="button" className="secondary-button compact" onClick={()=>setCalendarManagerOpen(true)}>
              <Settings2 size={14}/>
              Manage calendars
            </button>
          )}
        </div>
      </section>

      <section className="calendar-layer-bar" aria-label="Calendar visibility">
        <div className="calendar-layer-list">
          {calendars.map((calendar)=> {
            const visible=!hiddenCalendarIds.includes(calendar.id)
            return (
              <button
                type="button"
                className={visible ? 'calendar-layer-chip active' : 'calendar-layer-chip'}
                key={calendar.id}
                onClick={()=>setHiddenCalendarIds((current)=>
                  visible ? [...current,calendar.id] : current.filter((id)=>id!==calendar.id)
                )}
                aria-pressed={visible}
              >
                {visible ? <Eye size={13}/> : <EyeOff size={13}/>}
                <span className="calendar-layer-dot" style={{ backgroundColor:categoryColor(calendar.color_key) }}/>
                <span>{calendar.name}</span>
                {calendar.is_default && <small>Default</small>}
              </button>
            )
          })}
        </div>
        {canWrite && (
          <button type="button" className="secondary-button compact calendar-manage-button" onClick={()=>setCalendarManagerOpen(true)}>
            <Settings2 size={14}/>Manage calendars
          </button>
        )}
      </section>

      {error && <div className="notice error">{error}</div>}

      {view === 'month' && (
        <section className="month-calendar">
          {weekdayNames.map((name) => (
            <div className="calendar-weekday" key={name}>{name}</div>
          ))}

          {monthGrid.map((day) => {
            const key = dateKey(day)
            const inMonth = day.getMonth() === anchor.getMonth()
            const today = key === dateKey(new Date())
            const dayEvents = eventsByDay.get(key) ?? []

            return (
              <div
                className={'calendar-day ' + (inMonth ? '' : 'outside ') + (today ? 'today ' : '') + (!canWrite ? 'read-only' : '')}
                key={key}
                onClick={() => openComposer(key)}
              >
                <span className="calendar-day-number">{day.getDate()}</span>
                <span className="calendar-day-events" onClick={(event) => event.stopPropagation()}>
                  {dayEvents.map((item) => <EventPill item={item} key={item.occurrence_key} />)}
                </span>
              </div>
            )
          })}
        </section>
      )}

      {view === 'week' && (
        <>
          <section className="mobile-week-calendar">
            <div className="mobile-week-strip" aria-label="Week days">
              {weekDays.map((day)=>{
                const key=dateKey(day)
                const selected=key===dateKey(anchor)
                const today=key===dateKey(new Date())
                return (
                  <button
                    type="button"
                    className={(selected?'selected ':'')+(today?'today':'')}
                    key={'strip-'+key}
                    onClick={()=>setAnchor(day)}
                  >
                    <small>{day.toLocaleDateString(undefined,{ weekday:'narrow' })}</small>
                    <strong>{day.getDate()}</strong>
                  </button>
                )
              })}
            </div>

            <div className="mobile-week-agenda">
              {weekDays.map((day)=>{
                const key=dateKey(day)
                const dayEvents=eventsByDay.get(key)??[]
                const today=key===dateKey(new Date())
                return (
                  <article className={today?'mobile-week-day today':'mobile-week-day'} key={'agenda-'+key}>
                    <header>
                      <div>
                        <strong>{day.toLocaleDateString(undefined,{ weekday:'long' })}</strong>
                        <span>{day.toLocaleDateString(undefined,{ day:'numeric',month:'long' })}</span>
                      </div>
                      {canWrite && (
                        <button type="button" onClick={()=>openComposer(key)} aria-label={'Add event on '+day.toLocaleDateString()}>
                          <Plus size={22}/>
                        </button>
                      )}
                    </header>
                    <div className="mobile-week-day-events">
                      {dayEvents.length
                        ? dayEvents.map((item)=><EventPill item={item} detailed key={item.occurrence_key}/>)
                        : <span className="mobile-week-empty">Nothing planned</span>}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>

          <section className="week-calendar desktop-week-calendar">
            {weekDays.map((day) => {
              const key = dateKey(day)
              const dayEvents = eventsByDay.get(key) ?? []
              const today = key === dateKey(new Date())

              return (
                <article className={today ? 'week-day today' : 'week-day'} key={key}>
                  <button type="button" className="week-day-head" onClick={() => openComposer(key)} disabled={!canWrite}>
                    <small>{day.toLocaleDateString(undefined, { weekday: 'short' })}</small>
                    <strong>{day.getDate()}</strong>
                  </button>
                  <div className="week-day-events">
                    {dayEvents.length
                      ? dayEvents.map((item) => <EventPill item={item} detailed key={item.occurrence_key} />)
                      : <span className="calendar-empty-mini">No events</span>}
                  </div>
                </article>
              )
            })}
          </section>
        </>
      )}

      {view === 'day' && (
        <section className="day-calendar">
          <header>
            <div>
              <span>{anchor.toLocaleDateString(undefined, { weekday: 'long' })}</span>
              <strong>{anchor.getDate()}</strong>
            </div>
            {canWrite && (
              <button className="primary-button compact" onClick={() => openComposer(dateKey(anchor))}>
                <Plus size={15} />
                Add event
              </button>
            )}
          </header>

          {allDayEvents.length > 0 && (
            <div className="day-all-day-row">
              <span>All day</span>
              <div>
                {allDayEvents.map((item) => <EventPill item={item} detailed key={item.occurrence_key} />)}
              </div>
            </div>
          )}

          <div className="day-hour-grid">
            {dayHours.map((hour) => {
              const hourEvents = timedEventsByHour.get(hour) ?? []
              const label = String(hour).padStart(2, '0') + ':00'

              return (
                <div className="day-hour-row" key={hour}>
                  <button
                    type="button"
                    className="day-hour-label"
                    disabled={!canWrite}
                    onClick={() => openComposer(dateKey(anchor), label)}
                  >
                    {label}
                  </button>
                  <div className="day-hour-content">
                    {hourEvents.map((item) => <EventPill item={item} detailed key={item.occurrence_key} />)}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {view === 'upcoming' && (
        <section className="upcoming-calendar">
          {upcomingDayList.map((day,index) => {
            const key=dateKey(day)
            const dayEvents=eventsByDay.get(key)??[]
            const today=index===0

            return (
              <article className={today ? 'upcoming-day today' : 'upcoming-day'} key={key}>
                <div className="upcoming-date">
                  <strong>{today ? 'Today' : day.getDate()}</strong>
                  <span>{day.toLocaleDateString(undefined, { weekday: 'short', month: 'short' })}</span>
                </div>
                <div className="upcoming-events">
                  {dayEvents.length
                    ? dayEvents.map((item) => <EventPill item={item} detailed key={item.occurrence_key} />)
                    : <span className="upcoming-empty-day">Nothing planned</span>}
                </div>
              </article>
            )
          })}

          {upcomingDays === 30 && (
            <button type="button" className="secondary-button upcoming-load-more" onClick={()=>setUpcomingDays(60)}>
              <Plus size={15}/>Load next 30 days
            </button>
          )}
        </section>
      )}

      {composerDate && canWrite && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeComposer()
          }}
        >
          <form className="modal-card event-composer" onSubmit={save}>
            <header>
              <div>
                <span className="eyebrow">{editingExternalReadOnly ? 'SYNCED EVENT' : editingEventId ? 'EDIT EVENT' : 'NEW EVENT'}</span>
                <h2>
                  {new Date(composerDate + 'T12:00:00').toLocaleDateString(undefined, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close event form" onClick={closeComposer}>
                <X size={18} />
              </button>
            </header>

            {editingExternalReadOnly && (
              <div className="external-event-notice">
                <LockKeyhole size={16}/>
                <span>
                  <strong>Synced read-only event</strong>
                  <small>{editingExternalSource || 'External calendar'} · Source event details are managed by the connected calendar. Famioo links below remain available.</small>
                </span>
              </div>
            )}

            {!editingEventId && (
              <label>
                Start from template
                <Select
                  value={templateId}
                  onChange={applyTemplate}
                  placeholder="Blank event"
                  options={[
                    { value: '', label: 'Blank event' },
                    ...templates.map((template) => ({ value: template.id, label: template.name })),
                  ]}
                  ariaLabel="Choose event template"
                />
              </label>
            )}

            <label>
              Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus={!editingExternalReadOnly} readOnly={editingExternalReadOnly} required />
            </label>

            <div className="composer-grid-two">
              <label>
                Start date
                <DatePicker
                  value={composerDate}
                  onChange={changeComposerStartDate}
                  format={household.date_format}
                  ariaLabel="Choose event start date"
                  disabled={editingExternalReadOnly}
                />
              </label>

              <label>
                End date
                <DatePicker
                  value={endDate || composerDate}
                  onChange={setEndDate}
                  min={composerDate}
                  format={household.date_format}
                  ariaLabel="Choose event end date"
                  disabled={editingExternalReadOnly}
                />
              </label>
            </div>

            <label>
              Description
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional details"
                readOnly={editingExternalReadOnly}
              />
            </label>

            <label>
              Calendar
              <Select
                value={editingCalendarId ?? calendars.find((item)=>item.is_default)?.id ?? calendars[0]?.id ?? ''}
                onChange={setEditingCalendarId}
                options={calendars.map((item)=>({
                  value:item.id,
                  label:item.name + (item.is_default ? ' · Default' : ''),
                  dotColor:categoryColor(item.color_key),
                }))}
                ariaLabel="Choose calendar"
                disabled={editingExternalReadOnly}
              />
            </label>

            <div className="category-all-day-row">
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
                  ariaLabel="Choose event category"
                  disabled={editingExternalReadOnly}
                />
              </label>

              <label className="all-day-control">
                <input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} disabled={editingExternalReadOnly} />
                <span>All day</span>
              </label>
            </div>

            {!allDay && (
              <div className="composer-grid-two time-range-row">
                <label>
                  Start time
                  <TimePicker value={startTime} onChange={setStartTime} disabled={editingExternalReadOnly} />
                </label>

                <label>
                  End time
                  <TimePicker value={endTime} onChange={setEndTime} disabled={editingExternalReadOnly} />
                </label>
              </div>
            )}

            <label>
              Location
              <input
                value={locationText}
                onChange={(event) => setLocationText(event.target.value)}
                placeholder="Optional location"
                readOnly={editingExternalReadOnly}
              />
              {locationText.trim() && <GoogleMapsLink location={locationText} label="Open in Google Maps" className="field-map-link" />}
            </label>

            <div className="composer-grid-two">
              <label>
                Repeat
                <Select
                  value={repeatType}
                  onChange={(value) => setRepeatType(value as typeof repeatType)}
                  options={[
                    { value: 'none', label: 'Does not repeat' },
                    { value: 'daily', label: 'Daily' },
                    { value: 'weekly', label: 'Weekly' },
                    { value: 'monthly', label: 'Monthly' },
                  ]}
                  ariaLabel="Repeat event"
                  disabled={editingExternalReadOnly}
                />
              </label>

              {repeatType !== 'none' && (
                <label>
                  Repeat every
                  <Select
                    value={repeatInterval}
                    onChange={setRepeatInterval}
                    options={Array.from({ length: 12 }, (_, index) => {
                      const value = String(index + 1)
                      const unit = repeatType === 'daily'
                        ? 'day'
                        : repeatType === 'weekly'
                          ? 'week'
                          : 'month'
                      return {
                        value,
                        label: value + ' ' + unit + (value === '1' ? '' : 's'),
                      }
                    })}
                    ariaLabel="Repeat interval"
                    disabled={editingExternalReadOnly}
                  />
                </label>
              )}
            </div>

            {repeatType === 'weekly' && (
              <fieldset className="repeat-weekday-fieldset">
                <legend>Repeat on</legend>
                <div className="repeat-weekday-grid">
                  {[
                    ['MO', 'Mon'],
                    ['TU', 'Tue'],
                    ['WE', 'Wed'],
                    ['TH', 'Thu'],
                    ['FR', 'Fri'],
                    ['SA', 'Sat'],
                    ['SU', 'Sun'],
                  ].map(([code, label]) => (
                    <button
                      type="button"
                      className={repeatDays.includes(code) ? 'active' : ''}
                      key={code}
                      disabled={editingExternalReadOnly}
                      onClick={() => setRepeatDays((current) => current.includes(code)
                        ? current.filter((item) => item !== code)
                        : [...current, code])}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {repeatType !== 'none' && (
              <label>
                Repeat until
                <DatePicker
                  value={repeatUntil}
                  onChange={setRepeatUntil}
                  min={composerDate}
                  format={household.date_format}
                  ariaLabel="Choose repeat end date"
                  disabled={editingExternalReadOnly}
                />
                <small className="field-hint">Optional. Leave blank for no end date.</small>
              </label>
            )}

            {editingExternalReadOnly ? (
              <div className="external-event-local-note">
                Notifications for this synced event stay with the source calendar. Famioo-local linked items can still be added below.
              </div>
            ) : (
              <fieldset className="calendar-reminder-fieldset">
                <legend>Notification</legend>
  
                <label className="composer-option">
                  <input
                    type="checkbox"
                    checked={notificationEnabled}
                    onChange={(event) => setNotificationEnabled(event.target.checked)}
                  />
                  <span>
                    <span>Notify participants</span>
                    <small>Send a push reminder to selected participants who have Famioo login access and push notifications enabled.</small>
                  </span>
                </label>
  
                {notificationEnabled && (
                  <label className="calendar-reminder-select">
                    Remind
                    <Select
                      value={reminderValue}
                      onChange={(value) => setReminderValue(value as typeof reminderValue)}
                      options={[
                        { value: 'morning', label: 'Morning of event · 08:00' },
                        { value: '0', label: 'At event time' },
                        { value: '10', label: '10 minutes before' },
                        { value: '30', label: '30 minutes before' },
                        { value: '60', label: '1 hour before' },
                        { value: '1440', label: '1 day before' },
                      ]}
                      ariaLabel="Choose calendar reminder time"
                    />
                  </label>
                )}
  
                {notificationEnabled && participantIds.length === 0 && (
                  <small className="field-hint">Choose at least one participant to receive this reminder.</small>
                )}
              </fieldset>
            )}

            {editingEventId && (
              <div className="event-module-connections">
                {moduleConnectionState(modules, 'calendar', 'projects') === 'active' && (
                  <section className="event-connection-card">
                    <div className="event-connection-head">
                      <span><FolderKanban size={15} /><strong>Projects & Chores</strong></span>
                      <small>Keep this Calendar event as the main item and add a points-only linked responsibility.</small>
                    </div>
                    <div className="event-connection-actions">
                      <button type="button" className="secondary-button compact event-link-button" disabled={!canWriteProjects} onClick={() => openProjectsConnection('project_task')}>
                        {seriesRules.some((item)=>item.item_kind==='project_task' && item.active)
                          ? 'Edit project rule'
                          : linkedWorkItems.some((item) => item.item_kind === 'project_task' && item.source_event_occurrence_key===editingOccurrence?.occurrence_key)
                            ? 'Edit project'
                            : 'Add project'}
                      </button>
                      <button type="button" className="secondary-button compact event-link-button" disabled={!canWriteProjects} onClick={() => openProjectsConnection('chore')}>
                        {seriesRules.some((item)=>item.item_kind==='chore' && item.active)
                          ? 'Edit chore rule'
                          : linkedWorkItems.some((item) => item.item_kind === 'chore' && item.source_event_occurrence_key===editingOccurrence?.occurrence_key)
                            ? 'Edit chore'
                            : 'Add chore'}
                      </button>
                    </div>

                    {projectScopeKind && (
                      <div className="event-project-scope">
                        <span>
                          <strong>Apply to</strong>
                          <small>Choose whether points apply only to this date or automatically to every future occurrence.</small>
                        </span>
                        <div>
                          <button type="button" className="secondary-button compact" onClick={()=>navigateProjectsConnection(projectScopeKind,'one')}>Only this occurrence</button>
                          <button type="button" className="primary-button compact" onClick={()=>navigateProjectsConnection(projectScopeKind,'series')}>All occurrences</button>
                          <button type="button" className="icon-button compact-icon" onClick={()=>setProjectScopeKind(null)} aria-label="Close occurrence choice"><X size={14}/></button>
                        </div>
                      </div>
                    )}
                  </section>
                )}

                {moduleConnectionState(modules, 'calendar', 'checklists') === 'active' && (
                  <details className="event-linked-details">
                    <summary>
                      <span><ClipboardCheck size={15} />Checklists</span>
                      <span>{linkedChecklists.length}<ChevronDown size={14} /></span>
                    </summary>
                    <div className="event-linked-details-body">
                      {linkedChecklists.length ? linkedChecklists.map((list) => (
                        <div className="event-linked-checklist" key={list.id}>
                          <strong>{list.title}</strong>
                          {list.items.length ? list.items.map((item) => (
                            <button
                              type="button"
                              className={'event-linked-check-item ' + (item.checked ? 'checked' : '')}
                              key={item.id}
                              disabled={!canWriteChecklists}
                              onClick={() => void toggleLinkedChecklistItem(item)}
                            >
                              <span>{item.checked ? '✓' : ''}</span>
                              {item.item_text}
                            </button>
                          )) : <small>No checklist items yet.</small>}
                        </div>
                      )) : <small>No checklist is linked to this event.</small>}
                    </div>
                  </details>
                )}

                {moduleConnectionState(modules, 'calendar', 'costs') === 'active' && (
                  <details className="event-linked-details">
                    <summary>
                      <span><WalletCards size={15} />Household costs</span>
                      <span>
                        {linkedCosts.length
                          ? '€' + linkedCosts.reduce((sum,row) => sum + Number(row.amount),0).toFixed(2)
                          : 'None'}
                        <ChevronDown size={14} />
                      </span>
                    </summary>
                    <div className="event-linked-details-body">
                      {linkedCosts.map((cost) => (
                        <div className="event-cost-row" key={cost.id}>
                          <span>{cost.title}</span>
                          <strong>€{Number(cost.amount).toFixed(2)}</strong>
                        </div>
                      ))}
                      {canWriteCosts && (
                        <div className="event-cost-add">
                          <input value={eventCostTitle} onChange={(event) => setEventCostTitle(event.target.value)} placeholder="Cost name" />
                          <div className="money-input">
                            <span>€</span>
                            <input inputMode="decimal" value={eventCostAmount} onChange={(event) => setEventCostAmount(event.target.value)} placeholder="0.00" />
                          </div>
                          <button type="button" className="secondary-button compact" disabled={eventCostSaving || !eventCostAmount.trim()} onClick={() => void addEventCost()}>
                            {eventCostSaving ? 'Adding…' : 'Add cost'}
                          </button>
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </div>
            )}

            {!editingExternalReadOnly && (
              <fieldset className="participant-fieldset event-participants-box">
                <legend>Participants</legend>
                <div className="profile-choice-grid">
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
                      <ProfileAvatar
                        avatarPath={profile.avatar_path}
                        name={profile.display_name}
                        size="sm"
                      />
                      <span className="profile-choice-name">{firstName(profile.display_name)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {!editingEventId && (
              <div className="composer-option-list">
                <label className="composer-option">
                  <input type="checkbox" checked={saveTemplate} onChange={(event) => setSaveTemplate(event.target.checked)} />
                  <span>
                    <span>Save as event template</span>
                    <small>Reuse this event setup later and manage it in Settings → Templates.</small>
                  </span>
                </label>
              </div>
            )}

            {error && <div className="form-message error">{error}</div>}

            {editingEventId && !editingExternalReadOnly && deleteOptionsOpen && editingRecurring && (
              <div className="event-delete-options">
                <strong>Which occurrence should be deleted?</strong>
                <div>
                  <button type="button" className="secondary-button compact danger-button" disabled={deleting} onClick={() => requestDelete('one')}>Only this occurrence</button>
                  <button type="button" className="secondary-button compact danger-button" disabled={deleting} onClick={() => requestDelete('future')}>This & future</button>
                  <button type="button" className="secondary-button compact danger-button" disabled={deleting} onClick={() => requestDelete('all')}>All occurrences</button>
                </div>
              </div>
            )}

            <div className="event-composer-actions">
              {editingExternalReadOnly ? (
                <button type="button" className="secondary-button compact" onClick={closeComposer}>
                  Close
                </button>
              ) : (
                <>
                  {editingEventId && (
                    <button
                      type="button"
                      className="secondary-button compact danger-button event-delete-button"
                      disabled={saving || deleting}
                      onClick={() => editingRecurring ? setDeleteOptionsOpen((current) => !current) : requestDelete('all')}
                    >
                      <Trash2 size={14} />
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                  )}

                  <button className="primary-button compact event-save-button" disabled={saving || deleting}>
                    {saving ? 'Saving…' : editingEventId ? 'Save changes' : 'Save event'}
                  </button>
                </>
              )}
            </div>
          </form>
        </div>
      )}

      {calendarManagerOpen && canWrite && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event)=>{
            if(event.currentTarget===event.target && !calendarSaving){
              setCalendarManagerOpen(false)
              resetCalendarEditor()
            }
          }}
        >
          <section className="modal-card calendar-manager-modal">
            <header>
              <div>
                <span className="eyebrow">CALENDARS</span>
                <h2>Manage calendars</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close Calendar manager" onClick={()=>{
                setCalendarManagerOpen(false)
                resetCalendarEditor()
              }}>
                <X size={18}/>
              </button>
            </header>

            <div className="calendar-manager-list">
              {calendars.map((calendar)=>(
                <div className="calendar-manager-row" key={calendar.id}>
                  <span className="calendar-manager-color" style={{ backgroundColor:categoryColor(calendar.color_key) }}/>
                  <div>
                    <strong>{calendar.name}</strong>
                    <small>{calendar.is_default ? 'Default calendar' : 'Household calendar'}</small>
                  </div>
                  <div className="calendar-manager-actions">
                    {!calendar.is_default && (
                      <button type="button" className="secondary-button compact" disabled={calendarSaving} onClick={()=>void makeDefaultCalendar(calendar.id)}>
                        Make default
                      </button>
                    )}
                    <button type="button" className="icon-button compact-icon" onClick={()=>editCalendar(calendar)} aria-label={'Edit '+calendar.name}>
                      <Pencil size={14}/>
                    </button>
                    {!calendar.is_default && calendars.length>1 && (
                      <button type="button" className="icon-button compact-icon danger-icon-button" disabled={calendarSaving} onClick={()=>void archiveManagedCalendar(calendar.id)} aria-label={'Archive '+calendar.name}>
                        <Archive size={14}/>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <form className="calendar-manager-form" onSubmit={saveManagedCalendar}>
              <span className="eyebrow">{calendarEditingId ? 'EDIT CALENDAR' : 'NEW CALENDAR'}</span>
              <div className="composer-grid-two aligned-field-row">
                <label>
                  Name
                  <input value={calendarName} onChange={(event)=>setCalendarName(event.target.value)} placeholder="e.g. Work" required/>
                </label>
                <label>
                  Color
                  <Select
                    value={calendarColorKey}
                    onChange={setCalendarColorKey}
                    options={calendarColorOptions.map((item)=>({
                      ...item,
                      dotColor:categoryColor(item.value),
                    }))}
                    ariaLabel="Choose calendar color"
                  />
                </label>
              </div>
              <div className="calendar-manager-form-actions">
                {calendarEditingId && (
                  <button type="button" className="secondary-button compact" onClick={resetCalendarEditor}>Cancel edit</button>
                )}
                <button className="primary-button compact" disabled={calendarSaving || !calendarName.trim()}>
                  {calendarSaving?'Saving…':calendarEditingId?'Save calendar':'Add calendar'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteRequest)}
        title={deleteRequest==='one' ? 'Delete this occurrence?' : deleteRequest==='future' ? 'Delete this and future occurrences?' : editingRecurring ? 'Delete all occurrences?' : 'Delete event?'}
        message={deleteRequest==='one'
          ? 'Only this date will be removed. The remaining recurring dates stay in Calendar.'
          : deleteRequest==='future'
            ? 'This date and every later occurrence in the series will be removed.'
            : editingRecurring
              ? 'The complete recurring event series will be removed.'
              : 'This Calendar event will be removed.'}
        confirmLabel="Delete"
        danger
        busy={deleting}
        onCancel={()=>setDeleteRequest(null)}
        onConfirm={()=>{ if(deleteRequest) void deleteEvent(deleteRequest) }}
      />
    </div>
  )
}
