import { Bell, Fingerprint, Mail, Send, Smartphone, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useHousehold } from '../../context/HouseholdContext'
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushStatus,
  sendTestPush,
  type PushStatus,
} from '../../lib/push'
import { supabase } from '../../lib/supabase'
import { Select } from '../ui/Select'
import { TimePicker } from '../ui/TimePicker'
import { ConfirmDialog } from '../ui/ConfirmDialog'

type PreferenceRow = {
  push_enabled:boolean
  email_enabled:boolean
  daily_summary_enabled:boolean
  daily_summary_time:string
  weekly_summary_enabled:boolean
  weekly_summary_weekday:number
  weekly_summary_time:string
  timezone:string
}

type PasskeyRow = {
  id:string
  friendly_name?:string
  created_at?:string
  last_used_at?:string
}

const initialPush:PushStatus={ supported:true,permission:'default',subscribed:false }

const weekdays=[
  { value:'1',label:'Monday' },
  { value:'2',label:'Tuesday' },
  { value:'3',label:'Wednesday' },
  { value:'4',label:'Thursday' },
  { value:'5',label:'Friday' },
  { value:'6',label:'Saturday' },
  { value:'7',label:'Sunday' },
]

export function NotificationsSecuritySettings() {
  const { household,user }=useHousehold()
  const [pushStatus,setPushStatus]=useState<PushStatus>(initialPush)
  const [pushEnabled,setPushEnabled]=useState(true)
  const [emailEnabled,setEmailEnabled]=useState(true)
  const [dailyEnabled,setDailyEnabled]=useState(false)
  const [dailyTime,setDailyTime]=useState('07:00')
  const [weeklyEnabled,setWeeklyEnabled]=useState(false)
  const [weeklyWeekday,setWeeklyWeekday]=useState('1')
  const [weeklyTime,setWeeklyTime]=useState('08:00')
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [pushBusy,setPushBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [passkeys,setPasskeys]=useState<PasskeyRow[]>([])
  const [passkeyBusy,setPasskeyBusy]=useState(false)
  const [passkeyDelete,setPasskeyDelete]=useState<{id:string;name:string}|null>(null)
  const [passkeySupported,setPasskeySupported]=useState(false)
  const [passkeyServerEnabled,setPasskeyServerEnabled]=useState(true)

  const email=user.email ?? 'No email address on this account'

  const isIos=useMemo(
    ()=>/iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1),
    [],
  )

  async function refreshPush() {
    try {
      setPushStatus(await getPushStatus())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not read notification status.')
    }
  }

  async function loadPasskeys() {
    const result=await supabase.auth.passkey.list()

    if (result.error) {
      if (/passkey_disabled/i.test(result.error.message)) {
        setPasskeyServerEnabled(false)
      } else {
        setError(result.error.message)
      }
      setPasskeys([])
      return
    }

    setPasskeyServerEnabled(true)
    setPasskeys((result.data ?? []) as PasskeyRow[])
  }

  useEffect(()=>{
    let cancelled=false

    async function load() {
      setLoading(true)
      setError('')
      setMessage('')

      if ('PublicKeyCredential' in window) {
        try {
          setPasskeySupported(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
        } catch {
          setPasskeySupported(true)
        }
      }

      const prefResult=await supabase
        .from('notification_preferences')
        .select('push_enabled,email_enabled,daily_summary_enabled,daily_summary_time,weekly_summary_enabled,weekly_summary_weekday,weekly_summary_time,timezone')
        .eq('household_id',household.id)
        .eq('user_id',user.id)
        .maybeSingle()

      if (cancelled) return

      if (prefResult.error) {
        setError(prefResult.error.message)
      } else if (prefResult.data) {
        const row=prefResult.data as PreferenceRow
        setPushEnabled(row.push_enabled)
        setEmailEnabled(row.email_enabled)
        setDailyEnabled(row.daily_summary_enabled)
        setDailyTime(row.daily_summary_time.slice(0,5))
        setWeeklyEnabled(row.weekly_summary_enabled)
        setWeeklyWeekday(String(row.weekly_summary_weekday))
        setWeeklyTime(row.weekly_summary_time.slice(0,5))
      }

      await Promise.all([refreshPush(),loadPasskeys()])
      if (!cancelled) setLoading(false)
    }

    void load()
    return ()=>{ cancelled=true }
  },[household.id,user.id])

  async function savePreferences() {
    setSaving(true)
    setError('')
    setMessage('')

    const result=await supabase
      .from('notification_preferences')
      .upsert({
        household_id:household.id,
        user_id:user.id,
        push_enabled:pushEnabled,
        email_enabled:emailEnabled,
        daily_summary_enabled:dailyEnabled,
        daily_summary_time:dailyTime+':00',
        weekly_summary_enabled:weeklyEnabled,
        weekly_summary_weekday:Number(weeklyWeekday),
        weekly_summary_time:weeklyTime+':00',
        timezone:household.timezone,
        updated_at:new Date().toISOString(),
      },{ onConflict:'household_id,user_id' })

    setSaving(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    setMessage('Notification and summary settings saved.')
  }

  async function enablePush() {
    setPushBusy(true)
    setError('')
    setMessage('')
    try {
      await enablePushNotifications(household.id,user.id)
      setPushEnabled(true)
      await supabase
        .from('notification_preferences')
        .update({ push_enabled:true,updated_at:new Date().toISOString() })
        .eq('household_id',household.id)
        .eq('user_id',user.id)
      await refreshPush()
      setMessage('Push notifications are enabled on this device.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Push notifications could not be enabled.')
    } finally {
      setPushBusy(false)
    }
  }

  async function disablePush() {
    setPushBusy(true)
    setError('')
    setMessage('')
    try {
      await disablePushNotifications(household.id,user.id)
      await refreshPush()
      setMessage('Push notifications are disabled on this device.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Push notifications could not be disabled.')
    } finally {
      setPushBusy(false)
    }
  }

  async function testPush() {
    setPushBusy(true)
    setError('')
    setMessage('')
    try {
      const result=await sendTestPush(household.id)
      if (result.sent>0) setMessage('Test notification sent. It should appear on this device now.')
      else setError(result.message)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Test notification could not be sent.')
    } finally {
      setPushBusy(false)
    }
  }

  async function registerPasskey() {
    setPasskeyBusy(true)
    setError('')
    setMessage('')

    try {
      const result=await supabase.auth.registerPasskey()
      if (result.error) throw new Error(result.error.message)

      await loadPasskeys()
      setMessage('Device sign-in was added. You can now use Face ID, Touch ID, Windows Hello, Android screen lock or your device PIN.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Device sign-in could not be added.')
    } finally {
      setPasskeyBusy(false)
    }
  }

  async function deletePasskey(passkeyId:string,name:string) {
    setPasskeyBusy(true)
    setError('')
    setMessage('')

    try {
      const result=await supabase.auth.passkey.delete({ passkeyId })
      if (result.error) throw new Error(result.error.message)
      await loadPasskeys()
      setMessage('Device sign-in removed.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Device sign-in could not be removed.')
    } finally {
      setPasskeyBusy(false)
    }
  }

  return (
    <div className="notification-security-grid">
      <section className="settings-card notification-settings-card">
        <div className="settings-section-head">
          <div>
            <span className="eyebrow">PUSH NOTIFICATIONS</span>
            <h2>Notifications on this device</h2>
            <p>Receive Famioo reminders when the app is in the background or closed.</p>
          </div>
          <Bell size={22} />
        </div>

        {!pushStatus.supported ? (
          <div className="notification-support-note">
            <strong>Push notifications are not available here.</strong>
            <span>{isIos ? 'On iPhone, add Famioo to the Home Screen and open the installed app before enabling notifications.' : 'Use a browser/device that supports Web Push.'}</span>
          </div>
        ) : (
          <>
            <div className={pushStatus.subscribed ? 'notification-device-status active' : 'notification-device-status'}>
              <Smartphone size={16} />
              <span>
                <strong>{pushStatus.subscribed ? 'This device is connected' : 'This device is not connected'}</strong>
                <small>{pushStatus.permission==='denied' ? 'Notifications are blocked in device/browser settings.' : 'Permission: '+pushStatus.permission}</small>
              </span>
            </div>

            <label className="settings-switch-row">
              <span><strong>Allow push notifications</strong><small>Master switch for this Famioo account in this household.</small></span>
              <input type="checkbox" checked={pushEnabled} onChange={(event)=>setPushEnabled(event.target.checked)} />
            </label>

            <div className="notification-button-row">
              {!pushStatus.subscribed ? (
                <button type="button" className="primary-button compact" disabled={pushBusy || pushStatus.permission==='denied'} onClick={()=>void enablePush()}>
                  <Bell size={14} />{pushBusy ? 'Working…' : 'Enable on this device'}
                </button>
              ) : (
                <>
                  <button type="button" className="primary-button compact" disabled={pushBusy || !pushEnabled} onClick={()=>void testPush()}>
                    <Send size={14} />{pushBusy ? 'Working…' : 'Send test'}
                  </button>
                  <button type="button" className="secondary-button compact" disabled={pushBusy} onClick={()=>void disablePush()}>
                    Disable this device
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </section>

      <section className="settings-card notification-settings-card">
        <div className="settings-section-head">
          <div>
            <span className="eyebrow">EMAIL SUMMARIES</span>
            <h2>Daily & weekly family email</h2>
            <p>Choose when Famioo should send a calendar summary to {email}.</p>
          </div>
          <Mail size={22} />
        </div>

        <label className="settings-switch-row">
          <span><strong>Email delivery</strong><small>Master switch for Famioo summary emails.</small></span>
          <input type="checkbox" checked={emailEnabled} onChange={(event)=>setEmailEnabled(event.target.checked)} />
        </label>

        <div className="summary-setting-block">
          <label className="settings-switch-row">
            <span><strong>Daily summary</strong><small>Today's calendar events in one email.</small></span>
            <input type="checkbox" checked={dailyEnabled} disabled={!emailEnabled} onChange={(event)=>setDailyEnabled(event.target.checked)} />
          </label>
          <label className="summary-time-control">
            <span>Send every day at</span>
            <TimePicker value={dailyTime} onChange={setDailyTime} disabled={!emailEnabled || !dailyEnabled} />
          </label>
        </div>

        <div className="summary-setting-block">
          <label className="settings-switch-row">
            <span><strong>Weekly summary</strong><small>The next seven days of calendar events in one email.</small></span>
            <input type="checkbox" checked={weeklyEnabled} disabled={!emailEnabled} onChange={(event)=>setWeeklyEnabled(event.target.checked)} />
          </label>
          <div className="summary-schedule-row">
            <label>
              Day
              <Select value={weeklyWeekday} onChange={setWeeklyWeekday} options={weekdays} ariaLabel="Weekly summary day" disabled={!emailEnabled || !weeklyEnabled} />
            </label>
            <label>
              Time
              <TimePicker value={weeklyTime} onChange={setWeeklyTime} disabled={!emailEnabled || !weeklyEnabled} />
            </label>
          </div>
        </div>

        <small className="field-hint">All schedules use {household.timezone} and automatically follow daylight-saving time.</small>
        <small className="field-hint">Storage downgrade, billing and other essential account emails are transactional notices and are sent separately from optional daily/weekly summaries.</small>
      </section>

      <section className="settings-card notification-settings-card passkey-settings-card">
        <div className="settings-section-head">
          <div>
            <span className="eyebrow">DEVICE SIGN-IN</span>
            <h2>Face ID, Touch ID & device lock</h2>
            <p>Use a passkey so Famioo can sign you in with your phone or computer's secure unlock method instead of typing a password.</p>
          </div>
          <Fingerprint size={23} />
        </div>

        {!passkeySupported && (
          <div className="notification-support-note">
            <strong>No built-in secure authenticator detected.</strong>
            <span>You can still use your normal email/phone and password sign-in.</span>
          </div>
        )}

        {!passkeyServerEnabled && (
          <div className="notification-support-note">
            <strong>Passkey sign-in still needs the one-time server switch.</strong>
            <span>The Famioo app is ready for Face ID, Touch ID and device-lock sign-in, but Supabase Passkeys must be enabled for the production domain first.</span>
          </div>
        )}

        {passkeys.length>0 && (
          <div className="passkey-list">
            {passkeys.map((passkey)=>(
              <div className="passkey-row" key={passkey.id}>
                <Fingerprint size={17} />
                <span>
                  <strong>{passkey.friendly_name || 'Device passkey'}</strong>
                  <small>{passkey.last_used_at ? 'Last used '+new Date(passkey.last_used_at).toLocaleDateString() : 'Ready for passwordless sign-in'}</small>
                </span>
                <button type="button" className="icon-button compact-icon" disabled={passkeyBusy} onClick={()=>void deletePasskey(passkey.id,passkey.friendly_name || 'this passkey')} aria-label="Remove passkey">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <button type="button" className="primary-button compact" disabled={passkeyBusy || !passkeySupported || !passkeyServerEnabled} onClick={()=>void registerPasskey()}>
          <Fingerprint size={15} />{passkeyBusy ? 'Working…' : 'Add this device for Face ID / device unlock'}
        </button>
      </section>

      <section className="settings-card notification-settings-save">
        <div>
          <span className="eyebrow">SAVE SETTINGS</span>
          <h2>Notification preferences</h2>
          <p>Calendar reminder settings are selected when each calendar event is created.</p>
        </div>
        <button type="button" className="primary-button" disabled={saving || loading} onClick={()=>void savePreferences()}>
          {saving ? 'Saving…' : 'Save notification settings'}
        </button>
      </section>

      {message && <div className="form-message notification-settings-message">{message}</div>}
      {error && <div className="form-message error notification-settings-message">{error}</div>}
      <ConfirmDialog
        open={Boolean(passkeyDelete)}
        title="Remove device sign-in?"
        message={passkeyDelete ? 'Remove '+passkeyDelete.name+' from Famioo sign-in?' : ''}
        confirmLabel="Remove"
        danger
        busy={passkeyBusy}
        onCancel={()=>setPasskeyDelete(null)}
        onConfirm={()=>{ if(passkeyDelete) void deletePasskey(passkeyDelete.id,passkeyDelete.name).finally(()=>setPasskeyDelete(null)) }}
      />
    </div>
  )
}
