import { Database, LockKeyhole, ShieldCheck, Smartphone } from 'lucide-react'

export function PrivacySecuritySettings() {
  return (
    <section className="settings-card privacy-settings-card">
      <div className="settings-section-head">
        <div>
          <span className="eyebrow">PRIVACY & ENCRYPTION</span>
          <h2>Your family's privacy is built into Famioo</h2>
          <p>Private household information is protected with authenticated access, strict household permissions, private storage and encrypted network connections.</p>
        </div>
        <ShieldCheck size={24} />
      </div>

      <div className="privacy-status-banner">
        <LockKeyhole size={19} />
        <span>
          <strong>Private by design</strong>
          <small>Only authenticated household members with the required permission can access household records through Famioo.</small>
        </span>
      </div>

      <div className="privacy-settings-grid">
        <article>
          <ShieldCheck size={18} />
          <div>
            <strong>Household access protection</strong>
            <p>Famioo uses household membership, roles and Row Level Security so one household cannot simply browse another household's private records.</p>
          </div>
        </article>

        <article>
          <LockKeyhole size={18} />
          <div>
            <strong>Encrypted connection</strong>
            <p>Data sent between your device and Famioo uses encrypted HTTPS/TLS connections, protecting information while it travels across the internet.</p>
          </div>
        </article>

        <article>
          <Database size={18} />
          <div>
            <strong>Private file storage</strong>
            <p>Files and photos are stored in non-public household storage and are delivered through controlled, time-limited access rather than public links.</p>
          </div>
        </article>

        <article>
          <Smartphone size={18} />
          <div>
            <strong>Stronger device-side protection</strong>
            <p>Famioo is prepared for an additional device-side encryption layer for the most sensitive content, starting with files and private attachments and expanding module by module.</p>
          </div>
        </article>
      </div>

      <div className="privacy-positive-note">
        <strong>Privacy remains part of the product design</strong>
        <p>Sensitive modules such as Files, Household Costs, School & Kita, Home Care and Life Admin are treated as private household areas and use the same household access protections throughout the app.</p>
      </div>
    </section>
  )
}
