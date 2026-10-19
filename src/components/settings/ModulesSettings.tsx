import { useHousehold } from '../../context/HouseholdContext'
import { FREE_MODULE_CODES, isFreePlanAccount } from '../../lib/accountPlan'

export function ModulesSettings() {
  const { modules,user } = useHousehold()
  const individualFree = isFreePlanAccount(user)
  const mergedHidden = new Set(['emergency_info', 'pickup_authorization', 'checkin', 'calendar_context', 'rewards'])
  const listedModules = modules.filter(module => !mergedHidden.has(module.code))
  const freeModules = listedModules.filter(module => FREE_MODULE_CODES.has(module.code))
  const optionalModules = listedModules.filter(module => !FREE_MODULE_CODES.has(module.code))
  const unlockedOptional = optionalModules.filter(module => module.enabled).length

  const moduleRow = (module: (typeof modules)[number]) => (
    <div key={module.code}>
      <span>
        <strong>{module.code === 'contacts' ? 'Family Contacts & Emergency' : module.code === 'location' ? 'Family Location & Check-In' : module.name}</strong>
        <small>{module.description}</small>
      </span>
      <span className="module-status-group">
        {FREE_MODULE_CODES.has(module.code) && <em className="core">Free</em>}
        <em className={module.enabled ? 'enabled' : ''}>
          {module.enabled ? 'Available' : module.entitled ? 'No access' : 'Not unlocked'}
        </em>
      </span>
    </div>
  )

  return (
    <section className="settings-card">
      <div className="settings-section-head">
        <div>
          <span className="eyebrow">MODULES</span>
          <h2>Availability</h2>
          <p>Core and optional Famioo modules are managed separately from General settings.</p>
          {individualFree && <p className="free-storage-note"><strong>Individual Free Plan active.</strong> These limits apply to your login only. The household and its other members keep their existing entitlements.</p>}
        </div>
      </div>

      <div className="module-availability-group">
        <div className="module-availability-heading">
          <h3>Included in Famioo Free</h3>
          <span>{freeModules.length} modules and features</span>
        </div>
        <div className="settings-module-list">{freeModules.map(moduleRow)}</div>
      </div>

      <div className="module-availability-group optional">
        <div className="module-availability-heading">
          <h3>Optional paid modules</h3>
          <span>{unlockedOptional} available · {optionalModules.length - unlockedOptional} not unlocked</span>
        </div>
        <p className="module-availability-hint">Only modules available to your account appear in navigation and connect with your other active modules. Locked paid connections are disabled.</p>
        <div className="settings-module-list">{optionalModules.map(moduleRow)}</div>
      </div>

      <div className="famioo-pricing-model">
        <span className="eyebrow">FAMIOO PRICING MODEL</span>
        <div className="pricing-model-grid">
          <article>
            <strong>Free core</strong>
            <p>Our planned free package includes Calendar, Calendar Connections, Tasks, Checklists, Family Safety, Family Contacts & Emergency (including Pickups), Family Messenger, Memories (100 MB), Files (1 GB shared storage), and separately activated Alexa / Voice. Access changes will be rolled out with the purchase system.</p>
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
            <p>€3.00/month or more in qualifying paid modules unlocks 10 GB. If spending drops below €3.00, 10 GB can be kept for €0.49/month.</p>
          </article>
        </div>
      </div>
    </section>
  )
}
