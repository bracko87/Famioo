import { Camera, Mail, Phone, Plus, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { useHousehold } from '../../context/HouseholdContext'
import { supabase } from '../../lib/supabase'
import type { HouseholdRole } from '../../lib/types'
import { Select } from '../ui/Select'
import { ConfirmDialog } from '../ui/ConfirmDialog'

type HouseholdUser = {
  profile_id: string
  user_id: string | null
  email: string | null
  phone: string | null
  display_name: string
  avatar_path: string | null
  profile_type: 'adult' | 'child' | 'profile_only'
  role: HouseholdRole | 'profile'
  status: string
  joined_at: string
}

type PendingInvitation = {
  id: string
  email: string
  display_name: string | null
  role: 'admin' | 'user'
  expires_at: string
  created_at: string
}
type AddMode = 'invite' | 'create'
type IdentityType = 'email' | 'phone'
type ProfileType = 'adult' | 'child'

export function UsersSettings() {
  const { household, refresh, user } = useHousehold()
  const [users, setUsers] = useState<HouseholdUser[]>([])
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([])
  const [loadingInvitations, setLoadingInvitations] = useState(false)
  const [invitationError, setInvitationError] = useState('')
  const [cancellingId, setCancellingId] = useState('')
  const [resendingId, setResendingId] = useState('')
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string>>({})
  const [profileType, setProfileType] = useState<ProfileType>('adult')
  const [mode, setMode] = useState<AddMode>('invite')
  const [identityType, setIdentityType] = useState<IdentityType>('email')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState('')
  const [removingProfileId, setRemovingProfileId] = useState('')
  const [removeConfirm,setRemoveConfirm] = useState<HouseholdUser|null>(null)
  const [message, setMessage] = useState('')
  const [phoneDrafts,setPhoneDrafts] = useState<Record<string,string>>({})
  const [savingPhone,setSavingPhone] = useState('')

  const isOwner = household.role === 'owner'
  const canManageAvatars = household.role === 'owner' || household.role === 'admin'

  async function loadAvatarUrls(rows: HouseholdUser[]) {
    const entries = await Promise.all(rows.map(async (member) => {
      if (!member.avatar_path) return [member.profile_id, ''] as const

      const result = await supabase.storage
        .from('profile-avatars')
        .createSignedUrl(member.avatar_path, 3600)

      return [member.profile_id, result.data?.signedUrl ?? ''] as const
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
    setPhoneDrafts(Object.fromEntries(rows.map((member)=>[member.profile_id,member.phone??''])))
    await loadAvatarUrls(rows)
  }

  async function loadSentInvitations() {
    if (!isOwner) return
    setLoadingInvitations(true)
    const result = await supabase.functions.invoke('manage-household-user', {
      body: { action: 'sent', household_id: household.id },
    })
    setLoadingInvitations(false)
    if (result.error || result.data?.error) {
      setInvitationError(result.data?.error ?? result.error?.message ?? 'Could not load pending invitations.')
      return
    }
    setInvitationError('')
    setPendingInvitations((result.data?.invitations ?? []) as PendingInvitation[])
  }

  async function resendInvitation(invitation: PendingInvitation) {
    if (!isOwner) return
    setResendingId(invitation.id)
    setMessage('')
    const result = await supabase.functions.invoke('manage-household-user', {
      body: { action: 'resend', household_id: household.id, invitation_id: invitation.id },
    })
    setResendingId('')
    if (result.error || result.data?.error) {
      setMessage(result.data?.error ?? result.error?.message ?? 'Could not request another invitation email.')
      return
    }
    setMessage(result.data?.message ?? 'Another invitation email was requested. Delivery is not confirmed.')
    await loadSentInvitations()
  }

  async function cancelInvitation(invitation: PendingInvitation) {
    if (!isOwner || !window.confirm('Cancel the invitation for ' + invitation.email + '?')) return
    setCancellingId(invitation.id)
    const result = await supabase.functions.invoke('manage-household-user', {
      body: { action: 'revoke', household_id: household.id, invitation_id: invitation.id },
    })
    setCancellingId('')
    if (result.error || result.data?.error) {
      setMessage(result.data?.error ?? result.error?.message ?? 'Could not cancel the invitation.')
      return
    }
    setMessage('Invitation cancelled. The person was not given household access.')
    await loadSentInvitations()
  }

  useEffect(() => {
    void loadUsers()
    if (isOwner) void loadSentInvitations()
  }, [household.id, isOwner])

  async function addUser(event: FormEvent) {
    event.preventDefault()
    if (!isOwner || !displayName.trim()) return

    setBusy(true)
    setMessage('')

    if (profileType === 'child') {
      const childResult = await supabase.rpc('create_household_profile_v1', {
        p_household_id: household.id,
        p_display_name: displayName.trim(),
        p_profile_type: 'child',
      })

      setBusy(false)

      if (childResult.error) {
        setMessage(childResult.error.message)
        return
      }

      if (birthDate) {
        const birthResult = await supabase
          .from('family_profiles')
          .update({ birth_date: birthDate, updated_at: new Date().toISOString() })
          .eq('id', String(childResult.data))
          .eq('household_id', household.id)

        if (birthResult.error) {
          setMessage('Child profile created, but date of birth could not be saved: ' + birthResult.error.message)
          await loadUsers()
          await refresh()
          return
        }
      }

      setDisplayName('')
      setBirthDate('')
      setMessage('Child profile created. No login access was created.')
      await loadUsers()
      await refresh()
      return
    }

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setBusy(false)
      setMessage('Your session expired. Please sign in again.')
      return
    }

    const action = mode

    const result = await supabase.functions.invoke('manage-household-user', {
      headers: {
        Authorization: 'Bearer ' + session.access_token,
      },
      body: {
        action,
        household_id: household.id,
        profile_type: profileType,
        identity_type: mode === 'invite' ? 'email' : identityType,
        email: profileType === 'adult' ? email.trim() || undefined : undefined,
        phone: profileType === 'adult' ? phone.trim() || undefined : undefined,
        display_name: displayName.trim(),
        role,
        ...(profileType === 'adult' && mode === 'create' ? { password } : {}),
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
    setMessage(mode === 'invite'
      ? (result.data?.message ?? 'Invitation created. Awaiting recipient acceptance.')
      : 'User created successfully.')

    await loadUsers()
    if (mode === 'invite') await loadSentInvitations()
    await refresh()
  }

  async function saveSafetyPhone(member:HouseholdUser) {
    const canEdit = household.role==='owner' || household.role==='admin' || member.user_id===user.id
    if(!canEdit || member.profile_type!=='adult') return

    setSavingPhone(member.profile_id)
    setMessage('')

    const result=await supabase.rpc('set_household_profile_phone_v1',{
      p_household_id:household.id,
      p_profile_id:member.profile_id,
      p_phone:(phoneDrafts[member.profile_id]??'').trim(),
    })

    setSavingPhone('')

    if(result.error){
      setMessage(result.error.message)
      return
    }

    setMessage(member.display_name+' safety phone number updated.')
    await loadUsers()
    await refresh()
  }

  async function changeRole(userId: string | null, nextRole: 'admin' | 'user') {
    if (!isOwner || !userId) return

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

  async function removeMember(member: HouseholdUser) {
    if (!isOwner || member.role === 'owner') return

    setRemovingProfileId(member.profile_id)
    setMessage('')

    const result = await supabase.rpc('remove_household_member_v1', {
      p_household_id: household.id,
      p_profile_id: member.profile_id,
    })

    setRemovingProfileId('')

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    setMessage(member.display_name + ' was removed from the household.')
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

    setAvatarBusy(member.profile_id)
    setMessage('')

    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const storageOwner = member.user_id ?? member.profile_id
    const path = `${household.id}/${storageOwner}/avatar-${Date.now()}.${extension}`

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
      .eq('id', member.profile_id)
      .eq('household_id', household.id)

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

  const identityHint = useMemo(() => {
    if (profileType === 'child') return 'Children are participant profiles only and do not receive sign-in access.'
    if (mode === 'invite') return 'An email invitation is requested for new and existing Famioo accounts (custom Supabase Auth SMTP required). The link opens Famioo, where recipients sign in and accept. On iPhone, Safari → Share → Add to Home Screen installs the current web app.'
    return identityType === 'email'
      ? 'This adult will sign in with email and password.'
      : 'This adult will sign in with phone number and password.'
  }, [mode, identityType, profileType])

  return (
    <div className="users-settings-layout">
      <section className="settings-card users-list-card">
        <div className="settings-section-head">
          <div>
            <span className="eyebrow">USERS</span>
            <h2>Household people</h2>
            <p>Adults can have app access. Child profiles are participants only and do not receive login credentials.</p>
            <p>Active users below have household access. New invitations remain separate and pending until the recipient signs in and accepts.</p>
          </div>
          <span className="user-count">{users.length}</span>
        </div>

        <section className="safety-phone-settings">
          <div className="safety-phone-settings-head">
            <div>
              <span className="eyebrow">FAMILY SAFETY CONTACTS</span>
              <h3>Mobile phone numbers</h3>
              <p>Used for the one-tap Call and Text buttons after an SOS. Internet calling remains available when a mobile number is missing.</p>
            </div>
          </div>

          <div className="safety-phone-settings-list">
            {users
              .filter((member)=>member.profile_type==='adult'&&member.user_id)
              .map((member)=>{
                const canEditPhone=household.role==='owner'||household.role==='admin'||member.user_id===user.id
                return (
                  <div className={member.phone?'safety-phone-row':'safety-phone-row missing'} key={'safety-phone-'+member.profile_id}>
                    <span>
                      <strong>{member.display_name}</strong>
                      <small>{member.phone?'Ready for emergency call/SMS':'Phone number missing'}</small>
                    </span>
                    {canEditPhone ? (
                      <>
                        <input
                          type="tel"
                          value={phoneDrafts[member.profile_id]??''}
                          onChange={(event)=>setPhoneDrafts((current)=>({
                            ...current,
                            [member.profile_id]:event.target.value,
                          }))}
                          placeholder="+49 170 1234567"
                          aria-label={'Safety phone number for '+member.display_name}
                        />
                        <button
                          type="button"
                          className="secondary-button compact"
                          disabled={savingPhone===member.profile_id}
                          onClick={()=>void saveSafetyPhone(member)}
                        >
                          {savingPhone===member.profile_id?'Saving…':'Save'}
                        </button>
                      </>
                    ) : (
                      <span className="safety-phone-readonly">{member.phone||'Not set'}</span>
                    )}
                  </div>
                )
              })}
          </div>
        </section>

        <div className="users-table">
          <div className="users-table-head">
            <span>Person</span>
            <span>Login / contact</span>
            <span>Role</span>
            <span>Status</span>
            <span>Actions</span>
          </div>

          {users.map((member) => {
            const canChangeAvatar = canManageAvatars || member.user_id === user.id
            const avatarUrl = avatarUrls[member.profile_id]

            return (
              <div className="users-table-row" key={member.profile_id}>
                <span className="user-cell">
                  <span className="user-avatar-wrap">
                    {avatarUrl ? (
                      <img className="user-avatar-image" src={avatarUrl} alt="" />
                    ) : (
                      <span className="user-avatar-fallback">{member.display_name.slice(0, 1).toUpperCase()}</span>
                    )}

                    {canChangeAvatar && (
                      <label className="avatar-upload-button" title="Change profile image">
                        <Camera size={11} />
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          disabled={avatarBusy === member.profile_id}
                          onChange={(event) => void changeAvatar(member, event)}
                        />
                      </label>
                    )}
                  </span>
                  <span className="user-name-copy">
                    <span>{member.display_name}</span>
                    <small>{member.profile_type === 'child' ? 'Child' : 'Adult'}</small>
                  </span>
                </span>

                <span className="user-contact-cell">
                  {member.email
                    ? <><Mail size={13} />{member.email}</>
                    : member.phone
                      ? <><Phone size={13} />{member.phone}</>
                      : 'No login access'}
                </span>

                <span>
                  {member.role === 'profile' ? (
                    <em className="role-badge profile">Participant</em>
                  ) : member.role === 'owner' || !isOwner ? (
                    <em className={'role-badge ' + member.role}>{member.role}</em>
                  ) : (
                    <Select
                      className="compact-select"
                      value={member.role}
                      onChange={(value) => void changeRole(member.user_id, value as 'admin' | 'user')}
                      options={[
                        { value: 'admin', label: 'Admin' },
                        { value: 'user', label: 'User' },
                      ]}
                      ariaLabel={'Role for ' + member.display_name}
                    />
                  )}
                </span>

                <span>
                  <em className={member.role === 'profile' ? 'status-badge profile' : 'status-badge active'}>
                    {member.role === 'profile' ? 'Participant only' : member.status === 'active' ? 'Access granted' : member.status}
                  </em>
                </span>

                <span className="user-actions-cell">
                  {isOwner && member.role !== 'owner' ? (
                    <button
                      type="button"
                      className="remove-member-button"
                      disabled={removingProfileId === member.profile_id}
                      onClick={() => setRemoveConfirm(member)}
                      aria-label={'Remove ' + member.display_name + ' from household'}
                      title={'Remove ' + member.display_name}
                    >
                      <Trash2 size={13} />
                      <span>{removingProfileId === member.profile_id ? 'Removing…' : 'Remove'}</span>
                    </button>
                  ) : (
                    <span className="user-actions-placeholder">—</span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {isOwner && (
        <section className="settings-card" aria-label="Pending household invitations">
          <div className="settings-section-head">
            <div>
              <span className="eyebrow">AWAITING ACCEPTANCE</span>
              <h2>Pending invitations</h2>
              <p>Only recipients can accept. These entries do not grant household access or confirm email delivery.</p>
            </div>
          </div>
          {invitationError && <div className="notice error">{invitationError}</div>}
          {loadingInvitations ? <p>Checking pending invitations…</p>
            : pendingInvitations.length ? (
              <div className="users-table">
                {pendingInvitations.map(invitation => (
                  <div className="users-table-row" key={invitation.id}>
                    <span className="user-cell"><Mail size={19}/><strong>{invitation.display_name || invitation.email}</strong></span>
                    <span className="user-contact-cell">{invitation.email}</span>
                    <span>{invitation.role === 'admin' ? 'Admin' : 'User'}</span>
                    <span className="status-badge profile">Pending</span>
                    <span className="user-actions-cell">
                      <button type="button" className="secondary-button compact"
                        disabled={resendingId === invitation.id || cancellingId === invitation.id}
                        onClick={() => void resendInvitation(invitation)}>
                        {resendingId === invitation.id ? 'Sending…' : 'Resend email'}
                      </button>
                      <button type="button" className="secondary-button compact"
                        disabled={cancellingId === invitation.id || resendingId === invitation.id}
                        onClick={() => void cancelInvitation(invitation)}>
                        {cancellingId === invitation.id ? 'Cancelling…' : 'Cancel'}
                      </button>
                    </span>
                    <small>Expires {new Date(invitation.expires_at).toLocaleDateString()}</small>
                  </div>
                ))}
              </div>
            ) : <p>No pending invitations.</p>}
        </section>
      )}

      {isOwner && (
        <section className="settings-card add-user-card">
          <div className="settings-section-head">
            <div>
              <span className="eyebrow">ADD PERSON</span>
              <h2>{profileType === 'child' ? 'Create child profile' : mode === 'invite' ? 'Invite adult' : 'Create adult user'}</h2>
            </div>
          </div>

          <div className="identity-switch person-type-switch">
            <button type="button" className={profileType === 'adult' ? 'active' : ''} onClick={() => setProfileType('adult')}>
              Adult
            </button>
            <button type="button" className={profileType === 'child' ? 'active' : ''} onClick={() => setProfileType('child')}>
              Child
            </button>
          </div>

          {profileType === 'adult' && (
            <>
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
            </>
          )}

          <form className="add-user-form" onSubmit={addUser}>
            <label>
              Display name
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
            </label>

            {profileType === 'child' && (
              <label>
                Date of birth
                <input
                  type="date"
                  value={birthDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(event) => setBirthDate(event.target.value)}
                  required
                />
                <small className="field-hint">Used to build the child’s vaccination schedule.</small>
              </label>
            )}

            {profileType === 'adult' && (mode === 'invite' || identityType === 'email') && (
              <label>
                Email
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
              </label>
            )}

            {profileType === 'adult' && mode === 'create' && identityType === 'phone' && (
              <label>
                Phone number
                <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+491701234567" required />
              </label>
            )}

            <small className="identity-hint">{identityHint}</small>

            {profileType === 'adult' && (
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
            )}

            {profileType === 'adult' && mode === 'create' && (
              <label>
                Temporary password
                <input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
              </label>
            )}

            <button className="primary-button" disabled={busy}>
              {busy
                ? 'Please wait…'
                : profileType === 'child'
                  ? <><Plus size={16} />Create child profile</>
                  : mode === 'invite'
                    ? <><Mail size={16} />Send invitation</>
                    : <><Plus size={16} />Create user</>}
            </button>
          </form>
        </section>
      )}

      {message && <div className="form-message users-message">{message}</div>}
      <ConfirmDialog
        open={Boolean(removeConfirm)}
        title="Remove household member?"
        message={removeConfirm ? 'Remove '+removeConfirm.display_name+' from this household? They will lose household access and current assignments, while historical completed work and points remain preserved.' : ''}
        confirmLabel="Remove member"
        danger
        busy={Boolean(removingProfileId)}
        onCancel={()=>setRemoveConfirm(null)}
        onConfirm={()=>{ if(removeConfirm) void removeMember(removeConfirm).finally(()=>setRemoveConfirm(null)) }}
      />
    </div>
  )
}
