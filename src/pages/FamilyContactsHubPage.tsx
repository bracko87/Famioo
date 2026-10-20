import { ContactRound, PhoneCall } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { ContactsPage } from './ContactsPage'
import { EmergencyPage } from './EmergencyPage'

type ContactsTab = 'directory' | 'emergency'

const tabs: Array<{ id: ContactsTab; label: string; icon: typeof ContactRound }> = [
  { id: 'directory', label: 'Contacts', icon: ContactRound },
  { id: 'emergency', label: 'Emergency Numbers', icon: PhoneCall },
]

/** Family contacts and emergency service numbers only. Historical pickup
 * links fall back to the Contacts tab; existing pickup data is preserved. */
export function FamilyContactsHubPage() {
  const [params, setParams] = useSearchParams()
  const tab: ContactsTab = params.get('tab') === 'emergency' ? 'emergency' : 'directory'

  return (
    <div className="family-module-hub" aria-label="Family Contacts and emergency numbers">
      <nav className="family-module-tabs" aria-label="Family Contacts sections">
        {tabs.map(item => {
          const Icon = item.icon
          return (
            <button
              type="button"
              key={item.id}
              className={tab === item.id ? 'active' : ''}
              aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => setParams(item.id === 'directory' ? {} : { tab: item.id })}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>
      {tab === 'directory' ? <ContactsPage /> : <EmergencyPage />}
    </div>
  )
}
