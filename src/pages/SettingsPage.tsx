import { useHousehold } from '../context/HouseholdContext'

export function SettingsPage() {
  const { household, modules } = useHousehold()

  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">SETTINGS</span>
          <h1>{household.name}</h1>
          <p>Core household settings stay separate from individual paid modules.</p>
        </div>
      </section>

      <section className="settings-grid">
        <article className="settings-card">
          <span className="eyebrow">HOUSEHOLD</span>
          <h2>General</h2>
          <dl>
            <div><dt>Name</dt><dd>{household.name}</dd></div>
            <div><dt>Timezone</dt><dd>{household.timezone}</dd></div>
            <div><dt>Your role</dt><dd>{household.role}</dd></div>
          </dl>
        </article>

        <article className="settings-card">
          <span className="eyebrow">MODULES</span>
          <h2>Availability</h2>
          <div className="settings-module-list">
            {modules.map((module) => (
              <div key={module.code}>
                <span><strong>{module.name}</strong><small>{module.description}</small></span>
                <em className={module.enabled ? 'enabled' : ''}>{module.enabled ? 'Enabled' : 'Locked'}</em>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  )
}
