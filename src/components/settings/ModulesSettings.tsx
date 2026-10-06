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

      <div className="famioo-pricing-model">
        <span className="eyebrow">FAMIOO PRICING MODEL</span>
        <div className="pricing-model-grid">
          <article>
            <strong>Free core</strong>
            <p>Calendar, Tasks, Checklists and Files are included free. Files includes 1 GB shared household storage.</p>
          </article>
          <article>
            <strong>Optional modules</strong>
            <p>The first paid module is €0.99/month. Every additional module uses its own price between €0.39 and €0.99/month once configured.</p>
          </article>
          <article>
            <strong>AI Assistant</strong>
            <p>€1.69/month includes 150 requests. Each additional 100-request monthly pack costs €0.99.</p>
          </article>
          <article>
            <strong>Storage reward</strong>
            <p>More than €3/month in qualifying paid modules unlocks 10 GB. If spending drops below €3, 10 GB can be kept for €0.49/month.</p>
          </article>
        </div>
      </div>
    </section>
  )
}
