import { ArrowLeft, ArrowRight, CheckCircle2, Gem, LockKeyhole } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { useHousehold } from '../context/HouseholdContext'
import { FREE_MODULE_CODES, MERGED_MODULE_CODES } from '../lib/accountPlan'
import { moduleSlides } from '../lib/moduleMarketing'
import type { ModuleCode } from '../lib/types'

/** Product descriptions used for discovery only. Actual module entitlements
 * come from the household access model, never from marketing content. */
const benefits: Partial<Record<ModuleCode, string[]>> = {
  location: ['Optional family location sharing and visibility controls', 'Household map, safe places and check-ins', 'Coordinate arrivals while respecting individual sharing preferences'],
  memo: ['Collect shared ideas, notes and useful places', 'Keep someday plans separate from urgent tasks', 'Return to important household notes in one place'],
  travel: ['Plan family trips and destinations', 'Keep itinerary details and travel documents together', 'Connect with available household planning features'],
  vehicles: ['Manage household vehicle information', 'Track maintenance, documents and important vehicle dates', 'Organize ownership and service details'],
  pets: ['Maintain profiles for household pets', 'Keep health, vaccinations and care details organized', 'Track recurring pet responsibilities'],
  inbox_scan: ['Capture letters and important paper notices', 'Organize scans and extracted details for review', 'Use connected actions only when the required modules are active'],
  home_remote: ['Organize household screens and supported media controls', 'Keep rooms and devices together', 'Manage household control permissions'],
  voice_integration: ['Ask about shared family calendar events and upcoming tasks', 'Add family tasks and shopping items through approved voice commands', 'Choose the permitted Alexa commands and manage access securely'],
  shopping: ['Share shopping lists with household members', 'Keep receipts and compare recorded prices', 'Connect recipes or costs when both modules are active'],
  costs: ['Manage regular and one-time household expenses', 'Review budgets, payment timing and spending summaries', 'Compare expenses and linked receipts without double-counting'],
  school: ['Collect school and Kita entries and key dates', 'Keep forms, files and contact details organized', 'Link to Calendar or Tasks when available'],
  home_care: ['Track household assets, warranties and upkeep', 'Schedule maintenance and document repairs', 'Connect costs or tasks only when those modules are enabled'],
  life_admin: ['Organize contracts, policies and renewals', 'Record important deadlines and documents', 'Create linked calendar reminders or tasks when available'],
  projects: ['Coordinate family projects and chores', 'Assign responsibilities and manage points', 'Review family progress and rewards'],
  meals: ['Plan family meals and build a recipe collection', 'Organize ingredients and cooking instructions', 'Export ingredients to Shopping when purchased'],
  assistant: ['Get AI assistance across permitted household information', 'Ask questions about supported modules', 'Review usage limits and available request balances'],
  vaccinations: ['Keep household vaccination records organized', 'Review prevention and upcoming dates', 'Store relevant details alongside other household plans'],
  tickets: ['Scan and store useful QR codes and tickets', 'Organize code details for quick access', 'Keep event and entry information together'],
}

function offerable(module: { code: ModuleCode; entitled: boolean }) {
  return !module.entitled
    && !FREE_MODULE_CODES.has(module.code)
    && !MERGED_MODULE_CODES.has(module.code)
}

export function PremiumModulesPage() {
  const { modules } = useHousehold()
  const availableToExplore = modules.filter(offerable)

  return (
    <div className="page premium-catalogue-page">
      <header className="premium-catalogue-heading">
        <span className="eyebrow">FAMIOO PREMIUM</span>
        <h1>Discover more for your household</h1>
        <p>Explore optional modules you do not currently have. Your included Free modules stay available without a purchase.</p>
        <div className="premium-catalogue-status"><Gem size={15} /> Module purchases are coming soon. This is an information catalogue, not a checkout.</div>
      </header>
      {availableToExplore.length ? (
        <section className="premium-module-grid" aria-label="Optional modules not purchased">
          {availableToExplore.map(module => {
            const slide = moduleSlides.find(item => item.code === module.code)
            return (
              <article className="premium-module-card" key={module.code}>
                {slide && <div className="premium-module-card-photo" style={{backgroundImage:`linear-gradient(90deg,rgba(69,35,76,.70),rgba(71,43,84,.10)),url("${slide.image}")`}} />}
                <div className="premium-module-card-content">
                  <span className="eyebrow">OPTIONAL MODULE</span>
                  <h2>{module.name}</h2>
                  <p>{slide?.description || module.description}</p>
                  <Link to={`/app/premium/module/${module.code}`} className="premium-module-learn">Learn more <ArrowRight size={15}/></Link>
                </div>
              </article>
            )
          })}
        </section>
      ) : (
        <section className="premium-catalogue-empty">
          <CheckCircle2 size={25}/>
          <h2>No unpurchased optional modules</h2>
          <p>All currently available optional modules are already included in your account or household.</p>
        </section>
      )}
    </div>
  )
}

export function PremiumModuleDetailsPage() {
  const { code } = useParams<{code: string}>()
  const { modules } = useHousehold()
  const module = modules.find(item => item.code === code && !MERGED_MODULE_CODES.has(item.code))
  const slide = moduleSlides.find(item => item.code === module?.code)

  if (!module) return (
    <div className="page premium-module-detail-page">
      <Link to="/app/premium" className="premium-detail-back"><ArrowLeft size={16}/> Back to Premium</Link>
      <section className="premium-catalogue-empty"><h2>Module not found</h2><p>This module is not currently part of the Famioo catalogue.</p></section>
    </div>
  )

  const free = FREE_MODULE_CODES.has(module.code)
  const alreadyAvailable = module.entitled
  const points = benefits[module.code] || [slide?.description || module.description]

  return (
    <div className="page premium-module-detail-page">
      <Link to="/app/premium" className="premium-detail-back"><ArrowLeft size={16}/> All optional modules</Link>
      <section className="premium-detail-hero">
        {slide && <div className="premium-detail-hero-image" style={{backgroundImage:`url("${slide.image}")`}}/>}
        <div className="premium-detail-hero-copy">
          <span className="eyebrow">{free ? 'INCLUDED MODULE' : 'OPTIONAL FAMIOO MODULE'}</span>
          <h1>{module.name}</h1>
          <p>{slide?.description || module.description}</p>
          <span className="premium-detail-tag">{alreadyAvailable ? 'Available with your account' : 'Not unlocked'}</span>
        </div>
      </section>
      <section className="premium-detail-section">
        <h2>What this module offers</h2>
        <p>Designed to make these household activities easier:</p>
        <ul className="premium-feature-list">
          {points.map(point => <li key={point}><CheckCircle2 size={17}/><span>{point}</span></li>)}
        </ul>
        <small>Some connections require additional modules and permissions. Features and availability may evolve before purchasing launches.</small>
      </section>
      <section className="premium-detail-section premium-detail-purchase">
        <div>
          <h2>{alreadyAvailable ? 'Included in your account' : 'How to get this module'}</h2>
          {alreadyAvailable
            ? <p>Access is already included. You can use it through your normal Famioo modules, subject to your role permissions.</p>
            : <p>When module purchasing becomes available, open Premium, select this module, review the final monthly price and subscription terms, and confirm the purchase. Access will then appear in your household modules.</p>}
          <p className="premium-purchase-note"><LockKeyhole size={15}/> Purchasing and checkout are not enabled yet. No payment is taken on this page.</p>
        </div>
        <Link to="/app/premium" className="premium-module-learn">Explore other modules <ArrowRight size={15}/></Link>
      </section>
    </div>
  )
}
