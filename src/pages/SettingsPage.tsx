import { ArrowLeft, Bell, Boxes, CloudSun, Grid3X3, KeyRound, ListChecks, Palette, Settings2, ShieldCheck, Smartphone, Tags, Users } from 'lucide-react'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CategoriesSettings } from '../components/settings/CategoriesSettings'
import { GeneralSettings } from '../components/settings/GeneralSettings'
import { ModulesSettings } from '../components/settings/ModulesSettings'
import { PermissionsSettings } from '../components/settings/PermissionsSettings'
import { UsersSettings } from '../components/settings/UsersSettings'
import { WeatherSettings } from '../components/settings/WeatherSettings'
import { TemplatesSettings } from '../components/settings/TemplatesSettings'
import { TypesSettings } from '../components/settings/TypesSettings'
import { MobileAppSettings } from '../components/settings/MobileAppSettings'
import { CategoryAvailabilitySettings } from '../components/settings/CategoryAvailabilitySettings'
import { NotificationsSecuritySettings } from '../components/settings/NotificationsSecuritySettings'
import { PrivacySecuritySettings } from '../components/settings/PrivacySecuritySettings'

type SettingsTab =
  | 'general'
  | 'modules'
  | 'categories'
  | 'templates'
  | 'types'
  | 'users'
  | 'permissions'
  | 'category-availability'
  | 'weather'
  | 'notifications-security'
  | 'privacy-security'
  | 'mobile-app'

const settingsTabs: Array<{ id: SettingsTab; label: string; icon: typeof Settings2 }> = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'modules', label: 'Modules', icon: Boxes },
  { id: 'categories', label: 'Categories', icon: Palette },
  { id: 'templates', label: 'Templates', icon: ListChecks },
  { id: 'types', label: 'Types', icon: Tags },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'permissions', label: 'Permissions', icon: KeyRound },
  { id: 'category-availability', label: 'Category availability', icon: Grid3X3 },
  { id: 'weather', label: 'Weather', icon: CloudSun },
  { id: 'notifications-security', label: 'Notifications & security', icon: Bell },
  { id: 'privacy-security', label: 'Privacy & encryption', icon: ShieldCheck },
  { id: 'mobile-app', label: 'Mobile app', icon: Smartphone },
]

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = useMemo<SettingsTab>(() => {
    const requested = searchParams.get('tab') as SettingsTab | null
    return settingsTabs.some((tab) => tab.id === requested) ? requested! : 'general'
  }, [searchParams])

  function setActiveTab(tab: SettingsTab) {
    setSearchParams(tab === 'general' ? {} : { tab })
  }

  const mobileDetailOpen = searchParams.has('tab')
  const activeLabel = settingsTabs.find((tab) => tab.id === activeTab)?.label ?? 'Settings'

  return (
    <div className="page settings-page">
      <div className="page-label">SETTINGS</div>

      <section className="mobile-settings-menu" aria-label="Settings menu">
        <header className="mobile-settings-title">Settings</header>
        {settingsTabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button type="button" key={'mobile-'+tab.id} onClick={() => setSearchParams({ tab: tab.id })}>
              <Icon size={21} />
              <span>{tab.label}</span>
              <span className="mobile-settings-chevron">›</span>
            </button>
          )
        })}
      </section>

      {mobileDetailOpen && (
        <div className="mobile-settings-detail-head">
          <button type="button" onClick={() => setSearchParams({})} aria-label="Back to settings">
            <ArrowLeft size={20} />
          </button>
          <strong>{activeLabel}</strong>
          <span />
        </div>
      )}

      <nav className="settings-tabs" aria-label="Settings sections">
        {settingsTabs.map((tab) => (
          <button
            type="button"
            className={activeTab === tab.id ? 'active' : ''}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className={'settings-tab-content ' + (!mobileDetailOpen ? 'mobile-settings-closed' : '')}>
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'categories' && <CategoriesSettings />}
        {activeTab === 'modules' && <ModulesSettings />}
        {activeTab === 'users' && <UsersSettings />}
        {activeTab === 'permissions' && <PermissionsSettings />}
        {activeTab === 'templates' && <TemplatesSettings />}
        {activeTab === 'types' && <TypesSettings />}
        {activeTab === 'category-availability' && <CategoryAvailabilitySettings />}
        {activeTab === 'weather' && <WeatherSettings />}
        {activeTab === 'notifications-security' && <NotificationsSecuritySettings />}
        {activeTab === 'privacy-security' && <PrivacySecuritySettings />}
        {activeTab === 'mobile-app' && <MobileAppSettings />}
      </section>
    </div>
  )
}
