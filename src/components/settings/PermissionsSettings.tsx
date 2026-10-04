import { useEffect, useState } from 'react'
import { useHousehold } from '../../context/HouseholdContext'
import { supabase } from '../../lib/supabase'
import type { ModulePermission } from '../../lib/types'
import { Select } from '../ui/Select'

type PermissionRow = {
  module_code: string
  role: 'owner' | 'admin' | 'user'
  access_level: ModulePermission
}

const labels: Record<ModulePermission, string> = {
  full: 'Full',
  read: 'Read only',
  restricted: 'Restricted',
}

export function PermissionsSettings() {
  const { household, modules, refresh } = useHousehold()
  const [permissions, setPermissions] = useState<PermissionRow[]>([])
  const [message, setMessage] = useState('')
  const [savingKey, setSavingKey] = useState('')

  const isOwner = household.role === 'owner'

  async function loadPermissions() {
    const result = await supabase
      .from('module_role_permissions')
      .select('module_code,role,access_level')
      .eq('household_id', household.id)

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    setPermissions((result.data ?? []) as PermissionRow[])
  }

  useEffect(() => {
    void loadPermissions()
  }, [household.id])

  function valueFor(moduleCode: string, role: 'owner' | 'admin' | 'user'): ModulePermission {
    if (role === 'owner') return 'full'
    return permissions.find((item) => item.module_code === moduleCode && item.role === role)?.access_level
      ?? (role === 'admin' ? 'full' : 'read')
  }

  async function setPermission(
    moduleCode: string,
    role: 'admin' | 'user',
    accessLevel: ModulePermission,
  ) {
    if (!isOwner) return

    const key = moduleCode + ':' + role
    setSavingKey(key)
    setMessage('')

    const result = await supabase.rpc('set_module_role_permission_v1', {
      p_household_id: household.id,
      p_module_code: moduleCode,
      p_role: role,
      p_access_level: accessLevel,
    })

    setSavingKey('')

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    setPermissions((current) => {
      const filtered = current.filter((item) => !(item.module_code === moduleCode && item.role === role))
      return [...filtered, { module_code: moduleCode, role, access_level: accessLevel }]
    })

    await refresh()
  }

  return (
    <section className="settings-card permissions-card">
      <div className="settings-section-head">
        <div>
          <span className="eyebrow">PERMISSIONS</span>
          <h2>Module access by role</h2>
          <p>Owner is always Full. Only the Owner can change Admin and User access.</p>
        </div>
      </div>

      <div className="permission-legend">
        <span><b>Full</b> view and update</span>
        <span><b>Read only</b> view without changes</span>
        <span><b>Restricted</b> no module access</span>
      </div>

      <div className="permissions-table-wrap">
        <div className="permissions-table">
          <div className="permissions-head">
            <span>Module</span>
            <span>Owner</span>
            <span>Admin</span>
            <span>User</span>
          </div>

          {modules.map((module) => (
            <div className="permissions-row" key={module.code}>
              <span className="permission-module">
                <strong>{module.name}</strong>
                <small>{module.is_core ? 'Core module' : module.entitled ? 'Unlocked module' : 'Optional module'}</small>
              </span>

              <span><em className="permission-fixed">Full</em></span>

              {(['admin', 'user'] as const).map((role) => {
                const key = module.code + ':' + role
                return (
                  <span key={role}>
                    <Select
                      className="permission-select"
                      value={valueFor(module.code, role)}
                      disabled={!isOwner || savingKey === key}
                      onChange={(value) => void setPermission(module.code, role, value as ModulePermission)}
                      options={[
                        { value: 'full', label: labels.full },
                        { value: 'read', label: labels.read },
                        { value: 'restricted', label: labels.restricted },
                      ]}
                      ariaLabel={module.name + ' permission for ' + role}
                    />
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {message && <div className="form-message">{message}</div>}
    </section>
  )
}
