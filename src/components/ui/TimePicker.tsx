import { Clock3 } from 'lucide-react'
import { useMemo } from 'react'
import { Select, type SelectOption } from './Select'

type TimePickerProps = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

function labelFor(value: string) {
  const [hour, minute] = value.split(':').map(Number)
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0')
}

export function TimePicker({ value, onChange, disabled = false }: TimePickerProps) {
  const options = useMemo<SelectOption[]>(() => {
    const values: string[] = []

    for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
      const hour = Math.floor(minutes / 60)
      const minute = minutes % 60
      values.push(String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0'))
    }

    if (value && !values.includes(value)) values.push(value)
    values.sort()

    return values.map((item) => ({ value: item, label: labelFor(item) }))
  }, [value])

  return (
    <div className="time-picker">
      <Clock3 size={16} />
      <Select
        value={value}
        options={options}
        onChange={onChange}
        disabled={disabled}
        ariaLabel="Choose time"
        className="time-picker-select"
      />
    </div>
  )
}
