import { LockKeyhole } from 'lucide-react'
import { Link } from 'react-router-dom'

export function PrivacyNotice({ compact=false }: { compact?:boolean }) {
  return (
    <div className={compact ? 'privacy-notice compact' : 'privacy-notice'}>
      <LockKeyhole size={14} />
      <span>
        <strong>Private household data.</strong>
        {' '}Protected with authenticated household access, strict database permissions, private storage and encrypted connections.
      </span>
      <Link to="/app/settings?tab=privacy-security">Privacy & encryption →</Link>
    </div>
  )
}
