import { useHousehold } from '../../context/HouseholdContext'

export function ModulesSettings() {
  const { modules } = useHousehold()

  return (
    <section className="settings-card">
      <div className="settings-section-head">
        <div>
          <span className="eyebrow">MODULES</span>
          <h2>Availability</h2>
          <p>Core and optional Famioo modules are managed separately from General settings.</p>
        </div>
      </div>

      <div className="settings-module-list">
        {modules.map((module) => (
          <div key={module.code}>
            <span>
              <strong>{module.name}</strong>
              <small>{module.description}</small>
            </span>
            <span className="module-status-group">
              {module.is_core && <em className="core">Core</em>}
              <em className={module.entitled ? 'enabled' : ''}>
                {module.entitled ? 'Available' : 'Locked'}
              </em>
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
