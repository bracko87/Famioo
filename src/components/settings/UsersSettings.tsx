import { Mail, Plus, UserPlus } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useHousehold } from '../../context/HouseholdContext'
import { supabase } from '../../lib/supabase'
import type { HouseholdRole } from '../../lib/types'

type HouseholdUser = {
  user_id: string
  email: string
  display_name: string
  role: HouseholdRole
  status: string
  joined_at: string
}

type AddMode = 'invite' | 'create'

export function UsersSettings() {
  const { household, refresh } = useHousehold()
  const [users, setUsers] = useState<HouseholdUser[]>([])
  const [mode, setMode] = useState<AddMode>('invite')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const isOwner = household.role === 'owner'

  async function loadUsers() {
    const result = await supabase.rpc('household_users_v1', {
      p_household_id: household.id,
    })

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    setUsers((result.data ?? []) as HouseholdUser[])
  }

  useEffect(() => {
    void loadUsers()
  }, [household.id])

  async function addUser(event: FormEvent) {
    event.preventDefault()
    if (!isOwner) return

    setBusy(true)
    setMessage('')

    const result = await supabase.functions.invoke('manage-household-user', {
      body: {
        action: mode,
        household_id: household.id,
        email: email.trim(),
        display_name: displayName.trim(),
        role,
        ...(mode === 'create' ? { password } : {}),
      },
    })

    setBusy(false)

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    if (result.data?.error) {
      setMessage(result.data.error)
      return
    }

    setEmail('')
    setDisplayName('')
    setPassword('')
    setRole('user')
    setMessage(mode === 'invite' ? 'Invitation email sent.' : 'User created successfully.')
    await loadUsers()
    await refresh()
  }

  async function changeRole(userId: string, nextRole: 'admin' | 'user') {
    if (!isOwner) return

    setMessage('')
    const result = await supabase.rpc('set_household_member_role_v1', {
      p_household_id: household.id,
      p_user_id: userId,
      p_role: nextRole,
    })

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    await loadUsers()
    await refresh()
  }

  return (
    <div className="users-settings-layout">
      <section className="settings-card users-list-card">
        <div className="settings-section-head">
          <div>
            <span className="eyebrow">USERS</span>
            <h2>Household users</h2>
            <p>Owner controls roles. Admins can never assign roles or permissions.</p>
          </div>
          <span className="user-count">{users.length}</span>
        </div>

        <div className="users-table">
          <div className="users-table-head">
            <span>User</span>
            <span>Email</span>
            <span>Role</span>
            <span>Status</span>
          </div>

          {users.map((member) => (
            <div className="users-table-row" key={member.user_id}>
              <span className="user-cell">
                <b>{member.display_name.slice(0, 1).toUpperCase()}</b>
                <strong>{member.display_name}</strong>
              </span>
              <span>{member.email}</span>
              <span>
                {member.role === 'owner' || !isOwner ? (
                  <em className={'role-badge ' + member.role}>{member.role}</em>
                ) : (
                  <select
                    className="compact-select"
                    value={member.role}
                    onChange={(event) => void changeRole(member.user_id, event.target.value as 'admin' | 'user')}
                  >
                    <option value="admin">Admin</option>
                    <option value="user">User</option>
                  </select>
                )}
              </span>
              <span><em className="status-badge active">{member.status}</em></span>
            </div>
          ))}
        </div>
      </section>

      {isOwner && (
        <section className="settings-card add-user-card">
          <div className="settings-section-head">
            <div>
              <span className="eyebrow">ADD USER</span>
              <h2>{mode === 'invite' ? 'Invite by email' : 'Create user'}</h2>
            </div>
          </div>

          <div className="mode-switch">
            <button type="button" className={mode === 'invite' ? 'active' : ''} onClick={() => setMode('invite')}>
              <Mail size={15} />Invite
            </button>
            <button type="button" className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>
              <UserPlus size={15} />Create
            </button>
          </div>

          <form className="add-user-form" onSubmit={addUser}>
            <label>
              Display name
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
            </label>

            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>

            <label>
              Role
              <select value={role} onChange={(event) => setRole(event.target.value as 'admin' | 'user')}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </label>

            {mode === 'create' && (
              <label>
                Temporary password
                <input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
              </label>
            )}

            <button className="primary-button" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'invite' ? <><Mail size={16} />Send invitation</> : <><Plus size={16} />Create user</>}
            </button>
          </form>
        </section>
      )}

      {message && <div className="form-message users-message">{message}</div>}
    </div>
  )
}
