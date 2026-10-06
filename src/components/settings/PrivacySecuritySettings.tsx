import { Database, KeyRound, LockKeyhole, ShieldCheck, Smartphone } from 'lucide-react'

export function PrivacySecuritySettings() {
  return (
    <section className="settings-card privacy-settings-card">
      <div className="settings-section-head">
        <div>
          <span className="eyebrow">PRIVACY & ENCRYPTION</span>
          <h2>How Famioo protects private household data</h2>
          <p>Famioo separates private household access from end-to-end encryption so the app never promises more protection than is actually active.</p>
        </div>
        <ShieldCheck size={24} />
      </div>

      <div className="privacy-status-banner">
        <LockKeyhole size={19} />
        <span>
          <strong>Current production protection</strong>
          <small>Authenticated household access, Row Level Security, private storage buckets and encrypted HTTPS transport are active.</small>
        </span>
      </div>

      <div className="privacy-settings-grid">
        <article>
          <Database size={18} />
          <div>
            <strong>What the server stores today</strong>
            <p>Most structured module fields are still stored as normal database values behind strict household permissions. Private Files use a non-public storage bucket. This is secure private storage, but it is not yet zero-knowledge end-to-end encryption.</p>
          </div>
        </article>

        <article>
          <Smartphone size={18} />
          <div>
            <strong>Target: encrypt before upload</strong>
            <p>Files, photos and sensitive structured values will be encrypted on the user device before they are sent to Famioo. The backend will receive ciphertext plus only the minimum metadata required for syncing and permissions.</p>
          </div>
        </article>

        <article>
          <KeyRound size={18} />
          <div>
            <strong>Keys stay with authorized devices</strong>
            <p>The prepared design uses a household data key wrapped separately for authorized devices. Famioo stores public device keys and wrapped household keys, never the raw household decryption key.</p>
          </div>
        </article>

        <article>
          <ShieldCheck size={18} />
          <div>
            <strong>Rollout order</strong>
            <p>Files and photos first, then Life Admin and School attachments, followed by Household Costs and other sensitive structured data. A module will only display an “end-to-end encrypted” label after its complete read/write/share/recovery path is encrypted.</p>
          </div>
        </article>
      </div>

      <div className="privacy-important-note">
        <strong>Why Famioo does not yet say “your data never leaves the phone unencrypted” everywhere</strong>
        <p>That statement would currently be inaccurate. Household Costs totals, School/Kita fields, Shopping text, Home Care and Life Admin structured records still rely on server-readable values for sync and calculations. The database foundation for client-side encryption is now prepared, but those modules must be migrated safely before the stronger wording is shown.</p>
      </div>
    </section>
  )
}
