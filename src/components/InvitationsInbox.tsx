import { CheckCircle2, Mail, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import '../invitations.css'

type ReceivedInvitation = {
  id: string
  household_name: string
  role: 'admin' | 'user'
  expires_at: string
  requires_password: boolean
}

type InviteError = { error?: string; invitations?: ReceivedInvitation[] }

/**
 * Invitations are presented only to the authenticated, verified recipient.
 * Household permissions are not issued until the recipient clicks Accept.
 */
export function InvitationsInbox({
  onAccepted,
  fallback = null,
  embedded = false,
}: {
  onAccepted: () => Promise<void>
  fallback?: ReactNode
  embedded?: boolean
}) {
  const [invitations, setInvitations] = useState<ReceivedInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const load = useCallback(async () => {
    const { data, error: requestError } = await supabase.functions.invoke('manage-household-user', {
      body: { action: 'received' },
    })
    if (requestError || (data as InviteError | null)?.error) {
      setError((data as InviteError | null)?.error ?? requestError?.message ?? 'Could not load invitations.')
    } else {
      setInvitations((data as InviteError)?.invitations ?? [])
      setError('')
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function accept(event: FormEvent, invitation: ReceivedInvitation) {
    event.preventDefault()
    if (busyId) return

    if (invitation.requires_password) {
      if (password.length < 8 || password !== confirm) {
        setError('Choose a password of at least eight characters and confirm it.')
        return
      }
    }
    setBusyId(invitation.id)
    setError('')

    // First-time invitees must set a password while the invitation session is active.
    // Existing signed-in users keep their current password.
    if (invitation.requires_password) {
      const update = await supabase.auth.updateUser({ password })
      if (update.error) {
        setError(update.error.message)
        setBusyId('')
        return
      }
    }

    const result = await supabase.rpc('accept_household_invitation_v2', {
      p_invitation_id: invitation.id,
    })

    if (result.error) {
      setError(result.error.message)
      setBusyId('')
      return
    }

    setPassword('')
    setConfirm('')
    setInvitations(items => items.filter(item => item.id !== invitation.id))
    setBusyId('')
    await onAccepted()
  }

  if (loading) return embedded ? null : <main className="invite-welcome"><p>Checking invitations…</p></main>
  if (!invitations.length && !error) return <>{fallback}</>
  if (embedded && !invitations.length) return null

  return (
    <section className={embedded ? 'invite-inbox invite-inbox-embedded' : 'invite-inbox invite-welcome'} aria-label="Pending household invitations">
      <header>
        <Mail size={22}/>
        <div>
          <strong>Household invitations</strong>
          <p>Accept an invitation before Famioo grants household access.</p>
        </div>
      </header>
      {error && <p className="notice error" role="alert">{error}</p>}
      {invitations.map(invitation => (
        <form key={invitation.id} className="invite-offer" onSubmit={event => void accept(event, invitation)}>
          <div className="invite-offer-title">
            <ShieldCheck size={21}/>
            <div>
              <strong>{invitation.household_name}</strong>
              <small>Invited as {invitation.role === 'admin' ? 'Admin' : 'User'} · Expires {new Date(invitation.expires_at).toLocaleDateString()}</small>
            </div>
          </div>
          {invitation.requires_password && (
            <div className="invite-password-grid">
              <label>Choose a password<input type="password" minLength={8} autoComplete="new-password" required value={password} onChange={event => setPassword(event.target.value)}/></label>
              <label>Confirm password<input type="password" minLength={8} autoComplete="new-password" required value={confirm} onChange={event => setConfirm(event.target.value)}/></label>
            </div>
          )}
          <button type="submit" className="primary-button compact" disabled={Boolean(busyId)}>
            <CheckCircle2 size={17}/> {busyId === invitation.id ? 'Accepting…' : 'Accept invitation'}
          </button>
        </form>
      ))}
      {!embedded && <button type="button" className="secondary-button compact" onClick={() => void supabase.auth.signOut()}>Sign out</button>}
    </section>
  )
}
