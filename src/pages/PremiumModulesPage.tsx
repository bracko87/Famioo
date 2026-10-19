import { Gem } from 'lucide-react'

/**
 * Purchase catalogue placeholder. No purchase buttons are exposed until the
 * subscription products, entitlement checks and billing flow are ready.
 */
export function PremiumModulesPage() {
  return (
    <div className="page premium-placeholder-page">
      <section className="premium-placeholder-card">
        <span className="premium-placeholder-icon"><Gem size={30} aria-hidden="true" /></span>
        <span className="eyebrow">FAMIOO PREMIUM</span>
        <h1>More for your family</h1>
        <p>Browse and unlock additional Famioo modules here when our Premium catalogue is ready.</p>
        <span className="premium-placeholder-status">Coming soon</span>
        <small>Your free modules remain available. Nothing can be purchased on this page yet.</small>
      </section>
    </div>
  )
}
