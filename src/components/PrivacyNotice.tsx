import { LockKeyhole } from 'lucide-react'
import { Link } from 'react-router-dom'

export function PrivacyNotice({ compact=false }: { compact?:boolean }) {
  return (
    <div className={compact ? 'privacy-notice compact' : 'privacy-notice'}>
      <LockKeyhole size={14} />
      <span>
        <strong>Private household data.</strong>
        {' '}Access is restricted to authorized household members. Client-side end-to-end encryption is prepared but is not yet active for every structured field.
      </span>
      <Link to="/app/settings?tab=privacy-security">Privacy & encryption →</Link>
    </div>
  )
}
