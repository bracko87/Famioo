import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useHousehold } from '../context/HouseholdContext'
import { categoryColor } from '../lib/categoryColors'
import { supabase } from '../lib/supabase'
import type { CalendarOccurrence, CalendarRow, EventCategory } from '../lib/types'
import { Select } from '../components/ui/Select'
import { TimePicker } from '../components/ui/TimePicker'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { DatePicker } from '../components/ui/DatePicker'
import { GoogleMapsLink } from '../components/ui/GoogleMapsLink'
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

export function CalendarPage() {
  const { household, profiles, modules } = useHousehold()
  const calendarAccess = modules.find((module) => module.code === 'calendar')
  const canWrite = Boolean(calendarAccess?.can_write)
  const mondayFirst = household.week_starts_on === 1

  const [view, setView] = useState<CalendarView>('month')
  const [anchor, setAnchor] = useState(() => new Date())
  const [events, setEvents] = useState<CalendarOccurrence[]>([])
  const [calendars, setCalendars] = useState<CalendarRow[]>([])
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [templates, setTemplates] = useState<EventTemplate[]>([])
  const [composerDate, setComposerDate] = useState<string | null>(null)
  const [templateId, setTemplateId] = useState('')
  const [title, setTitle] = useState('')
  const [allDay, setAllDay] = useState(true)
  const [startTime, setStartTime] = useState('18:00')
  const [endTime, setEndTime] = useState('19:00')
  const [categoryId, setCategoryId] = useState('')
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const [locationText, setLocationText] = useState('')
  const [repeatType, setRepeatType] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none')
  const [repeatInterval, setRepeatInterval] = useState('1')
  const [repeatDays, setRepeatDays] = useState<string[]>([])
  const [repeatUntil, setRepeatUntil] = useState('')
  const [saveTemplate, setSaveTemplate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const range = useMemo(
    () => rangeFor(view, anchor, mondayFirst),
    [view, anchor, mondayFirst],
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

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarOccurrence[]>()

    for (const event of events) {
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
  }, [events])

  const monthGrid = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const gridStart = startOfWeek(first, mondayFirst)

    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
  }, [anchor, mondayFirst])

  const weekDays = useMemo(() => {
    const start = startOfWeek(anchor, mondayFirst)
    return Array.from({ length: 7 }, (_, index) => addDays(start, index))
  }, [anchor, mondayFirst])

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

  function openComposer(day: string, timedStart?: string) {
    if (!canWrite) return

    const defaultStart = timedStart ?? currentTimeInZone(household.timezone)
    setComposerDate(day)
    setTemplateId('')
    setTitle('')
    setAllDay(!timedStart)
    setStartTime(defaultStart)
    setEndTime(addMinutesToTime(defaultStart, 60))
    setParticipantIds([])
    setLocationText('')
    setRepeatType('none')
    setRepeatInterval('1')
    setRepeatDays([])
    setRepeatUntil('')
    setSaveTemplate(false)
    setError('')
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
    event.preventDefault()
    if (!canWrite || !composerDate || !title.trim() || !calendars.length) return

    setSaving(true)
    setError('')

    const startAt = allDay
      ? null
      : new Date(composerDate + 'T' + startTime + ':00').toISOString()
    const endAt = allDay
      ? null
      : new Date(composerDate + 'T' + endTime + ':00').toISOString()

    if (!allDay && endAt && startAt && new Date(endAt) <= new Date(startAt)) {
      setSaving(false)
      setError('End time must be later than start time.')
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

    const result = await supabase.rpc('save_event_v1', {
      p_event_id: null,
      p_household_id: household.id,
      p_calendar_id: calendars.find((item) => item.is_default)?.id ?? calendars[0].id,
      p_title: title.trim(),
      p_description: null,
      p_all_day: allDay,
      p_start_at: startAt,
      p_end_at: endAt,
      p_start_date: allDay ? composerDate : null,
      p_end_date: allDay ? composerDate : null,
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
      p_reminders: [],
    })

    setSaving(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    if (saveTemplate) {
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

    setComposerDate(null)
    await load()
  }

  function EventPill({ item, detailed = false }: { item: CalendarOccurrence; detailed?: boolean }) {
    const category = item.category_id ? categoriesById.get(item.category_id) : undefined
    const color = categoryColor(category?.color_key ?? 'slate')

    return (
      <span className={detailed ? 'calendar-event-detail' : 'calendar-event-pill'} key={item.occurrence_key}>
        <span className="calendar-event-dot" style={{ backgroundColor: color }} />
        <span className="calendar-event-text">
          <strong>{item.title}</strong>
          {detailed && <small>{eventTime(item, household.time_format)}{category ? ' · ' + category.name : ''}</small>}
          {detailed && item.location_text && (
            <GoogleMapsLink location={item.location_text} className="calendar-location-link" />
          )}
        </span>
      </span>
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
              if (item === 'upcoming') setAnchor(new Date())
            }}
          >
            {item === 'upcoming' ? 'Upcoming' : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>

      <section className="calendar-toolbar">
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

        {canWrite ? (
          <button className="primary-button compact" onClick={() => openComposer(dateKey(new Date()))}>
            <Plus size={17} />
            Event
          </button>
        ) : (
          <span className="read-only-chip">Read only</span>
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
              <button
                className={'calendar-day ' + (inMonth ? '' : 'outside ') + (today ? 'today ' : '') + (!canWrite ? 'read-only' : '')}
                key={key}
                onClick={() => openComposer(key)}
              >
                <span className="calendar-day-number">{day.getDate()}</span>
                <span className="calendar-day-events">
                  {dayEvents.slice(0, 3).map((item) => <EventPill item={item} key={item.occurrence_key} />)}
                  {dayEvents.length > 3 && <small>+{dayEvents.length - 3} more</small>}
                </span>
              </button>
            )
          })}
        </section>
      )}

      {view === 'week' && (
        <section className="week-calendar">
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
          {events.length === 0 ? (
            <div className="empty-state"><strong>No upcoming events.</strong><span>Nothing is planned in the next 60 days.</span></div>
          ) : Array.from(eventsByDay.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, dayEvents]) => {
            const day = new Date(key + 'T12:00:00')
            return (
              <article className="upcoming-day" key={key}>
                <div className="upcoming-date">
                  <strong>{day.getDate()}</strong>
                  <span>{day.toLocaleDateString(undefined, { weekday: 'short', month: 'short' })}</span>
                </div>
                <div className="upcoming-events">
                  {dayEvents.map((item) => <EventPill item={item} detailed key={item.occurrence_key} />)}
                </div>
              </article>
            )
          })}
        </section>
      )}

      {composerDate && canWrite && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setComposerDate(null)
          }}
        >
          <form className="modal-card event-composer" onSubmit={save}>
            <header>
              <div>
                <span className="eyebrow">NEW EVENT</span>
                <h2>
                  {new Date(composerDate + 'T12:00:00').toLocaleDateString(undefined, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close event form" onClick={() => setComposerDate(null)}>
                <X size={18} />
              </button>
            </header>

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

            <label>
              Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus required />
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
                />
              </label>

              <label className="all-day-control">
                <input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />
                <span>All day</span>
              </label>
            </div>

            {!allDay && (
              <div className="composer-grid-two time-range-row">
                <label>
                  Start time
                  <TimePicker value={startTime} onChange={setStartTime} />
                </label>

                <label>
                  End time
                  <TimePicker value={endTime} onChange={setEndTime} />
                </label>
              </div>
            )}

            <label>
              Location
              <input
                value={locationText}
                onChange={(event) => setLocationText(event.target.value)}
                placeholder="Optional location"
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
                />
                <small className="field-hint">Optional. Leave blank for no end date.</small>
              </label>
            )}

            <fieldset className="participant-fieldset">
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

            <div className="composer-option-list">
              <label className="composer-option">
                <input type="checkbox" checked={saveTemplate} onChange={(event) => setSaveTemplate(event.target.checked)} />
                <span>
                  <span>Save as event template</span>
                  <small>Reuse this event setup later and manage it in Settings → Templates.</small>
                </span>
              </label>
            </div>

            {error && <div className="form-message error">{error}</div>}
            <button className="primary-button" disabled={saving}>
              {saving ? 'Saving…' : 'Save event'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
