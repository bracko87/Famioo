import { useEffect, useState, type FormEvent } from 'react'
import { useHousehold } from '../../context/HouseholdContext'
import { supabase } from '../../lib/supabase'

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
          <select value={language} onChange={(event) => setLanguage(event.target.value as typeof language)} disabled={!canEdit}>
            <option value="en">English</option>
            <option value="de">Deutsch</option>
            <option value="sr">Srpski</option>
          </select>
        </label>

        <label>
          Week starts on
          <select value={weekStartsOn} onChange={(event) => setWeekStartsOn(Number(event.target.value) as 0 | 1)} disabled={!canEdit}>
            <option value={1}>Monday</option>
            <option value={0}>Sunday</option>
          </select>
        </label>

        <label>
          Date format
          <select value={dateFormat} onChange={(event) => setDateFormat(event.target.value as typeof dateFormat)} disabled={!canEdit}>
            <option value="DD.MM.YYYY">DD.MM.YYYY</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
          </select>
        </label>

        <label>
          Time format
          <select value={timeFormat} onChange={(event) => setTimeFormat(event.target.value as typeof timeFormat)} disabled={!canEdit}>
            <option value="24h">24-hour</option>
            <option value="12h">12-hour</option>
          </select>
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
