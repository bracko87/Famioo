import { Layers } from 'lucide-react'
import { useState } from 'react'
import { GeneralSettings } from '../components/settings/GeneralSettings'
import { ModulesSettings } from '../components/settings/ModulesSettings'
import { PermissionsSettings } from '../components/settings/PermissionsSettings'
import { UsersSettings } from '../components/settings/UsersSettings'
import { WeatherSettings } from '../components/settings/WeatherSettings'

type SettingsTab =
  | 'general'
  | 'modules'
  | 'categories'
  | 'templates'
  | 'users'
  | 'permissions'
  | 'layers'
  | 'weather'

const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'modules', label: 'Modules' },
  { id: 'categories', label: 'Categories' },
  { id: 'templates', label: 'Templates' },
  { id: 'users', label: 'Users' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'layers', label: 'Layers' },
  { id: 'weather', label: 'Weather' },
]

const placeholderCopy: Partial<Record<SettingsTab, { title: string; body: string }>> = {
  categories: {
    title: 'Categories',
    body: 'Shared category management will live here and can later be connected to individual modules.',
  },
  templates: {
    title: 'Templates',
    body: 'Reusable household and module templates will be managed here.',
  },
  layers: {
    title: 'Layers',
    body: 'Cross-module layers and configuration relationships will be managed here.',
  },
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const placeholder = placeholderCopy[activeTab]

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
        {activeTab === 'modules' && <ModulesSettings />}
        {activeTab === 'users' && <UsersSettings />}
        {activeTab === 'permissions' && <PermissionsSettings />}
        {activeTab === 'weather' && <WeatherSettings />}

        {placeholder && (
          <article className="settings-card settings-placeholder-card">
            <div className="settings-placeholder-icon">
              <Layers size={21} />
            </div>
            <div>
              <span className="eyebrow">SETTINGS SECTION</span>
              <h2>{placeholder.title}</h2>
              <p>{placeholder.body}</p>
              <small>This section is reserved now so it can be connected without redesigning Settings later.</small>
            </div>
          </article>
        )}
      </section>
    </div>
  )
}
