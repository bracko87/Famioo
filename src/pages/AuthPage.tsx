import { Fingerprint } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Brand } from '../components/Brand'
import { supabase } from '../lib/supabase'

export function AuthPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
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

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')

    const trimmedIdentity = identity.trim()
    const isEmail = trimmedIdentity.includes('@')

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
          <span className="eyebrow">{mode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT'}</span>
          <h2>{mode === 'signin' ? 'Welcome back' : 'Start your household'}</h2>
          <p>{mode === 'signin' ? 'Open your shared family space.' : 'Create your Famioo account first. Your household comes next.'}</p>

          {mode === 'signup' && (
            <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" /></label>
          )}

          <label>
            {mode === 'signin' ? 'Email or phone number' : 'Email'}
            <input
              type={mode === 'signup' ? 'email' : 'text'}
              value={identity}
              onChange={(event) => setIdentity(event.target.value)}
              autoComplete={mode === 'signin' ? 'username' : 'email'}
              placeholder={mode === 'signin' ? 'name@example.com or +491701234567' : ''}
              required
            />
          </label>

          <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={8} required /></label>

          {message && <div className="form-message">{message}</div>}
          <button className="primary-button" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>

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
            {mode === 'signin' ? 'New to Famioo? Create an account' : 'Already have an account? Sign in'}
          </button>
        </form>
      </section>
    </main>
  )
}
