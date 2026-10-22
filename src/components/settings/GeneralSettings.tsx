import { useEffect, useState, type FormEvent } from 'react'
import { useHousehold } from '../../context/HouseholdContext'
import { supabase } from '../../lib/supabase'
import { Select } from '../ui/Select'

export function GeneralSettings() {
  const { household, refresh, user } = useHousehold()
  const [name, setName] = useState(household.name)
  const [timezone, setTimezone] = useState(household.timezone)
  const [language, setLanguage] = useState(household.default_language)
  const [weekStartsOn, setWeekStartsOn] = useState(household.week_starts_on)
  const [dateFormat, setDateFormat] = useState(household.date_format)
  const [timeFormat, setTimeFormat] = useState(household.time_format)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordError, setPasswordError] = useState('')

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

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (passwordBusy) return
    setPasswordMessage('')
    setPasswordError('')

    if (newPassword.length < 8) {
      setPasswordError('Choose a password with at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('The passwords do not match.')
      return
    }

    setPasswordBusy(true)
    try {
      // Update only the currently authenticated user. Household owners cannot
      // reset another member's password from the Users page.
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) {
        setPasswordError(error.message)
        return
      }

      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage('Password changed successfully. Use your new password the next time you sign in.')
    } catch {
      setPasswordError('Could not change the password. Please try again after signing in again.')
    } finally {
      setPasswordBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: '20px' }}>
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

      <form className="settings-card general-settings-card" onSubmit={(event) => void changePassword(event)}>
        <div className="settings-section-head">
          <div>
            <span className="eyebrow">ACCOUNT SECURITY</span>
            <h2>Change password</h2>
            <p>Set a password for your own Famioo account. You can do this after signing in with an invitation link, without knowing an old password.</p>
            <small>Signed in as {user.email ?? user.phone ?? 'your account'}</small>
          </div>
        </div>

        <div className="general-settings-grid">
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={newPassword}
              disabled={passwordBusy}
              onChange={(event) => { setNewPassword(event.target.value); setPasswordError(''); setPasswordMessage('') }}
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={confirmPassword}
              disabled={passwordBusy}
              onChange={(event) => { setConfirmPassword(event.target.value); setPasswordError(''); setPasswordMessage('') }}
            />
          </label>
        </div>

        <div className="settings-form-footer">
          <div>
            <strong>Your account password</strong>
            <small>Use at least 8 characters; 12 or more is recommended. If Supabase requires additional verification, follow its instructions.</small>
          </div>
          <button type="submit" className="primary-button compact" disabled={passwordBusy}>
            {passwordBusy ? 'Updating…' : 'Change password'}
          </button>
        </div>
        {passwordError && <div role="alert" className="form-message error">{passwordError}</div>}
        {passwordMessage && <div role="status" className="form-message">{passwordMessage}</div>}
      </form>
    </div>
  )
}
