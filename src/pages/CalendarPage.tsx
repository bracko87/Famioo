import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useHousehold } from '../context/HouseholdContext'
import { categoryColor } from '../lib/categoryColors'
import { supabase } from '../lib/supabase'
import type { CalendarOccurrence, CalendarRow, EventCategory } from '../lib/types'

type CalendarView = 'day' | 'week' | 'month' | 'upcoming'

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
  const [composerDate, setComposerDate] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [allDay, setAllDay] = useState(true)
  const [startTime, setStartTime] = useState('18:00')
  const [categoryId, setCategoryId] = useState('')
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const range = useMemo(
    () => rangeFor(view, anchor, mondayFirst),
    [view, anchor, mondayFirst],
  )

  async function load() {
    setError('')

    const [occurrences, calendarRows, categoryRows] = await Promise.all([
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
    ])

    if (occurrences.error) setError(occurrences.error.message)
    else setEvents((occurrences.data ?? []) as CalendarOccurrence[])

    if (calendarRows.error) setError((current) => current || calendarRows.error.message)
    else setCalendars((calendarRows.data ?? []) as CalendarRow[])

    if (categoryRows.error) {
      setError((current) => current || categoryRows.error.message)
    } else {
      setCategories((categoryRows.data ?? []) as EventCategory[])
      setCategoryId((current) => current || categoryRows.data?.[0]?.id || '')
    }
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

  const selectedCategory = categoriesById.get(categoryId)

  function openComposer(day: string) {
    if (!canWrite) return
    setComposerDate(day)
    setTitle('')
    setParticipantIds([])
    setError('')
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

    const result = await supabase.rpc('save_event_v1', {
      p_event_id: null,
      p_household_id: household.id,
      p_calendar_id: calendars.find((item) => item.is_default)?.id ?? calendars[0].id,
      p_title: title.trim(),
      p_description: null,
      p_all_day: allDay,
      p_start_at: startAt,
      p_end_at: null,
      p_start_date: allDay ? composerDate : null,
      p_end_date: allDay ? composerDate : null,
      p_timezone: household.timezone,
      p_location_text: null,
      p_category_id: categoryId || null,
      p_visibility: 'household',
      p_participants: participantIds.map((profileId) => ({
        profile_id: profileId,
        participant_role: 'participant',
        can_edit: false,
      })),
      p_rrule: null,
      p_reminders: [],
    })

    setSaving(false)

    if (result.error) {
      setError(result.error.message)
      return
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
            {canWrite && <button className="secondary-button compact" onClick={() => openComposer(dateKey(anchor))}><Plus size={15} />Add event</button>}
          </header>
          <div className="day-event-list">
            {(eventsByDay.get(dateKey(anchor)) ?? []).length
              ? (eventsByDay.get(dateKey(anchor)) ?? []).map((item) => <EventPill item={item} detailed key={item.occurrence_key} />)
              : <div className="empty-state"><strong>No events.</strong><span>Nothing is planned for this day.</span></div>}
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
              Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus required />
            </label>

            <div className="form-row">
              <label>
                Category
                <span className="category-select-wrap">
                  <span className="category-select-dot" style={{ backgroundColor: categoryColor(selectedCategory?.color_key ?? 'slate') }} />
                  <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                    {categories.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </span>
              </label>

              <label className="toggle-label">
                <span>All day</span>
                <input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />
              </label>
            </div>

            {!allDay && (
              <label>
                Start time
                <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required />
              </label>
            )}

            <fieldset>
              <legend>Participants</legend>
              <div className="profile-choice-grid">
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
                    <span>{profile.avatar_emoji ?? profile.display_name.slice(0, 1).toUpperCase()}</span>
                    <strong>{profile.display_name}</strong>
                  </label>
                ))}
              </div>
            </fieldset>

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
