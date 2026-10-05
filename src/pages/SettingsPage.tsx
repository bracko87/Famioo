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
import { CategoryAvailabilitySettings } from '../components/settings/CategoryAvailabilitySettings'

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

const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'modules', label: 'Modules' },
  { id: 'categories', label: 'Categories' },
  { id: 'templates', label: 'Templates' },
  { id: 'types', label: 'Types' },
  { id: 'users', label: 'Users' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'category-availability', label: 'Category availability' },
  { id: 'weather', label: 'Weather' },
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

  return (
    <div className="page settings-page">
      <div className="page-label">SETTINGS</div>

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

      <section className="settings-tab-content">
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'categories' && <CategoriesSettings />}
        {activeTab === 'modules' && <ModulesSettings />}
        {activeTab === 'users' && <UsersSettings />}
        {activeTab === 'permissions' && <PermissionsSettings />}
        {activeTab === 'templates' && <TemplatesSettings />}
        {activeTab === 'types' && <TypesSettings />}
        {activeTab === 'category-availability' && <CategoryAvailabilitySettings />}
        {activeTab === 'weather' && <WeatherSettings />}
      </section>
    </div>
  )
}
