import { useEffect, useState, type FormEvent } from 'react'
import { useHousehold } from '../../context/HouseholdContext'
import { supabase } from '../../lib/supabase'
import { Select } from '../ui/Select'

export function GeneralSettings() {
  const { household, refresh } = useHousehold()
  const [name, setName] = useState(household.name)
  const [timezone, setTimezone] = useState(household.timezone)
  const [language, setLanguage] = useState(household.default_language)
  const [weekStartsOn, setWeekStartsOn] = useState(household.week_starts_on)
  const [dateFormat, setDateFormat] = useState(household.date_format)
  const [timeFormat, setTimeFormat] = useState(household.time_format)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const canEdit = household.role === 'owner' || household.role === 'admin'

  useEffect(() => {
    setName(household.name)
    setTimezone(household.timezone)
    setLanguage(household.default_language)
    setWeekStartsOn(household.week_starts_on)
    setDateFormat(household.date_format)
    setTimeFormat(household.time_format)
  }, [household])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!canEdit) return

    setBusy(true)
    setMessage('')

    const result = await supabase
      .from('households')
      .update({
        name: name.trim(),
        timezone: timezone.trim(),
        default_language: language,
        week_starts_on: weekStartsOn,
        date_format: dateFormat,
        time_format: timeFormat,
        updated_at: new Date().toISOString(),
      })
      .eq('id', household.id)

    setBusy(false)

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    setMessage('General settings saved.')
    await refresh()
  }

  return (
    <form className="settings-card general-settings-card" onSubmit={save}>
      <div className="settings-section-head">
        <div>
          <span className="eyebrow">GENERAL</span>
          <h2>Household settings</h2>
        </div>
        <span className="role-chip">{household.role}</span>
      </div>

      <div className="general-settings-grid">
        <label>
          Household name
          <input value={name} onChange={(event) => setName(event.target.value)} disabled={!canEdit} />
        </label>

        <label>
          Timezone
          <input value={timezone} onChange={(event) => setTimezone(event.target.value)} disabled={!canEdit} />
        </label>

        <label>
          Language
          <Select
            value={language}
            onChange={(value) => setLanguage(value as typeof language)}
            disabled={!canEdit}
            options={[
              { value: 'en', label: 'English' },
              { value: 'de', label: 'Deutsch' },
              { value: 'sr', label: 'Srpski' },
            ]}
          />
        </label>

        <label>
          Week starts on
          <Select
            value={String(weekStartsOn)}
            onChange={(value) => setWeekStartsOn(Number(value) as 0 | 1)}
            disabled={!canEdit}
            options={[
              { value: '1', label: 'Monday' },
              { value: '0', label: 'Sunday' },
            ]}
          />
        </label>

        <label>
          Date format
          <Select
            value={dateFormat}
            onChange={(value) => setDateFormat(value as typeof dateFormat)}
            disabled={!canEdit}
            options={[
              { value: 'DD.MM.YYYY', label: 'DD.MM.YYYY' },
              { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
              { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
            ]}
          />
        </label>

        <label>
          Time format
          <Select
            value={timeFormat}
            onChange={(value) => setTimeFormat(value as typeof timeFormat)}
            disabled={!canEdit}
            options={[
              { value: '24h', label: '24-hour' },
              { value: '12h', label: '12-hour' },
            ]}
          />
        </label>
      </div>

      <div className="settings-form-footer">
        <div>
          <strong>Current role: {household.role}</strong>
          <small>{canEdit ? 'General household settings can be updated.' : 'Your role has read-only access to General settings.'}</small>
        </div>
        {canEdit && <button className="primary-button compact" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>}
      </div>

      {message && <div className="form-message">{message}</div>}
    </form>
  )
}
