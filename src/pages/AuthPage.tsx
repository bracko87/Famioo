import { Fingerprint } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Brand } from '../components/Brand'
import { supabase } from '../lib/supabase'

export function AuthPage() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'recover'>('signin')
  const [displayName, setDisplayName] = useState('')
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function signInWithPasskey() {
    setBusy(true)
    setMessage('')

    const result = await supabase.auth.signInWithPasskey()

    setBusy(false)

    if (result.error) {
      setMessage(result.error.message)
    }
  }

  async function requestEmailLink() {
    const email = identity.trim().toLowerCase()
    if (!email.includes('@')) {
      setMessage('Enter the email address that received your household invitation.')
      return
    }
    setBusy(true)
    setMessage('')
    const result = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: window.location.origin + '/app',
      },
    })
    setBusy(false)
    setMessage(result.error
      ? result.error.message
      : 'Check your inbox for a Famioo sign-in link. After signing in, accept your household invitation.')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')

    const trimmedIdentity = identity.trim()
    const isEmail = trimmedIdentity.includes('@')

    if (mode === 'recover') {
      if (!isEmail) {
        setBusy(false)
        setMessage('Enter the email address connected to your Famioo account.')
        return
      }
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedIdentity, {
        redirectTo: window.location.origin + '/app',
      })
      setBusy(false)
      setMessage(error
        ? error.message
        : 'If this email belongs to a Famioo account, a password-reset link has been requested. Check your inbox and spam folder.')
      return
    }

    const result = mode === 'signin'
      ? await supabase.auth.signInWithPassword(
          isEmail
            ? { email: trimmedIdentity, password }
            : { phone: trimmedIdentity, password },
        )
      : await supabase.auth.signUp({
          email: trimmedIdentity,
          password,
          options: {
            data: { display_name: displayName.trim() || trimmedIdentity.split('@')[0] },
          },
        })

    setBusy(false)

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    if (mode === 'signup' && !result.data.session) {
      setMessage('Account created. Check your email to confirm the address, then sign in.')
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <Brand />
        <div>
          <span className="eyebrow light">WELCOME HOME</span>
          <h1>A calmer place for family life.</h1>
          <p>Calendar, tasks and shared lists first. Extra household modules only when you need them.</p>
        </div>
      </section>

      <section className="auth-form-panel">
        <form className="auth-card" onSubmit={submit}>
          <span className="eyebrow">{mode === 'signin' ? 'SIGN IN' : mode === 'recover' ? 'RESET PASSWORD' : 'CREATE ACCOUNT'}</span>
          <h2>{mode === 'signin' ? 'Welcome back' : mode === 'recover' ? 'Reset your password' : 'Start your household'}</h2>
          <p>{mode === 'signin' ? 'Open your shared family space.' : mode === 'recover' ? 'We will email a secure recovery link. Open it and choose a new password yourself.' : 'Create your Famioo account first. Your household comes next.'}</p>

          {mode === 'signup' && (
            <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" /></label>
          )}

          <label>
            {mode === 'signin' ? 'Email or phone number' : 'Email'}
            <input
              type={mode === 'signin' ? 'text' : 'email'}
              value={identity}
              onChange={(event) => setIdentity(event.target.value)}
              autoComplete={mode === 'signin' ? 'username' : 'email'}
              placeholder={mode === 'signin' ? 'name@example.com or +491701234567' : ''}
              required
            />
          </label>

          {mode !== 'recover' && (
            <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={8} required /></label>
          )}

          {message && <div className="form-message">{message}</div>}
          <button className="primary-button" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'recover' ? 'Email password reset link' : 'Create account'}</button>

          {mode === 'signin' && (
            <button className="secondary-button" type="button" disabled={busy}
              onClick={() => void requestEmailLink()}>
              Email me a sign-in link (invited members)
            </button>
          )}

          {mode === 'signin' && (
            <button
              className="secondary-button auth-passkey-button"
              disabled={busy}
              type="button"
              onClick={() => void signInWithPasskey()}
            >
              <Fingerprint size={17} />
              Use Face ID / Touch ID / device lock
            </button>
          )}

          {mode === 'signin' && (
            <button type="button" className="text-button" onClick={() => {
              setMode('recover')
              setPassword('')
              setMessage('')
            }}>Forgot password?</button>
          )}

          <button
            type="button"
            className="text-button"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setMessage('')
              setIdentity('')
              setPassword('')
            }}
          >
            {mode === 'signin' ? 'New to Famioo? Create an account' : mode === 'recover' ? 'Back to sign in' : 'Already have an account? Sign in'}
          </button>
        </form>
      </section>
    </main>
  )
}


/**
 * Supabase emits PASSWORD_RECOVERY after a verified recipient opens a
 * recovery email. Only the authenticated recipient may change this password.
 * No household owner can see or choose another member's credentials.
 */
export function PasswordResetPage({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (password.length < 12) {
      setError('Choose a password with at least 12 characters.')
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true)
    setError('')
    const result = await supabase.auth.updateUser({ password })
    if (result.error) {
      setError(result.error.message)
      setBusy(false)
      return
    }
    setPassword('')
    setConfirm('')
    await supabase.auth.signOut()
    setBusy(false)
    onComplete()
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <Brand />
        <div>
          <span className="eyebrow light">WELCOME HOME</span>
          <h1>A calmer place for family life.</h1>
          <p>Keep your Famioo account secure and connected to your household.</p>
        </div>
      </section>
      <section className="auth-form-panel">
        <form className="auth-card" onSubmit={(event) => void submit(event)}>
          <span className="eyebrow">ACCOUNT RECOVERY</span>
          <h2>Choose your new password</h2>
          <p>Set a private password for your own Famioo account. Your existing household membership will be preserved.</p>
          <label>New password
            <input type="password" autoComplete="new-password" minLength={12} required
              value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label>Confirm new password
            <input type="password" autoComplete="new-password" minLength={12} required
              value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </label>
          {error && <div className="form-message error" role="alert">{error}</div>}
          <button className="primary-button" disabled={busy}>
            {busy ? 'Saving…' : 'Save new password'}
          </button>
          <p>After saving, sign in with your email and new password.</p>
        </form>
      </section>
    </main>
  )
}
