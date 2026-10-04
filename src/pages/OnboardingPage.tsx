import type { User } from '@supabase/supabase-js'
import { useState, type FormEvent } from 'react'
import { Brand } from '../components/Brand'
import { supabase } from '../lib/supabase'

export function OnboardingPage({ user, onCreated }: { user: User; onCreated: () => Promise<void> }) {
  const [householdName, setHouseholdName] = useState('')
  const [displayName, setDisplayName] = useState((user.user_metadata?.display_name as string | undefined) ?? '')
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')

    const result = await supabase.rpc('create_household_v1', {
      p_name: householdName.trim(),
      p_timezone: timezone,
      p_display_name: displayName.trim() || null,
    })

    setBusy(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    await onCreated()
  }

  return (
    <main className="onboarding-page">
      <div className="onboarding-brand"><Brand /></div>
      <form className="onboarding-card" onSubmit={create}>
        <span className="eyebrow">YOUR HOUSEHOLD</span>
        <h1>Create the first family space</h1>
        <p>One Famioo database can hold many families. This household remains isolated from every other household by database permissions.</p>
        <label>Household name<input value={householdName} onChange={(event) => setHouseholdName(event.target.value)} placeholder="Levnajici" required /></label>
        <label>Your display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Aleksandar" required /></label>
        <label>Timezone<input value={timezone} onChange={(event) => setTimezone(event.target.value)} required /></label>
        {error && <div className="form-message error">{error}</div>}
        <button className="primary-button" disabled={busy}>{busy ? 'Creating…' : 'Create household'}</button>
      </form>
    </main>
  )
}
