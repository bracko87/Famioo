import { Camera, Mail, Phone, Plus, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { useHousehold } from '../../context/HouseholdContext'
import { supabase } from '../../lib/supabase'
import type { HouseholdRole } from '../../lib/types'
import { Select } from '../ui/Select'

type HouseholdUser = {
  user_id: string
  email: string | null
  phone: string | null
  display_name: string
  avatar_path: string | null
  role: HouseholdRole
  status: string
  joined_at: string
}

type AddMode = 'invite' | 'create'
type IdentityType = 'email' | 'phone'

export function UsersSettings() {
  const { household, refresh, user } = useHousehold()
  const [users, setUsers] = useState<HouseholdUser[]>([])
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<AddMode>('invite')
  const [identityType, setIdentityType] = useState<IdentityType>('email')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState('')
  const [message, setMessage] = useState('')

  const isOwner = household.role === 'owner'
  const canManageAvatars = household.role === 'owner' || household.role === 'admin'

  async function loadAvatarUrls(rows: HouseholdUser[]) {
    const entries = await Promise.all(rows.map(async (member) => {
      if (!member.avatar_path) return [member.user_id, ''] as const

      const result = await supabase.storage
        .from('profile-avatars')
        .createSignedUrl(member.avatar_path, 3600)

      return [member.user_id, result.data?.signedUrl ?? ''] as const
    }))

    setAvatarUrls(Object.fromEntries(entries))
  }

  async function loadUsers() {
    const result = await supabase.rpc('household_users_v1', {
      p_household_id: household.id,
    })

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    const rows = (result.data ?? []) as HouseholdUser[]
    setUsers(rows)
    await loadAvatarUrls(rows)
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
        identity_type: mode === 'invite' ? 'email' : identityType,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        display_name: displayName.trim(),
        role,
        ...(mode === 'create' ? { password } : {}),
      },
    })

    setBusy(false)

    if (result.error) {
      let detail = result.error.message
      const context = (result.error as { context?: Response }).context

      if (context) {
        try {
          const payload = await context.clone().json() as { error?: string }
          if (payload.error) detail = payload.error
        } catch {
          // Keep the Supabase client error when the response body is not JSON.
        }
      }

      setMessage(detail)
      return
    }

    if (result.data?.error) {
      setMessage(result.data.error)
      return
    }

    setEmail('')
    setPhone('')
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

  async function changeAvatar(member: HouseholdUser, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return
    if (!file.type.startsWith('image/')) {
      setMessage('Please choose an image file.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage('Avatar images can be up to 5 MB.')
      return
    }

    const canChange = canManageAvatars || member.user_id === user.id
    if (!canChange) return

    setAvatarBusy(member.user_id)
    setMessage('')

    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${household.id}/${member.user_id}/avatar-${Date.now()}.${extension}`

    const upload = await supabase.storage
      .from('profile-avatars')
      .upload(path, file, {
        upsert: false,
        contentType: file.type,
      })

    if (upload.error) {
      setAvatarBusy('')
      setMessage(upload.error.message)
      return
    }

    const update = await supabase
      .from('family_profiles')
      .update({
        avatar_path: path,
        updated_at: new Date().toISOString(),
      })
      .eq('household_id', household.id)
      .eq('linked_user_id', member.user_id)

    if (update.error) {
      await supabase.storage.from('profile-avatars').remove([path])
      setAvatarBusy('')
      setMessage(update.error.message)
      return
    }

    if (member.avatar_path) {
      await supabase.storage.from('profile-avatars').remove([member.avatar_path])
    }

    setAvatarBusy('')
    setMessage('Profile image updated.')
    await loadUsers()
    await refresh()
  }

  const createContactLabel = identityType === 'email' ? 'Email' : 'Phone number'
  const identityHint = useMemo(() => {
    if (mode === 'invite') return 'Invitation requires an email address.'
    return identityType === 'email'
      ? 'This user will sign in with email and password.'
      : 'This user will sign in with phone number and password.'
  }, [mode, identityType])

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
            <span>Login / contact</span>
            <span>Role</span>
            <span>Status</span>
          </div>

          {users.map((member) => {
            const canChangeAvatar = canManageAvatars || member.user_id === user.id
            const avatarUrl = avatarUrls[member.user_id]

            return (
              <div className="users-table-row" key={member.user_id}>
                <span className="user-cell">
                  <span className="user-avatar-wrap">
                    {avatarUrl ? (
                      <img className="user-avatar-image" src={avatarUrl} alt="" />
                    ) : (
                      <b>{member.display_name.slice(0, 1).toUpperCase()}</b>
                    )}

                    {canChangeAvatar && (
                      <label className="avatar-upload-button" title="Change profile image">
                        <Camera size={11} />
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          disabled={avatarBusy === member.user_id}
                          onChange={(event) => void changeAvatar(member, event)}
                        />
                      </label>
                    )}
                  </span>
                  <strong>{member.display_name}</strong>
                </span>

                <span className="user-contact-cell">
                  {member.email ? <><Mail size={13} />{member.email}</> : member.phone ? <><Phone size={13} />{member.phone}</> : 'No login contact'}
                </span>

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
            )
          })}
        </div>
      </section>

      {isOwner && (
        <section className="settings-card add-user-card">
          <div className="settings-section-head">
            <div>
              <span className="eyebrow">ADD USER</span>
              <h2>{mode === 'invite' ? 'Invite user' : 'Create user'}</h2>
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

          {mode === 'create' && (
            <div className="identity-switch">
              <button type="button" className={identityType === 'email' ? 'active' : ''} onClick={() => setIdentityType('email')}>
                <Mail size={14} />Email
              </button>
              <button type="button" className={identityType === 'phone' ? 'active' : ''} onClick={() => setIdentityType('phone')}>
                <Phone size={14} />Phone
              </button>
            </div>
          )}

          <form className="add-user-form" onSubmit={addUser}>
            <label>
              Display name
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
            </label>

            {(mode === 'invite' || identityType === 'email') ? (
              <label>
                {createContactLabel}
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
              </label>
            ) : (
              <label>
                Phone number
                <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+491701234567" required />
              </label>
            )}

            <small className="identity-hint">{identityHint}</small>

            <label>
              Role
              <Select
                value={role}
                onChange={(value) => setRole(value as 'admin' | 'user')}
                options={[
                  { value: 'user', label: 'User' },
                  { value: 'admin', label: 'Admin' },
                ]}
                ariaLabel="Choose user role"
              />
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
