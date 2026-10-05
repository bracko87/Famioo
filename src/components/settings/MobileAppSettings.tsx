import { Check, Copy, ExternalLink, Share2, Smartphone } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

function isStandalone() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function MobileAppSettings() {
  const [copied,setCopied] = useState(false)
  const [standalone,setStandalone] = useState(false)
  const [ios,setIos] = useState(false)
  const installUrl = useMemo(() => window.location.origin + '/app',[])

  useEffect(() => {
    setStandalone(isStandalone())
    setIos(isIosDevice())
  },[])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(installUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false),1800)
    } catch {
      window.prompt('Copy the Famioo link:',installUrl)
    }
  }

  async function shareLink() {
    if (navigator.share) {
      await navigator.share({
        title:'Famioo',
        text:'Open Famioo and add it to your iPhone Home Screen.',
        url:installUrl,
      })
      return
    }

    await copyLink()
  }

  return (
    <div className="mobile-app-settings">
      <section className="settings-card mobile-app-install-card">
        <div className="mobile-app-install-hero">
          <span className="mobile-app-icon-preview" aria-hidden="true">
            <img src="/famioo-app-icon.svg" alt="" />
          </span>

          <div>
            <span className="eyebrow">FAMIOO MOBILE APP</span>
            <h2>Install Famioo on your iPhone</h2>
            <p>
              This installs the current Famioo PWA as a standalone Home Screen app so you can test it as closely as possible to the future wrapped iOS version.
            </p>
          </div>

          <span className={standalone ? 'install-status installed' : 'install-status'}>
            {standalone ? <><Check size={14} />Installed</> : <><Smartphone size={14} />Ready to install</>}
          </span>
        </div>

        {!standalone && (
          <div className="mobile-app-install-steps">
            <div><strong>1</strong><span>Open Famioo in Safari on the iPhone.</span></div>
            <div><strong>2</strong><span>Tap the Safari Share button.</span></div>
            <div><strong>3</strong><span>Choose “Add to Home Screen”, then confirm Add.</span></div>
            <div><strong>4</strong><span>Open Famioo from its new Home Screen icon.</span></div>
          </div>
        )}

        <div className="mobile-app-install-actions">
          <button className="primary-button compact" type="button" onClick={() => void shareLink()}>
            <Share2 size={14} />
            Share Famioo link
          </button>

          <button className="secondary-button compact" type="button" onClick={() => void copyLink()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy install link'}
          </button>

          <a className="secondary-button compact" href={installUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            Open Famioo
          </a>
        </div>

        <div className="mobile-app-install-note">
          <strong>{ios ? 'iPhone detected.' : 'For iPhone installation:'}</strong>
          <span>Apple does not allow a normal one-click PWA download button. Safari → Share → Add to Home Screen is the official installation flow.</span>
        </div>
      </section>

      <section className="settings-card mobile-app-test-card">
        <span className="eyebrow">TESTING MODE</span>
        <h2>What this version is intended to test</h2>
        <div className="mobile-app-test-grid">
          <span>Standalone app window</span>
          <span>Famioo Home Screen icon</span>
          <span>Mobile navigation</span>
          <span>Safe areas & iPhone layout</span>
          <span>Login persistence</span>
          <span>Calendar & Tasks</span>
          <span>All household modules</span>
          <span>Forms, popups & keyboard</span>
        </div>
        <p>
          Native-only behavior such as deeper background processing and some future iOS integrations will still need final validation after the real Capacitor/TestFlight build.
        </p>
      </section>
    </div>
  )
}
