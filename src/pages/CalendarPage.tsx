import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'
import type { CalendarOccurrence, CalendarRow, EventCategory } from '../lib/types'

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return year + '-' + month + '-' + day
}

function monthRange(anchor: Date) {
  return {
    start: dateKey(new Date(anchor.getFullYear(), anchor.getMonth(), 1)),
    end: dateKey(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)),
  }
}

export function CalendarPage() {
  const { household, profiles } = useHousehold()
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

  const range = useMemo(() => monthRange(anchor), [anchor])

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

  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const gridStart = new Date(first)
  gridStart.setDate(first.getDate() - ((first.getDay() + 6) % 7))

  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart)
    day.setDate(gridStart.getDate() + index)
    return day
  })

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarOccurrence[]>()
    for (const event of events) {
      const key = event.all_day
        ? event.occurrence_start_date
        : event.occurrence_start_at?.slice(0, 10)

      if (!key) continue
      map.set(key, [...(map.get(key) ?? []), event])
    }
    return map
  }, [events])

  function openComposer(day: string) {
    setComposerDate(day)
    setTitle('')
    setParticipantIds([])
    setError('')
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!composerDate || !title.trim() || !calendars.length) return

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

  return (
    <div className="page calendar-page">
      <section className="page-heading calendar-heading">
        <div>
          <span className="eyebrow">CALENDAR</span>
          <h1>Family calendar</h1>
          <p>One shared calendar foundation, isolated to {household.name}.</p>
        </div>
        <button className="primary-button compact" onClick={() => openComposer(dateKey(new Date()))}>
          <Plus size={17} />
          Event
        </button>
      </section>

      <section className="calendar-toolbar">
        <button
          className="icon-button"
          aria-label="Previous month"
          onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))}
        >
          <ChevronLeft size={18} />
        </button>
        <h2>{anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
        <button
          className="icon-button"
          aria-label="Next month"
          onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))}
        >
          <ChevronRight size={18} />
        </button>
        <button className="secondary-button compact" onClick={() => setAnchor(new Date())}>
          Today
        </button>
      </section>

      {error && <div className="notice error">{error}</div>}

      <section className="month-calendar">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((name) => (
          <div className="calendar-weekday" key={name}>{name}</div>
        ))}

        {days.map((day) => {
          const key = dateKey(day)
          const inMonth = day.getMonth() === anchor.getMonth()
          const today = key === dateKey(new Date())
          const dayEvents = eventsByDay.get(key) ?? []

          return (
            <button
              className={'calendar-day ' + (inMonth ? '' : 'outside ') + (today ? 'today' : '')}
              key={key}
              onClick={() => openComposer(key)}
            >
              <span className="calendar-day-number">{day.getDate()}</span>
              <span className="calendar-day-events">
                {dayEvents.slice(0, 3).map((item) => (
                  <span className="calendar-event-pill" key={item.occurrence_key}>
                    {item.title}
                  </span>
                ))}
                {dayEvents.length > 3 && <small>+{dayEvents.length - 3} more</small>}
              </span>
            </button>
          )
        })}
      </section>

      {composerDate && (
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
              <button
                type="button"
                className="icon-button"
                aria-label="Close event form"
                onClick={() => setComposerDate(null)}
              >
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
                <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                  {categories.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>

              <label className="toggle-label">
                <span>All day</span>
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(event) => setAllDay(event.target.checked)}
                />
              </label>
            </div>

            {!allDay && (
              <label>
                Start time
                <input
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  required
                />
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
