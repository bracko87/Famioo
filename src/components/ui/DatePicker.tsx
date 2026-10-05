import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'

type DateFormat = 'DD.MM.YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'

type DatePickerProps = {
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  disabled?: boolean
  format?: DateFormat
  ariaLabel?: string
  className?: string
}

function parseIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12, 0, 0, 0)
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return null
  return date
}

function isoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function displayDate(value: string, format: DateFormat) {
  const date = parseIso(value)
  if (!date) {
    if (format === 'DD.MM.YYYY') return 'dd.mm.yyyy'
    if (format === 'MM/DD/YYYY') return 'mm/dd/yyyy'
    return 'yyyy-mm-dd'
  }

  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yyyy = String(date.getFullYear())

  if (format === 'DD.MM.YYYY') return `${dd}.${mm}.${yyyy}`
  if (format === 'MM/DD/YYYY') return `${mm}/${dd}/${yyyy}`
  return `${yyyy}-${mm}-${dd}`
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0)
}

function addMonths(date: Date, count: number) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1, 12, 0, 0, 0)
}

function calendarStart(date: Date) {
  const first = monthStart(date)
  const offset = (first.getDay() + 6) % 7
  const start = new Date(first)
  start.setDate(first.getDate() - offset)
  return start
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  disabled = false,
  format = 'DD.MM.YYYY',
  ariaLabel = 'Choose date',
  className = '',
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const selected = parseIso(value)
  const [cursor, setCursor] = useState(() => monthStart(selected ?? new Date()))
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (selected) setCursor(monthStart(selected))
  }, [value])

  useEffect(() => {
    function close(event: MouseEvent) {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false)
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

  useEffect(() => {
    if (!open) return

    function positionPopover() {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return

      const width = Math.min(310, window.innerWidth - 24)
      const estimatedHeight = 360
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
      const below = rect.bottom + 7
      const top = below + estimatedHeight <= window.innerHeight - 12
        ? below
        : Math.max(12, rect.top - estimatedHeight - 7)

      setPopoverPosition({ top, left })
    }

    positionPopover()
    window.addEventListener('resize', positionPopover)
    window.addEventListener('scroll', positionPopover, true)

    return () => {
      window.removeEventListener('resize', positionPopover)
      window.removeEventListener('scroll', positionPopover, true)
    }
  }, [open])

  const days = useMemo(() => {
    const start = calendarStart(cursor)
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start)
      date.setDate(start.getDate() + index)
      return date
    })
  }, [cursor])

  const minDate = min ? parseIso(min) : null
  const maxDate = max ? parseIso(max) : null
  const todayKey = isoDate(new Date())

  function choose(date: Date) {
    const key = isoDate(date)
    if (minDate && date < minDate) return
    if (maxDate && date > maxDate) return
    onChange(key)
    setOpen(false)
  }

  return (
    <div
      className={'date-picker ' + className + (open ? ' open' : '') + (disabled ? ' disabled' : '')}
      ref={rootRef}
    >
      <button
        type="button"
        className="date-picker-trigger"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={value ? '' : 'placeholder'}>{displayDate(value, format)}</span>
        <CalendarDays size={15} />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="date-picker-popover date-picker-popover-portal"
          role="dialog"
          aria-label={ariaLabel}
          ref={popoverRef}
          style={{ top: popoverPosition.top, left: popoverPosition.left }}
        >
          <header className="date-picker-head">
            <button type="button" className="date-picker-nav" onClick={() => setCursor((current) => addMonths(current, -1))} aria-label="Previous month">
              <ChevronLeft size={15} />
            </button>
            <strong>{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
            <button type="button" className="date-picker-nav" onClick={() => setCursor((current) => addMonths(current, 1))} aria-label="Next month">
              <ChevronRight size={15} />
            </button>
          </header>

          <div className="date-picker-weekdays">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}
          </div>

          <div className="date-picker-grid">
            {days.map((day) => {
              const key = isoDate(day)
              const outside = day.getMonth() !== cursor.getMonth()
              const selectedDay = key === value
              const today = key === todayKey
              const blocked = Boolean(
                (minDate && day < minDate)
                || (maxDate && day > maxDate),
              )

              return (
                <button
                  type="button"
                  key={key}
                  disabled={blocked}
                  className={[
                    outside ? 'outside' : '',
                    selectedDay ? 'selected' : '',
                    today ? 'today' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => choose(day)}
                >
                  {day.getDate()}
                </button>
              )
            })}
          </div>

          <footer className="date-picker-actions">
            <button type="button" onClick={() => {
              const today = new Date()
              if ((!minDate || today >= minDate) && (!maxDate || today <= maxDate)) {
                onChange(isoDate(today))
                setOpen(false)
              }
            }}>
              Today
            </button>
            <button type="button" onClick={() => {
              onChange('')
              setOpen(false)
            }}>
              Clear
            </button>
          </footer>
        </div>,
        document.body,
      )}
    </div>
  )
}
